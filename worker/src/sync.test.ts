import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { authApi, type Session } from '../../src/app/account';
import { loadSyncState, notePending, syncAccount, type HistoryStore } from '../../src/app/profileSync';
import { syncApi, SyncError, UPLOAD_BATCH, type SyncedProfile } from '../../src/app/syncApi';
import { friendEntry, soloEntry } from '../../src/game/testGames';
import { fakeD1, migrationSql } from './fakeD1';
import { fakeRooms } from './fakeRooms';
import { handle, type Env } from './index';
import { MAX_ACCOUNT_CHARS, saveEntries } from './sync';

/*
 * The synced profile (README "Accounts"): signed in, a device's games go to
 * the account and the account's come to every device; the profile and
 * settings follow too. The app's own sync runs against the worker in process.
 */

const NOW = Date.UTC(2026, 8, 28);
const APP = 'https://app.example';
const PHONE = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const LAPTOP = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';

const profile = (changes: Partial<SyncedProfile> = {}): SyncedProfile => ({
  guestName: 'Guest-4821', name: null, country: null, memberSince: NOW - 1000,
  settings: { difficulty: 'medium', newestFirst: { easy: false, medium: false, hard: true, extreme: true }, showTutorial: true, shareMarks: true, findByName: true },
  ...changes,
});

function setup() {
  const { db, sqlite } = fakeD1();
  let clock = NOW;
  const { namespace } = fakeRooms({ db, now: () => clock });
  const emails: string[] = [];
  const outside = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const env: Env = {
    DB: db, GAMES: namespace, DAILY: undefined as unknown as DurableObjectNamespace,
    LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key',
    EMAIL_FROM: 'play@example.com',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock, outside)) as typeof fetch;
  const auth = (guestId: string) => authApi('https://api.example', guestId, fetchFn);
  const signIn = async (guestId: string, email: string): Promise<Session> => {
    clock += 60_000;
    await auth(guestId).sendLink(email, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    return auth(guestId).signIn(token);
  };
  const api = (guestId: string, session: Session | null) =>
    syncApi('https://api.example', { guestId, token: session?.token ?? null }, fetchFn);
  return { sqlite, db, auth, signIn, api };
}

/** Each device has its own storage: its localStorage and its history. Tests switch between them. */
function devices() {
  const stores = new Map<string, { local: Map<string, string>; games: Map<string, ReturnType<typeof soloEntry>> }>();
  const use = (name: string) => {
    if (!stores.has(name)) stores.set(name, { local: new Map(), games: new Map() });
    const { local, games } = stores.get(name)!;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => local.set(key, value),
      removeItem: (key: string) => local.delete(key),
    });
    const store: HistoryStore = {
      allIds: async () => [...games.keys()],
      getGames: async (ids) => ids.flatMap((id) => (games.has(id) ? [games.get(id)!] : [])),
      putGames: async (entries) => {
        for (const e of entries) games.set(e.id, e);
      },
    };
    return { store, games };
  };
  return use;
}

const won = (id: string, start = NOW) => soloEntry(id, start, ['crane', 'beach']);

describe('syncing with an account', () => {
  it('needs an account: a guest has nothing kept on the server', async () => {
    const { api } = setup();
    await expect(api(PHONE, null).getProfile()).rejects.toMatchObject({ code: 'signed-out' });
    await expect(api(PHONE, null).upload([won('g1')])).rejects.toBeInstanceOf(SyncError);
  });

  it("moves a device's games and profile to the account on signing in, then brings them to another device", async () => {
    const { signIn, api } = setup();
    const use = devices();

    const phone = use('phone');
    phone.games.set('g1', won('g1'));
    phone.games.set('g2', won('g2', NOW + 1));
    const onPhone = await signIn(PHONE, 'ann@example.com');
    const first = await syncAccount(api(PHONE, onPhone), onPhone.account.id, profile({ name: 'Ann', country: 'GB' }), phone.store);
    expect(first).toMatchObject({ added: 0, profile: { name: 'Ann', country: 'GB' } });
    expect(loadSyncState()).toMatchObject({ accountId: onPhone.account.id, pending: [] });

    const laptop = use('laptop');
    laptop.games.set('g3', won('g3', NOW + 2));
    const onLaptop = await signIn(LAPTOP, 'ann@example.com');
    const second = await syncAccount(api(LAPTOP, onLaptop), onLaptop.account.id,
      profile({ guestName: 'Guest-1111', memberSince: NOW - 5000 }), laptop.store);
    // The account's name and country, the earlier member-since date, and the phone's games.
    expect(second.profile).toMatchObject({ name: 'Ann', country: 'GB', guestName: 'Guest-4821', memberSince: NOW - 5000 });
    expect(second.added).toBe(2);
    expect([...laptop.games.keys()].sort()).toEqual(['g1', 'g2', 'g3']);

    // Back on the phone, the laptop's game arrives, and the earlier date.
    use('phone');
    const third = await syncAccount(api(PHONE, onPhone), onPhone.account.id, first.profile, phone.store);
    expect(third).toMatchObject({ added: 1, profile: { memberSince: NOW - 5000 } });
    expect([...phone.games.keys()].sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it("sends a change made on this device, and otherwise takes the account's", async () => {
    const { signIn, api } = setup();
    const use = devices();
    const phone = use('phone');
    const onPhone = await signIn(PHONE, 'ann@example.com');
    const synced = (await syncAccount(api(PHONE, onPhone), onPhone.account.id, profile({ name: 'Ann' }), phone.store)).profile;

    const laptop = use('laptop');
    const onLaptop = await signIn(LAPTOP, 'ann@example.com');
    await syncAccount(api(LAPTOP, onLaptop), onLaptop.account.id, profile(), laptop.store);
    const renamed = { ...synced, name: 'Annie', settings: { ...synced.settings, difficulty: 'hard' as const } };
    expect((await syncAccount(api(LAPTOP, onLaptop), onLaptop.account.id, renamed, laptop.store)).profile).toEqual(renamed);

    // The phone hasn't changed anything, so it takes the laptop's.
    use('phone');
    expect((await syncAccount(api(PHONE, onPhone), onPhone.account.id, synced, phone.store)).profile).toEqual(renamed);
  });

  it('sends games saved later, in batches, and each game once', async () => {
    const { signIn, api, sqlite } = setup();
    const use = devices();
    const phone = use('phone');
    const onPhone = await signIn(PHONE, 'ann@example.com');
    await syncAccount(api(PHONE, onPhone), onPhone.account.id, profile(), phone.store);

    const ids = Array.from({ length: UPLOAD_BATCH + 3 }, (_, i) => `later-${i}`);
    for (const [i, id] of ids.entries()) phone.games.set(id, won(id, NOW + i));
    notePending(ids);
    notePending(['later-0']);
    await syncAccount(api(PHONE, onPhone), onPhone.account.id, profile(), phone.store);
    expect(loadSyncState()?.pending).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM history_entries').get()).toEqual({ n: ids.length });
  });

  it("refuses a profile the rules don't allow, and skips a game that doesn't replay", async () => {
    const { signIn, api, sqlite } = setup();
    const onPhone = await signIn(PHONE, 'ann@example.com');
    const phone = api(PHONE, onPhone);
    await expect(phone.putProfile(profile({ name: 'x' }))).rejects.toMatchObject({ code: 'bad-request' });
    await expect(phone.putProfile(profile({ country: 'XX' }))).rejects.toMatchObject({ code: 'bad-request' });
    // Still being played: not a finished game.
    await phone.upload([soloEntry('open', NOW, ['crane'])]);
    // A game the server refereed comes from the server, so one sent by a device is never kept.
    await phone.upload([friendEntry('made-up', NOW, { you: ['beach'], them: [] })]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM history_entries').get()).toEqual({ n: 0 });
  });

  // One account mustn't be able to fill the database for everyone.
  it('keeps no more history for an account than MAX_ACCOUNT_CHARS', async () => {
    const { signIn, api, sqlite } = setup();
    const onPhone = await signIn(PHONE, 'ann@example.com');
    const accountId = onPhone.account.id;
    // Room for one more game, not two.
    const room = JSON.stringify(won('fits')).length + 10;
    sqlite.prepare(`INSERT INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at)
      VALUES (?, 'big', 'single', 1, ?, ?, ?)`).run(accountId, 'x'.repeat(MAX_ACCOUNT_CHARS - room), NOW, NOW);
    await api(PHONE, onPhone).upload([won('fits'), won('too-many', NOW + 1)]);
    const kept = sqlite.prepare('SELECT id FROM history_entries WHERE account_id = ? ORDER BY id').all(accountId);
    expect(kept).toEqual([{ id: 'big' }, { id: 'fits' }]);
    // Another account has its own room.
    const other = await signIn(LAPTOP, 'bob@example.com');
    await api(LAPTOP, other).upload([won('bob-1')]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM history_entries WHERE account_id = ?').get(other.account.id)).toEqual({ n: 1 });
  });

  it('checks the room left even when two uploads come at once', async () => {
    const { signIn, sqlite, db } = setup();
    const onPhone = await signIn(PHONE, 'ann@example.com');
    const accountId = onPhone.account.id;
    const room = JSON.stringify(won('phone')).length + 10;
    sqlite.prepare(`INSERT INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at)
      VALUES (?, 'big', 'single', 1, ?, ?, ?)`).run(accountId, 'x'.repeat(MAX_ACCOUNT_CHARS - room), NOW, NOW);
    await Promise.all([saveEntries(db, accountId, [won('phone')], NOW), saveEntries(db, accountId, [won('laptop')], NOW)]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM history_entries WHERE account_id = ?').get(accountId)).toEqual({ n: 2 });
  });

  it("keeps each account's running total in step with its games", async () => {
    const { signIn, api, sqlite } = setup();
    const onPhone = await signIn(PHONE, 'ann@example.com');
    const accountId = onPhone.account.id;
    const total = () => sqlite.prepare('SELECT history_chars AS n FROM accounts WHERE id = ?').get(accountId);
    const sum = () => sqlite.prepare('SELECT SUM(LENGTH(entry)) AS n FROM history_entries WHERE account_id = ?').get(accountId);
    await api(PHONE, onPhone).upload([won('g1'), won('g2', NOW + 1)]);
    await api(PHONE, onPhone).upload([won('g1'), won('g3', NOW + 2)]);
    expect(total()).toEqual(sum());
    sqlite.prepare(`DELETE FROM history_entries WHERE id = 'g2'`).run();
    expect(total()).toEqual(sum());
    sqlite.exec('DELETE FROM history_entries');
    expect(total()).toEqual({ n: 0 });
  });

  it('starts the running total from the games an account already had', () => {
    // Every migration up to the one that adds the running total, then it and the rest.
    const all = migrationSql();
    const at = all.findIndex((sql) => sql.includes('ADD COLUMN history_chars'));
    expect(at).toBeGreaterThan(0);
    const [before, after] = [all.slice(0, at), all.slice(at)];
    const sqlite = new DatabaseSync(':memory:');
    for (const sql of before) sqlite.exec(sql);
    sqlite.exec(`INSERT INTO accounts (id, email, created_at) VALUES ('a', 'ann@example.com', 0), ('b', 'bob@example.com', 0);
      INSERT INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at)
      VALUES ('a', 'g1', 'single', 1, 'xxx', 0, 0), ('a', 'g2', 'single', 1, 'xxxx', 0, 0)`);
    for (const sql of after) sqlite.exec(sql);
    expect(sqlite.prepare('SELECT id, history_chars FROM accounts ORDER BY id').all())
      .toEqual([{ id: 'a', history_chars: 7 }, { id: 'b', history_chars: 0 }]);
  });

  it('forgets the synced profile and history when the account is deleted', async () => {
    const { signIn, api, auth, sqlite } = setup();
    const onPhone = await signIn(PHONE, 'ann@example.com');
    await api(PHONE, onPhone).putProfile(profile());
    await api(PHONE, onPhone).upload([won('g1')]);
    await auth(PHONE).deleteAccount(onPhone.token);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM history_entries').get()).toEqual({ n: 0 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM profiles').get()).toEqual({ n: 0 });
  });
});
