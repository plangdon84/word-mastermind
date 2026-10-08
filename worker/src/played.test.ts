import { describe, expect, it } from 'vitest';
import { authApi } from '../../src/app/account';
import { dailyApi } from '../../src/app/dailyApi';
import { friendApi } from '../../src/app/friendApi';
import { lobbyApi } from '../../src/app/lobbyApi';
import { fetchPlayed } from '../../src/app/playedApi';
import { replayEntry, SECRET_WORDS, summarizeGame } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeDaily } from './fakeDaily';
import { fakeLobbies } from './fakeLobbies';
import { fakeRooms } from './fakeRooms';
import { handle, type Env } from './index';

const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
// Halloween 2026's Daily Rush, a test set (`testThemes.ts`): brick, jumpy, solve, night.
const DAY = '2026-10-31';
const NOON = Date.UTC(2026, 9, 31, 12);

const APP = 'https://app.example';

function setup() {
  const { db, sqlite } = fakeD1({ dailyThemes: true });
  let clock = NOON;
  const now = () => clock;
  const rooms = fakeRooms({ db, now }).namespace;
  /** While set, every room lookup fails, as a busy Durable Object's might. */
  const busy = { rooms: false };
  const games = {
    ...rooms,
    get: (id: Parameters<typeof rooms.get>[0]) => {
      const room = rooms.get(id);
      return { fetch: (url: string, init: RequestInit) => (busy.rooms ? Promise.reject(new Error('busy')) : room.fetch(url, init)) };
    },
  };
  const env: Env = {
    DB: db, GAMES: games as unknown as DurableObjectNamespace, DAILY: fakeDaily({ db, now }).namespace,
    LOBBIES: fakeLobbies({ db, now }).namespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: APP,
    RESEND_API_KEY: 'key', EMAIL_FROM: 'play@example.com',
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
  return {
    busy,
    signIn,
    sqlite,
    friend: (id: string) => friendApi('https://api.example', identity(id), fetchFn),
    daily: (id: string) => dailyApi('https://api.example', identity(id), fetchFn),
    lobby: (id: string) => lobbyApi('https://api.example', identity(id), fetchFn),
    played: (id: string, after = 0) => fetchPlayed('https://api.example', identity(id), after, fetchFn),
    tick: (ms: number) => { clock += ms; },
  };
}

describe('your games the server refereed', () => {
  it('come from your side once over: a friend game with your seat and their name', async () => {
    const s = setup();
    const { id } = await s.friend(ANN).create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' });
    await s.friend(BOB).join(id, { name: 'Bob', secret: 'beach', difficulty: 'hard' });
    expect((await s.played(ANN)).games).toEqual([]);
    await s.friend(ANN).guess(id, 'beach');
    await s.friend(BOB).guess(id, 'crane');

    const ann = (await s.played(ANN)).games;
    expect(ann).toHaveLength(1);
    expect(ann[0].ref).toBe(id);
    expect(ann[0].entry).toMatchObject({ mode: 'friend', seat: 'host', opponent: 'Bob', rating: null });
    // The entry's ID isn't the game's, which would let anyone who saw a backup into the room.
    expect(ann[0].entry.id).not.toContain(id);
    const replayed = replayEntry(ann[0].entry)!;
    expect(summarizeGame(replayed)).toMatchObject({ mode: 'friend', result: 'won', opponent: 'Bob', difficulty: 'medium' });

    const bob = (await s.played(BOB)).games[0].entry;
    expect(bob).toMatchObject({ mode: 'friend', seat: 'guest', opponent: 'Ann' });
    expect(bob.id).toBe(ann[0].entry.id);
    expect(summarizeGame(replayEntry(bob)!)).toMatchObject({ result: 'lost', difficulty: 'hard' });
    expect((await s.played(CAT)).games).toEqual([]);
  });

  it('include a finished Daily Rush, but not one in progress', async () => {
    const s = setup();
    const ann = s.daily(ANN);
    await ann.start(DAY, 'medium', 'Ann');
    for (const word of ['brick', 'jumpy', 'solve']) {
      s.tick(1000);
      await ann.guess(DAY, word);
    }
    expect((await s.played(ANN)).games).toEqual([]);
    s.tick(1000);
    await ann.guess(DAY, 'night');
    const [game] = (await s.played(ANN)).games;
    expect(game.ref).toBe(DAY);
    expect(game.entry).toMatchObject({ mode: 'daily', day: DAY });
    expect(game.entry.id).not.toContain(ANN);
    expect(summarizeGame(replayEntry(game.entry)!)).toMatchObject({ mode: 'daily', yourGuesses: 4, gaveUp: false });
  });

  it("include a lobby: your own run and everyone's final places, never the others' guesses", async () => {
    const s = setup();
    const words = SECRET_WORDS.slice(0, 4);
    const { lobby } = await s.lobby(ANN).create('Ann', 'medium');
    await s.lobby(BOB).join(lobby.code, 'Bob');
    await s.lobby(ANN).start(lobby.code);
    await s.lobby(BOB).guess(lobby.code, 'crane');
    await s.lobby(ANN).guess(lobby.code, 'storm');
    for (const word of words) {
      s.tick(1000);
      await s.lobby(ANN).guess(lobby.code, word);
    }
    await s.lobby(BOB).giveUp(lobby.code);

    const [ann] = (await s.played(ANN)).games;
    expect(ann.ref).toBe(lobby.code);
    expect(ann.entry).toMatchObject({ mode: 'lobby', kind: 'friends', rating: null });
    if (ann.entry.mode !== 'lobby') throw new Error('not a lobby');
    expect(ann.entry.places.map((p) => [p.name, p.you, p.rank])).toEqual([['Ann', true, 1], ['Bob', false, 2]]);
    expect(summarizeGame(replayEntry(ann.entry)!)).toMatchObject({ place: { rank: 1, of: 2 }, yourGuesses: 5 });
    const [bob] = (await s.played(BOB)).games;
    // The words are no secret once it's over; Ann's guesses and ID stay hers.
    expect(JSON.stringify(bob.entry)).not.toContain('storm');
    expect(JSON.stringify(bob.entry)).not.toContain(ANN);
    expect(summarizeGame(replayEntry(bob.entry)!)).toMatchObject({ place: { rank: 2, of: 2 }, gaveUp: true });
  });

  it('come a page at a time, and only after the cursor', async () => {
    const s = setup();
    const ann = s.daily(ANN);
    await ann.start(DAY, 'medium', 'Ann');
    for (const word of ['brick', 'jumpy', 'solve', 'night']) await ann.guess(DAY, word);
    const first = await s.played(ANN);
    expect(first.games).toHaveLength(1);
    expect(first.next).toBeNull();
    expect((await s.played(ANN, first.cursor)).games).toEqual([]);
  });

  it("stop before a game whose room can't be reached for now, so it comes next time", async () => {
    const s = setup();
    const ann = s.daily(ANN);
    await ann.start(DAY, 'medium', 'Ann');
    const { id } = await s.friend(ANN).create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' });
    await s.friend(BOB).join(id, { name: 'Bob', secret: 'beach', difficulty: 'hard' });
    await s.friend(ANN).concede(id);
    for (const word of ['brick', 'jumpy', 'solve', 'night']) await ann.guess(DAY, word);
    s.busy.rooms = true;
    const first = await s.played(ANN);
    // The friend game ended first; nothing after it comes until it can be read.
    expect(first.games).toEqual([]);
    expect(first.next).toBeNull();
    s.busy.rooms = false;
    const again = await s.played(ANN, first.cursor);
    expect(again.games.map((g) => g.entry.mode)).toEqual(['friend', 'daily']);
  });

  it("include an account's games from its other devices, and never anyone else's", async () => {
    const s = setup();
    // Ann plays a Daily Rush as a guest on her phone, and Bob one of his own.
    for (const [who, name] of [[ANN, 'Ann'], [BOB, 'Bob']]) {
      await s.daily(who).start(DAY, 'medium', name);
      for (const word of ['brick', 'jumpy', 'solve', 'night']) await s.daily(who).guess(DAY, word);
    }
    // Her laptop (CAT's ID here) signs in after her phone: the account now holds both guest IDs.
    await s.signIn(ANN, 'ann@example.com');
    await s.signIn(CAT, 'ann@example.com');
    const laptop = (await s.played(CAT)).games;
    expect(laptop).toHaveLength(1);
    expect(laptop[0].entry.mode).toBe('daily');
    expect(JSON.stringify(laptop)).not.toContain(BOB);
  });

  it('work for an account with more device IDs than D1 can bind', async () => {
    const s = setup();
    await s.daily(ANN).start(DAY, 'medium', 'Ann');
    for (const word of ['brick', 'jumpy', 'solve', 'night']) await s.daily(ANN).guess(DAY, word);
    const { id } = await s.friend(ANN).create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' });
    await s.signIn(ANN, 'ann@example.com');
    // Years of signing in on new browsers: 120 more guest IDs linked to her account.
    s.sqlite.exec(`INSERT INTO guests (id, created_at, last_seen_at, account_id)
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 120)
      SELECT 'old-' || i, 0, 0, (SELECT account_id FROM guests WHERE id = '${ANN}') FROM n`);
    await s.signIn(CAT, 'ann@example.com');
    expect((await s.played(CAT)).games.map((g) => g.entry.mode)).toEqual(['daily']);
    expect((await s.friend(CAT).list()).map((g) => g.id)).toEqual([id]);
    expect((await s.daily(CAT).board(DAY, 'medium')).you).toMatchObject({ rank: 1, guesses: 4 });
    expect((await s.daily(CAT).board(DAY, 'medium', 'friends')).you).toMatchObject({ rank: 1 });
    s.tick(24 * 3600_000);
    expect((await s.daily(CAT).today()).placements).toMatchObject([{ day: DAY, rank: 1 }]);
  });

  it('need a guest ID', async () => {
    const s = setup();
    await expect(s.played('nobody')).rejects.toMatchObject({ code: 'bad-guest-id' });
  });
});
