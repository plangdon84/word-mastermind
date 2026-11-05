import { COMPUTER_AFTER_MS, validateSecretWord, type Rating } from '../../src/game';
import type { QueueBusy, QueueError, QueueStatus } from '../../src/app/queueApi';

/*
 * The matchmaking queue's referee (README "Random opponent"), run by one
 * Durable Object per time control and difficulty (`matchmaker.ts`). Players
 * wait with their secret word, checking in every few seconds; the queue
 * pairs two whose ratings are close enough, allowing a wider gap the longer
 * either has waited, and starts a rated game between them. Since Dev Plan
 * item 19p, there's one queue, Live 10 at Medium, and a player not matched
 * with a person within 30 seconds (`COMPUTER_AFTER_MS`) plays a computer at
 * about their level instead, chosen when they join. Like the game logic,
 * it never reads the clock: the time is passed in.
 */

/** A player waiting in the queue. */
export interface Seeker {
  accountId: string;
  name: string;
  secret: string;
  rating: Rating;
  /** The recall of the computer they'd play if no person is free (`ladderComputer`). */
  computer: number;
  /**
   * Their computer game is being started: they stay in the queue, out of
   * matching, until it exists, so a check-in meanwhile keeps waiting rather
   * than joining again (and maybe being matched with a person too).
   */
  starting?: number;
  /** Computer games that failed to start; after `COMPUTER_TRIES`, only people. */
  computerFails?: number;
  joinedAt: number;
  /** When they last checked in. */
  seenAt: number;
}

/** A game the queue started, kept so the player who was waiting learns of it. */
interface Match {
  gameId: string;
  at: number;
}

/**
 * A ladder game the queue started that hasn't ended yet (Dev Plan item 19w):
 * how many people play in it (2, or 1 against a computer) and when it began.
 * Its room tells the queue when it ends (`ended`).
 */
interface InPlay {
  people: number;
  at: number;
}

interface QueueState {
  seekers: Seeker[];
  matches: Record<string, Match>;
  /** By game ID. Absent in a queue stored before item 19w. */
  playing?: Record<string, InPlay>;
}

/** A player who hasn't checked in for this long has left (closed the page), and loses their place. */
export const STALE_MS = 30_000;
/** How long a match waits to be picked up. */
export const MATCH_KEEP_MS = 10 * 60 * 1000;
/**
 * The longest a ladder game can last: both 10-minute clocks and both
 * 2-minute first guesses (24 minutes), with room to spare. A game whose end
 * the queue never heard of (its room's notice failed) stops counting after
 * this, so a lost notice can't leave the count high.
 */
export const PLAYING_KEEP_MS = 30 * 60 * 1000;
/**
 * How long a `starting` mark holds: if the queue stops while a computer game
 * is being made (a deploy), the mark is never cleared, so after this it's
 * treated as gone and the next check-in tries again (review round 2).
 */
export const STARTING_MS = 30_000;

/** Whether a seeker's computer game is being started now. */
const isStarting = (seeker: Seeker, now: number) => seeker.starting !== undefined && now - seeker.starting < STARTING_MS;

/** How many times the queue tries to start a seeker's computer game before waiting for people alone. */
export const COMPUTER_TRIES = 3;

/** The rating gap allowed at once, and how much wider it gets each second the longer-waiting player has waited. */
export const BASE_GAP = 200;
export const GAP_PER_SECOND = 10;

/** The widest rating gap two players may be matched across, at `now`. */
export const allowedGap = (a: Seeker, b: Seeker, now: number) =>
  BASE_GAP + (GAP_PER_SECOND * (now - Math.min(a.joinedAt, b.joinedAt))) / 1000;

/**
 * The best opponent for `seeker` among the others: the closest rating within
 * the allowed gap, the longest waiting on a tie; or null.
 */
export function pickOpponent(seeker: Seeker, others: readonly Seeker[], now: number): Seeker | null {
  let best: Seeker | null = null;
  for (const other of others) {
    if (other.accountId === seeker.accountId || isStarting(other, now)) continue;
    const gap = Math.abs(other.rating.rating - seeker.rating.rating);
    if (gap > allowedGap(seeker, other, now)) continue;
    const bestGap = best && Math.abs(best.rating.rating - seeker.rating.rating);
    if (!best || gap < bestGap! || (gap === bestGap && other.joinedAt < best.joinedAt)) best = other;
  }
  return best;
}

export interface QueueStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface QueueDeps {
  /** Starts a rated game: `host` waited longer, `guest` made the match. Returns its ID. */
  startGame(host: Seeker, guest: Seeker, now: number): Promise<string>;
  /** Starts a rated game against the seeker's computer. Returns its ID. */
  startComputerGame(seeker: Seeker, now: number): Promise<string>;
  /** Cancels a computer game made for a player who left meanwhile, so it never shows in their games (Dev Plan item 19za). */
  abandonComputerGame(gameId: string): Promise<void>;
}

export type QueueRequest =
  | { action: 'join'; accountId: string; name: string; secret: string; rating: Rating; computer: number }
  | { action: 'poll'; accountId: string }
  | { action: 'leave'; accountId: string }
  /** How busy the ladder is (Dev Plan item 19w): counts only, read without changing anything. */
  | { action: 'busy' }
  /** From a game room the queue started: its game is over (or cancelled), so it stops counting. */
  | { action: 'ended'; gameId: string };

export type QueueResponse = { status: number; body: QueueStatus | QueueBusy | { error: QueueError } };

const KEY = 'queue';

async function load(storage: QueueStorage, now: number): Promise<QueueState> {
  const state = (await storage.get<QueueState>(KEY)) ?? { seekers: [], matches: {} };
  const matches = Object.fromEntries(Object.entries(state.matches).filter(([, m]) => now - m.at < MATCH_KEEP_MS));
  const playing = Object.fromEntries(Object.entries(state.playing ?? {}).filter(([, g]) => now - g.at < PLAYING_KEEP_MS));
  return { seekers: state.seekers.filter((s) => now - s.seenAt < STALE_MS), matches, playing };
}

/** How many people are in the ladder's games now: never who, just how many. */
const peoplePlaying = (state: QueueState) => Object.values(state.playing ?? {}).reduce((sum, g) => sum + g.people, 0);

/** The queue with a game it just started counted as in play. */
const withGame = (state: QueueState, gameId: string, people: number, now: number): Record<string, InPlay> =>
  ({ ...state.playing, [gameId]: { people, at: now } });

const waiting = (state: QueueState, seeker: Seeker, now: number): QueueResponse => ({
  status: 200,
  body: { state: 'waiting', since: seeker.joinedAt, waiting: state.seekers.length - 1, playing: peoplePlaying(state), now },
});

/**
 * Matches `seeker` if anyone fits. The opponent leaves the queue before the
 * game is started, since other requests can arrive while it starts; if it
 * fails, both go back.
 */
async function tryMatch(storage: QueueStorage, deps: QueueDeps, state: QueueState, seeker: Seeker, now: number): Promise<QueueResponse> {
  if (isStarting(seeker, now)) return waiting(state, seeker, now);
  const opponent = pickOpponent(seeker, state.seekers, now);
  if (!opponent) {
    const offerComputer = now - seeker.joinedAt >= COMPUTER_AFTER_MS && (seeker.computerFails ?? 0) < COMPUTER_TRIES;
    return offerComputer ? playComputer(storage, deps, state, seeker, now) : waiting(state, seeker, now);
  }
  const without = state.seekers.filter((s) => s.accountId !== opponent.accountId && s.accountId !== seeker.accountId);
  await storage.put(KEY, { ...state, seekers: without });
  let gameId: string;
  try {
    gameId = await deps.startGame(opponent, seeker, now);
  } catch {
    const current = await load(storage, now);
    await storage.put(KEY, { ...current, seekers: [...current.seekers, opponent, seeker] });
    return waiting(state, seeker, now);
  }
  const current = await load(storage, now);
  const at = { gameId, at: now };
  await storage.put(KEY, {
    ...current, matches: { ...current.matches, [opponent.accountId]: at, [seeker.accountId]: at }, playing: withGame(current, gameId, 2, now),
  });
  return { status: 200, body: { state: 'matched', gameId } };
}

/**
 * Nobody was free for 30 seconds: the seeker plays their computer. They stay
 * in the queue marked `starting` while its game is made, out of matching, so
 * a check-in meanwhile keeps waiting. Then they leave with the match; if the
 * game can't be started, the next check-in tries again, up to
 * `COMPUTER_TRIES` times, then they wait for a person alone.
 *
 * A player who leaves (Cancel) while it's made, and perhaps joins again, is
 * no longer the one it was made for (Dev Plan item 19x): a failure doesn't
 * put them back in the queue, and a game made meanwhile isn't handed to their
 * new place. Its room is told to cancel that game at once, with no winner,
 * history or rating (Dev Plan item 19za), so it never shows in their games;
 * if that fails, the room still cancels it once its first guess isn't made
 * in time (item 18zv).
 */
async function playComputer(storage: QueueStorage, deps: QueueDeps, state: QueueState, seeker: Seeker, now: number): Promise<QueueResponse> {
  const others = (seekers: readonly Seeker[]) => seekers.filter((s) => s.accountId !== seeker.accountId);
  const marked: Seeker = { ...seeker, starting: now };
  await storage.put(KEY, { ...state, seekers: [...others(state.seekers), marked] });
  // The queue as it is once the game is made or has failed, and whether the seeker is still the one marked.
  const settle = async () => {
    const current = await load(storage, now);
    const still = current.seekers.find((s) => s.accountId === seeker.accountId);
    return { current, still, same: still?.joinedAt === marked.joinedAt && still.starting === marked.starting };
  };
  // What a player no longer waiting for this game hears: their new place, or that they're out of the queue.
  const moved = (current: QueueState, still: Seeker | undefined): QueueResponse =>
    still ? waiting(current, still, now) : { status: 200, body: { state: 'idle' } };
  let gameId: string;
  try {
    gameId = await deps.startComputerGame(seeker, now);
  } catch {
    const { current, still, same } = await settle();
    if (!same) return moved(current, still);
    const failed: Seeker = { ...still!, computerFails: (seeker.computerFails ?? 0) + 1 };
    delete failed.starting;
    await storage.put(KEY, { ...current, seekers: [...others(current.seekers), failed] });
    return waiting(current, failed, now);
  }
  const { current, still, same } = await settle();
  if (!same) {
    // A failure is left to the first-guess time limit, but logged, as it shouldn't happen (Dev Plan item 19zb).
    await deps.abandonComputerGame(gameId).catch((e: unknown) => console.error('Ladder: cancelling an unwanted computer game failed', e));
    return moved(current, still);
  }
  await storage.put(KEY, {
    ...current, seekers: others(current.seekers), matches: { ...current.matches, [seeker.accountId]: { gameId, at: now } },
    playing: withGame(current, gameId, 1, now),
  });
  return { status: 200, body: { state: 'matched', gameId } };
}

export async function handleQueue(storage: QueueStorage, deps: QueueDeps, request: QueueRequest, now: number): Promise<QueueResponse> {
  const state = await load(storage, now);
  if (request.action === 'busy') return { status: 200, body: { waiting: state.seekers.length, playing: peoplePlaying(state) } };
  if (request.action === 'ended') {
    // A game it isn't counting (started before item 19w, or already gone) needs no write (review round 1).
    if (!state.playing?.[request.gameId]) return { status: 200, body: { state: 'idle' } };
    const { [request.gameId]: _ended, ...playing } = state.playing;
    await storage.put(KEY, { ...state, playing });
    return { status: 200, body: { state: 'idle' } };
  }
  const { accountId } = request;
  const others = state.seekers.filter((s) => s.accountId !== accountId);
  const { [accountId]: match, ...otherMatches } = state.matches;

  if (request.action === 'leave') {
    await storage.put(KEY, { ...state, seekers: others, matches: otherMatches });
    return { status: 200, body: { state: 'idle' } };
  }

  if (request.action === 'poll') {
    if (match) return { status: 200, body: { state: 'matched', gameId: match.gameId } };
    const seeker = state.seekers.find((s) => s.accountId === accountId);
    if (!seeker) {
      await storage.put(KEY, state);
      return { status: 200, body: { state: 'idle' } };
    }
    const seen = { ...seeker, seenAt: now };
    const next = { ...state, seekers: [...others, seen] };
    await storage.put(KEY, next);
    return tryMatch(storage, deps, next, seen, now);
  }

  // Joining while their computer game is being made waits for it, rather than starting over.
  const existing = state.seekers.find((s) => s.accountId === accountId);
  if (existing && isStarting(existing, now)) return waiting(state, existing, now);
  // Joining again starts over: a new word, a new place in the queue.
  const secret = validateSecretWord(request.secret);
  if (!secret.ok) return { status: 400, body: { error: secret.error } };
  const seeker: Seeker = {
    accountId, name: request.name, secret: secret.word, rating: request.rating, computer: request.computer, joinedAt: now, seenAt: now,
  };
  const next = { ...state, seekers: [...others, seeker], matches: otherMatches };
  await storage.put(KEY, next);
  return tryMatch(storage, deps, next, seeker, now);
}
