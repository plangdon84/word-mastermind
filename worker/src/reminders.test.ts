import { describe, expect, it } from 'vitest';
import { DAY_MS } from '../../src/game';
import { deleteAccount } from './accounts';
import { fakeD1 } from './fakeD1';
import { toBase64Url, type VapidKeys } from './push';
import { comeBackNotice } from './notices';
import { COME_BACK_AFTER_MS, REMINDER_BATCH, runReminders } from './reminders';

/** 8pm in New York on 14 October 2026 (summer time, UTC-4). */
const EIGHT_PM = Date.UTC(2026, 9, 15, 0, 0);
const DAY = '2026-10-14';
/** Noon in New York the same day. */
const NOON = Date.UTC(2026, 9, 14, 16, 0);

const id = (n: number) => `${String(n).padStart(8, '0')}-5d4a-4b1c-9e3f-2a7d8c6b5e41`;

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  return { publicKey: toBase64Url(publicKey), privateKey: jwk.d!, subject: 'https://app.example' };
}

/** A device's keys, as a browser makes them. */
async function deviceKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const p256dh = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer));
  return { p256dh, auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) };
}

async function setup() {
  const { db, sqlite } = fakeD1();
  const keys = await vapidKeys();
  const device = await deviceKeys();
  /** The devices each push went to. */
  const pushed: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    pushed.push(String(input));
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  /** A guest with turn alerts on one device, its switches as given. */
  const guest = (guestId: string, switches: { timeLow?: number; dailies?: number; comeBack?: number } = {}, accountId: string | null = null) => {
    sqlite.prepare('INSERT OR IGNORE INTO guests (id, created_at, last_seen_at, account_id) VALUES (?, 0, 0, ?)').run(guestId, accountId);
    sqlite.prepare(
      `INSERT INTO push_subscriptions (endpoint, guest_id, p256dh, auth, created_at, remind_time_low, remind_dailies, remind_come_back)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
    ).run(`https://fcm.googleapis.com/fcm/send/${guestId}`, guestId, device.p256dh, device.auth,
      switches.timeLow ?? 1, switches.dailies ?? 1, switches.comeBack ?? 1);
  };
  /** An account made by the device `accountId`, with a synced profile whose settings are as given. */
  const account = (accountId: string, settings: Record<string, unknown> = {}) => {
    sqlite.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, 0)').run(accountId, `${accountId}@example.com`);
    sqlite.prepare('INSERT OR IGNORE INTO guests (id, created_at, last_seen_at, account_id) VALUES (?, 0, 0, ?)').run(accountId, accountId);
    sqlite.prepare(
      `INSERT INTO profiles (account_id, guest_name, name, country, member_since, settings, updated_at)
       VALUES (?, 'Guest-1234', NULL, NULL, 0, ?, 0)`,
    ).run(accountId, JSON.stringify({ difficulty: 'medium', showTutorial: true, ...settings }));
  };
  const started = (playerId: string, mode: string, day = DAY) =>
    sqlite.prepare('INSERT INTO daily_played (player_id, day, mode, played_at) VALUES (?, ?, ?, ?)').run(playerId, day, mode, EIGHT_PM - DAY_MS / 4);
  const run = async (now: number) => (await runReminders(db, keys, now, fetchFn)).sent.map((n) => [n.guestId, n.message.title]);
  return { db, sqlite, keys, pushed, guest, account, started, run, fetchFn };
}

describe('the dailies reminder', () => {
  it("goes at 8pm in New York to players who haven't played one or both of the day's games, once", async () => {
    const { guest, started, run, pushed } = await setup();
    for (const n of [1, 2, 3, 4]) guest(id(n));
    started(id(2), 'daily');
    started(id(3), 'dailyWord');
    started(id(4), 'daily');
    started(id(4), 'dailyWord');
    // Yesterday's games don't count.
    started(id(1), 'daily', '2026-10-13');
    expect(await run(EIGHT_PM)).toEqual([
      [id(1), "Today's Daily Set and Daily Word are waiting"],
      [id(2), "Today's Daily Word is waiting"],
      [id(3), "Today's Daily Set is waiting"],
    ]);
    expect(pushed).toHaveLength(3);
    expect(await run(EIGHT_PM + 60_000)).toEqual([]);
  });

  it('opens the first game left when tapped (and coming back, the title screen)', async () => {
    const { db, keys, guest, started, fetchFn } = await setup();
    guest(id(1));
    guest(id(2));
    started(id(2), 'daily');
    const { sent } = await runReminders(db, keys, EIGHT_PM, fetchFn);
    expect(sent.map((n) => n.message.url)).toEqual(['/?daily=set', '/?daily=word']);
    expect(sent[1].message.body).toBe("You've played the Daily Set. The Daily Word is there until midnight in New York.");
    expect(comeBackNotice(id(1)).message.url).toBe('/?title');
  });

  it("isn't sent outside 8pm in New York, nor without push keys", async () => {
    const { db, guest, run, fetchFn } = await setup();
    guest(id(1));
    expect(await run(EIGHT_PM - 60_000)).toEqual([]);
    expect(await run(EIGHT_PM + 60 * 60_000)).toEqual([]);
    expect((await runReminders(db, null, EIGHT_PM, fetchFn)).sent).toEqual([]);
    // In winter, 8pm in New York is 1:00 UTC.
    expect(await run(Date.UTC(2026, 11, 2, 1, 0))).toEqual([[id(1), "Today's Daily Set and Daily Word are waiting"]]);
  });

  it("follows each device's switch and, signed in, the account's", async () => {
    const { guest, account, run, pushed } = await setup();
    guest(id(1), { dailies: 0 });
    account(id(2), { remindDailies: false });
    guest(id(2), {}, id(2));
    account(id(3), { remindDailies: true });
    guest(id(3), {}, id(3));
    // A device signed in to the account (`id(3)`) and one that said no, on the same account.
    guest(id(4), {}, id(3));
    guest(id(5), { dailies: 0 }, id(3));
    expect(await run(EIGHT_PM)).toEqual([[id(3), "Today's Daily Set and Daily Word are waiting"]]);
    expect(pushed.sort()).toEqual([id(3), id(4)].map((g) => `https://fcm.googleapis.com/fcm/send/${g}`));
  });

  it("counts a game the account played on any of its devices, as a guest before signing in", async () => {
    const { account, guest, started, run } = await setup();
    account(id(1));
    guest(id(1), {}, id(1));
    guest(id(2), {}, id(1));
    started(id(2), 'daily');
    expect(await run(EIGHT_PM)).toEqual([[id(1), "Today's Daily Word is waiting"]]);
  });

  it('goes in batches, a run a minute', async () => {
    const { guest, run } = await setup();
    for (let n = 1; n <= REMINDER_BATCH + 2; n++) guest(id(n));
    expect(await run(EIGHT_PM)).toHaveLength(REMINDER_BATCH);
    expect(await run(EIGHT_PM + 60_000)).toHaveLength(2);
    expect(await run(EIGHT_PM + 120_000)).toHaveLength(0);
  });

  it('reaches first, the next day, the players a short hour left out', async () => {
    const { guest, run } = await setup();
    for (let n = 1; n <= REMINDER_BATCH + 2; n++) guest(id(n));
    // Only one run on the first day.
    expect((await run(EIGHT_PM)).map(([g]) => g)).toEqual([1, 2, 3, 4, 5].map(id));
    expect((await run(EIGHT_PM + DAY_MS)).map(([g]) => g)).toEqual([6, 7, 1, 2, 3].map(id));
  });
});

describe('the come-back reminder', () => {
  const played = (sqlite: ReturnType<typeof fakeD1>['sqlite'], playerId: string, at: number) =>
    sqlite.prepare(
      `INSERT INTO player_activity (player_id, played_at) VALUES (?, ?)
       ON CONFLICT (player_id) DO UPDATE SET played_at = MAX(played_at, excluded.played_at)`,
    ).run(playerId, at);

  it('goes at noon in New York after a week with no game, then not until the next game', async () => {
    const { sqlite, guest, run } = await setup();
    for (const n of [1, 2, 3]) guest(id(n));
    played(sqlite, id(1), NOON - COME_BACK_AFTER_MS - 1);
    played(sqlite, id(2), NOON - COME_BACK_AFTER_MS + 2 * 60 * 60_000);
    // id(3) has no game the server knows of: never reminded.
    expect(await run(NOON - 60 * 60_000)).toEqual([]);
    expect(await run(NOON)).toEqual([[id(1), 'Ready for another game?']]);
    expect(await run(NOON + 60_000)).toEqual([]);
    expect(await run(NOON + DAY_MS)).toEqual([[id(2), 'Ready for another game?']]);
    expect(await run(NOON + 8 * DAY_MS)).toEqual([]);
    played(sqlite, id(1), NOON + DAY_MS);
    expect(await run(NOON + 8 * DAY_MS + 60_000)).toEqual([[id(1), 'Ready for another game?']]);
  });

  it("follows the switches, and counts an account's games on every device", async () => {
    const { sqlite, guest, account, run } = await setup();
    guest(id(1), { comeBack: 0 });
    played(sqlite, id(1), 0);
    account(id(2), { remindComeBack: false });
    guest(id(2), {}, id(2));
    played(sqlite, id(2), 0);
    account(id(3));
    guest(id(3), {}, id(3));
    guest(id(4), {}, id(3));
    played(sqlite, id(3), 0);
    played(sqlite, id(4), NOON - DAY_MS);
    expect(await run(NOON)).toEqual([]);
  });
});

describe('what counts as playing', () => {
  const activity = (sqlite: ReturnType<typeof fakeD1>['sqlite'], playerId: string) =>
    (sqlite.prepare('SELECT played_at FROM player_activity WHERE player_id = ?').get(playerId) as { played_at: number } | undefined)?.played_at;

  it('is every game the server knows of, kept as each is saved', () => {
    const { sqlite } = fakeD1();
    sqlite.prepare(`INSERT INTO guests (id, created_at, last_seen_at) VALUES (?, 0, 0)`).run(id(1));
    sqlite.prepare(`INSERT INTO games (id, mode, version, record, started_at, finished_at) VALUES ('g', 'friend', 1, '{}', 100, 500)`).run();
    sqlite.prepare(`INSERT INTO game_players (game_id, guest_id) VALUES ('g', ?)`).run(id(1));
    expect(activity(sqlite, id(1))).toBe(500);
    sqlite.prepare(`INSERT INTO friend_game_players (game_id, guest_id, added_at) VALUES ('h', ?, 900)`).run(id(1));
    expect(activity(sqlite, id(1))).toBe(900);
    sqlite.prepare(`INSERT INTO daily_played (player_id, day, mode, played_at) VALUES (?, ?, 'daily', 800)`).run(id(1), DAY);
    expect(activity(sqlite, id(1))).toBe(900);
    sqlite.prepare(`INSERT INTO accounts (id, email, created_at) VALUES (?, 'a@example.com', 0)`).run(id(2));
    sqlite.prepare(
      `INSERT INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at) VALUES (?, 'e', 'single', 1, '{}', 700, 2000)`,
    ).run(id(2));
    expect(activity(sqlite, id(2))).toBe(700);
    // A device whose clock is ahead counts no later than the game arrived.
    sqlite.prepare(
      `INSERT INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at) VALUES (?, 'f', 'single', 1, '{}', 9000, 3000)`,
    ).run(id(2));
    expect(activity(sqlite, id(2))).toBe(3000);
  });

  it('is forgotten with the account', async () => {
    const { db, sqlite, account, guest, started, run } = await setup();
    account(id(1));
    guest(id(1), {}, id(1));
    started(id(1), 'daily');
    await run(EIGHT_PM);
    await deleteAccount(db, id(1));
    for (const table of ['player_activity', 'daily_played', 'reminders_sent']) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });
});
