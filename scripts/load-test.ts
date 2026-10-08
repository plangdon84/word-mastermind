// The game server under many players at once (Dev Plan item 17,
// docs/test-plan.md "Performance"). Run by hand, never in CI:
//
//   node e2e/worker.ts                     the local server, with its rate limits raised
//   npm run load-test                      in another terminal: the full run against it
//   npm run load-test -- --api https://word-mastermind-api-staging.paul-m-langdon.workers.dev --scale 0.1 --setup-rate 25 --concurrency 500 --themes ../word-mastermind-daily
//
// It sets everyone up first (guests, invites, lobbies, Daily Rush starts),
// no faster than --setup-rate a minute where that's given, since the server
// limits those per internet address (worker/src/limits.ts). Then everyone
// plays at once, which is never limited: friend games, full 5-seat lobbies
// and Daily Rush. It reports each kind of move's response times and any
// errors, and fails (exit 1) on an error, or, against staging, a 95th
// percentile over 300 ms.
// Never point it at production.
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { calendarDays } from '../worker/src/themeDays.ts';
import { testThemeFor } from '../worker/src/testThemes.ts';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:8787' },
    scale: { type: 'string', default: '1' },
    'setup-rate': { type: 'string' },
    concurrency: { type: 'string', default: '64' },
    themes: { type: 'string' },
  },
});
const API = args.api.replace(/\/$/, '');
if (/word-mastermind-api\./.test(API)) throw new Error('That is the production server: use the local or staging one.');
const scale = Number(args.scale);
const FRIEND_GAMES = Math.round(100 * scale);
const LOBBIES = Math.round(20 * scale);
const DAILY_PLAYERS = Math.round(1000 * scale);
const TARGET_P95_MS = 300;
/** wrangler dev's times aren't Cloudflare's, so locally only errors fail the run. */
const local = /\/\/(localhost|127\.0\.0\.1)[:/]/.test(`${API}/`);
const MISSES = ['crane', 'house', 'plumb', 'light', 'bunny', 'ghost'];

// Today's Daily Rush words: the made-up test set e2e/worker.ts loads, or,
// against staging, from the private calendar's folder (--themes).
const today = new Date().toISOString().slice(0, 10);
const dailyWords: string[] = args.themes
  ? [...(calendarDays({
    themes: JSON.parse(readFileSync(join(args.themes, 'daily-rush-themes.json'), 'utf8')),
    calendar: JSON.parse(readFileSync(join(args.themes, 'daily-rush-calendar.json'), 'utf8')),
  }).find((d) => d.day === today)?.words ?? [])]
  : local ? [...testThemeFor(today).words] : [];

/** Response times in ms by kind of request, and errors by kind and code. */
const times = new Map<string, number[]>();
const errors = new Map<string, number>();

/** Setup requests the server rate limits wait their turn, at most `setup-rate` a minute. */
const setupGap = args['setup-rate'] ? 60_000 / Number(args['setup-rate']) : 0;
let nextSetup = 0;
async function setupSlot() {
  if (!setupGap) return;
  const at = Math.max(nextSetup, Date.now());
  nextSetup = at + setupGap;
  await new Promise((resolve) => setTimeout(resolve, at - Date.now()));
}

/**
 * At most --concurrency requests in flight. `wrangler dev` runs every Durable
 * Object in one process and drops connections well before Cloudflare would,
 * so locally this checks every move is answered right; staging is where the
 * times mean something.
 */
const maxInFlight = Number(args.concurrency);
let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot(): Promise<() => void> {
  if (inFlight >= maxInFlight) await new Promise<void>((resolve) => waiting.push(resolve));
  inFlight++;
  return () => {
    inFlight--;
    waiting.shift()?.();
  };
}

async function call<T>(kind: string, guest: string, method: string, path: string, body?: unknown, limited = false): Promise<T | null> {
  if (limited) await setupSlot();
  const release = await slot();
  const started = performance.now();
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-guest-id': guest },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ms = performance.now() - started;
    if (!times.has(kind)) times.set(kind, []);
    times.get(kind)!.push(ms);
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const key = `${kind}: ${response.status} ${(data as { error?: string } | null)?.error ?? ''}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
      return null;
    }
    return data as T;
  } catch (e) {
    const key = `${kind}: ${(e as Error).message}`;
    errors.set(key, (errors.get(key) ?? 0) + 1);
    return null;
  } finally {
    release();
  }
}

async function newGuest(): Promise<string> {
  const id = crypto.randomUUID();
  await call('setup: guest', id, 'POST', '/api/guests', { id }, true);
  return id;
}

interface Game { id: string; view: { turn: 'you' | 'them' | null } }

/** A friend game: set up now, played by the function returned. */
async function setupFriendGame(n: number): Promise<() => Promise<void>> {
  const [host, guest] = [await newGuest(), await newGuest()];
  const game = await call<Game>('setup: invite', host, 'POST', '/api/games',
    { name: `Load ${n}a`, secret: 'storm', difficulty: 'medium', timeControl: '1d' }, true);
  if (!game) return async () => {};
  await call('setup: join', guest, 'POST', `/api/games/${game.id}/join`, { name: `Load ${n}b`, secret: 'beach', difficulty: 'medium' });
  return async () => {
    const state = await call<Game>('friend: read', host, 'GET', `/api/games/${game.id}`);
    let [mover, waiter] = state?.view.turn === 'you' ? [host, guest] : [guest, host];
    for (let i = 0; i < 10; i++) {
      await call('friend: guess', mover, 'POST', `/api/games/${game.id}/guess`, { word: MISSES[i % MISSES.length] });
      [mover, waiter] = [waiter, mover];
    }
    await call('friend: concede', mover, 'POST', `/api/games/${game.id}/concede`, {});
  };
}

/** A full lobby of 5: set up and started now, played by the function returned. */
async function setupLobby(n: number): Promise<() => Promise<void>> {
  const players: string[] = [];
  for (let i = 0; i < 5; i++) players.push(await newGuest());
  const opened = await call<{ lobby: { code: string } }>('setup: lobby', players[0], 'POST', '/api/lobbies',
    { name: `Host ${n}`, difficulty: 'medium' }, true);
  if (!opened) return async () => {};
  const { code } = opened.lobby;
  for (let i = 1; i < 5; i++) await call('setup: lobby join', players[i], 'POST', `/api/lobbies/${code}/join`, { name: `Load ${n}-${i}` });
  await call('setup: lobby start', players[0], 'POST', `/api/lobbies/${code}/start`, {});
  return async () => {
    await Promise.all(players.map(async (player) => {
      for (let i = 0; i < 6; i++) await call('lobby: guess', player, 'POST', `/api/lobbies/${code}/guess`, { word: MISSES[i] });
      await call('lobby: read', player, 'GET', `/api/lobbies/${code}`);
      await call('lobby: give up', player, 'POST', `/api/lobbies/${code}/give-up`, {});
    }));
  };
}

/** A Daily Rush player: started now, played by the function returned. */
async function setupDaily(n: number): Promise<() => Promise<void>> {
  const player = await newGuest();
  // The profanity filter reads digits as letters, so a numbered name is sometimes refused: then a plain one.
  const start = (name: string) => call('setup: daily start', player, 'POST', '/api/daily/start', { day: today, difficulty: 'medium', name }, true);
  const started = await start(`Load ${n}`) ?? await start('Load tester');
  if (!started) return async () => {};
  return async () => {
    // The words come in each player's own order: try them in turn until all are found.
    for (let round = 0; round < dailyWords.length; round++) {
      for (const word of dailyWords) {
        const answer = await call<{ run: { status: string } | null }>('daily: guess', player, 'POST', '/api/daily/guess', { day: today, word });
        if (!answer || answer.run?.status !== 'playing') return;
      }
    }
  };
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

console.log(`Against ${API}: ${FRIEND_GAMES} friend games, ${LOBBIES} lobbies of 5, ${DAILY_PLAYERS} Daily Rush players (${today}).`);
if (!dailyWords.length) console.log('No Daily Rush theme today: skipping it.');
const setupStarted = Date.now();
const plays: (() => Promise<void>)[] = [];
const setups = [
  ...Array.from({ length: FRIEND_GAMES }, (_, i) => () => setupFriendGame(i)),
  ...Array.from({ length: LOBBIES }, (_, i) => () => setupLobby(i)),
  ...(dailyWords.length ? Array.from({ length: DAILY_PLAYERS }, (_, i) => () => setupDaily(i)) : []),
];
// Set up 50 at a time; rate-limited steps queue behind setupSlot.
for (let i = 0; i < setups.length; i += 50) plays.push(...await Promise.all(setups.slice(i, i + 50).map((s) => s())));
// A refused numbered name was retried with a plain one, so it isn't a failure.
errors.delete('setup: daily start: 400 offensive-name');
console.log(`Set up in ${((Date.now() - setupStarted) / 1000).toFixed(0)} s. Now everyone plays at once.`);

const playStarted = Date.now();
await Promise.all(plays.map((play) => play()));
console.log(`Played in ${((Date.now() - playStarted) / 1000).toFixed(1)} s.\n`);

let failed = errors.size > 0;
console.log('Kind'.padEnd(22), 'Count'.padStart(7), 'p50'.padStart(7), 'p95'.padStart(7), 'max'.padStart(7));
for (const [kind, list] of [...times].sort(([a], [b]) => a.localeCompare(b))) {
  const sorted = [...list].sort((a, b) => a - b);
  const p95 = percentile(sorted, 95);
  const move = !kind.startsWith('setup') && !local;
  if (move && p95 > TARGET_P95_MS) failed = true;
  console.log(kind.padEnd(22), String(sorted.length).padStart(7), ...[50, 95].map((p) => `${percentile(sorted, p).toFixed(0)}`.padStart(7)),
    `${sorted.at(-1)!.toFixed(0)}`.padStart(7), move && p95 > TARGET_P95_MS ? ` over ${TARGET_P95_MS} ms` : '');
}
for (const [key, count] of errors) console.error(`✗ ${count} × ${key}`);
if (local) console.log(`\nLocal server: times are wrangler dev's, not Cloudflare's, so only errors count; the ${TARGET_P95_MS} ms target is for staging.`);
console.log(failed ? '\n✗ Errors, or moves slower than the target.' : `\n✓ No errors${local ? '' : ', and every kind of move within the target'}.`);
process.exit(failed ? 1 : 0);
