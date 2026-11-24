import { describe, expect, it } from 'vitest';
import { authApi } from '../../src/app/account';
import { dailyApi, type DailyApi } from '../../src/app/dailyApi';
import type { DailyMode } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeDaily } from './fakeDaily';
import { handle, type Env } from './index';
import { toBase64Url, type VapidKeys } from './push';
import { noteDailyStarted, runReminders } from './reminders';

/*
 * Dev Plan item 19zt (issues 298 and 302): both dailies played on one of an
 * account's devices, and no 8pm reminder on another of its devices, even
 * when noting a start in D1 fails.
 */

const ANN_COMPUTER = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const ANN_PHONE = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
// Halloween 2026, with the test sets loaded (`testThemes.ts`): its Daily Set is brick, jumpy, solve, night.
const DAY = '2026-10-31';
const NOON = Date.UTC(2026, 9, 31, 12);
const SET = ['brick', 'jumpy', 'solve', 'night'];
/** 8pm in New York that day (summer time, UTC-4). */
const EIGHT_PM = Date.UTC(2026, 10, 1, 0, 0);
const APP = 'https://app.example';

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d!, subject: APP };
}

async function setup() {
  const { db, sqlite } = fakeD1({ dailyThemes: true });
  let clock = NOON;
  /** How many more notes of each game's start fail, as a busy D1 might. */
  const failing: Record<DailyMode, number> = { daily: 0, dailyWord: 0 };
  const started = async (mode: DailyMode, day: string, playerId: string, at: number) => {
    if (failing[mode] > 0) {
      failing[mode] -= 1;
      throw new Error('D1 is busy');
    }
    await noteDailyStarted(db, mode, day, playerId, at);
  };
  const env: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: fakeDaily({ db, now: () => clock, started }).namespace,
    LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace,
    ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key', EMAIL_FROM: 'play@example.com',
  };
  const emails: string[] = [];
  const outside = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock, outside)) as typeof fetch;
  const tokens = new Map<string, string>();
  const identity = (guestId: string) => ({ guestId, token: tokens.get(guestId) ?? null });
  /** Signs this device in to the account for `email`, linking its guest ID to it. */
  const signIn = async (guestId: string, email: string) => {
    clock += 60_000;
    const auth = authApi('https://api.example', guestId, fetchFn);
    await auth.sendLink(email, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    tokens.set(guestId, (await auth.signIn(token)).token);
  };
  /** Turn alerts on, with every reminder, on this device. */
  const alertsOn = (guestId: string) => sqlite.prepare(
    `INSERT INTO push_subscriptions (endpoint, guest_id, p256dh, auth, created_at, remind_time_low, remind_dailies, remind_come_back)
     VALUES (?, ?, 'key', 'auth', 0, 1, 1, 1)`,
  ).run(`https://fcm.googleapis.com/fcm/send/${guestId}`, guestId);
  const keys = await vapidKeys();
  const pushFetch = (async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
  /** The reminders the Cron Trigger sends at 8pm: each device and title. */
  const remind = async () => (await runReminders(db, keys, EIGHT_PM, pushFetch)).sent.map((n) => n.message.title);
  const notes = () => sqlite.prepare('SELECT mode FROM daily_played ORDER BY mode').all().map((r) => (r as { mode: string }).mode);
  const wordOf = () => (sqlite.prepare('SELECT word FROM daily_words WHERE day = ?').get(DAY) as { word: string }).word;
  return {
    failing, signIn, alertsOn, remind, notes, wordOf,
    set: (guestId: string): DailyApi => dailyApi('https://api.example', identity(guestId), fetchFn),
    word: (guestId: string): DailyApi => dailyApi('https://api.example', identity(guestId), fetchFn, 'dailyWord'),
    tick: (ms: number) => { clock += ms; },
  };
}

/** Plays both of the day's games through to the end on this device. */
async function playBoth(s: Awaited<ReturnType<typeof setup>>, guestId: string) {
  await s.set(guestId).start(DAY, 'medium', 'Ann');
  for (const word of SET) {
    s.tick(1000);
    await s.set(guestId).guess(DAY, word);
  }
  await s.word(guestId).start(DAY, 'medium', 'Ann');
  s.tick(1000);
  await s.word(guestId).guess(DAY, s.wordOf());
}

describe("the 8pm reminder, after both dailies on another of the account's devices", () => {
  it('reminds the phone when nothing was played (the setup reaches it)', async () => {
    const s = await setup();
    await s.signIn(ANN_COMPUTER, 'ann@example.com');
    await s.signIn(ANN_PHONE, 'ann@example.com');
    s.alertsOn(ANN_PHONE);
    expect(await s.remind()).toEqual(["Today's Daily Set and Daily Word are waiting"]);
  });

  it("doesn't come", async () => {
    const s = await setup();
    await s.signIn(ANN_COMPUTER, 'ann@example.com');
    await s.signIn(ANN_PHONE, 'ann@example.com');
    s.alertsOn(ANN_PHONE);
    await playBoth(s, ANN_COMPUTER);
    expect(s.notes()).toEqual(['daily', 'dailyWord']);
    expect(await s.remind()).toEqual([]);
  });

  it("doesn't come when noting a start failed: the next request notes it", async () => {
    const s = await setup();
    await s.signIn(ANN_COMPUTER, 'ann@example.com');
    await s.signIn(ANN_PHONE, 'ann@example.com');
    s.alertsOn(ANN_PHONE);
    s.failing.daily = 1;
    s.failing.dailyWord = 1;
    await playBoth(s, ANN_COMPUTER);
    expect(s.failing).toEqual({ daily: 0, dailyWord: 0 });
    expect(s.notes()).toEqual(['daily', 'dailyWord']);
    expect(await s.remind()).toEqual([]);
  });

  it('still answers a start whose note fails, and notes it when the game is next opened, on any device', async () => {
    const s = await setup();
    await s.signIn(ANN_COMPUTER, 'ann@example.com');
    await s.signIn(ANN_PHONE, 'ann@example.com');
    s.failing.dailyWord = 3;
    expect((await s.word(ANN_COMPUTER).start(DAY, 'medium', 'Ann')).run).toMatchObject({ status: 'playing' });
    expect(s.notes()).toEqual([]);
    await s.word(ANN_COMPUTER).today();
    await s.word(ANN_PHONE).today();
    expect(s.notes()).toEqual([]);
    await s.word(ANN_PHONE).today();
    expect(s.notes()).toEqual(['dailyWord']);
    // Once noted, it isn't written again.
    s.failing.dailyWord = 1;
    await s.word(ANN_PHONE).today();
    expect(s.failing.dailyWord).toBe(1);
  });
});
