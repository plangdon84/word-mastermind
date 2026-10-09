import { describe, expect, it, vi } from 'vitest';
import { authApi } from '../../src/app/account';
import { dailyApi, DailyApiError } from '../../src/app/dailyApi';
import { friendsApi } from '../../src/app/friendsApi';
import { fetchRatingBoard, LeaderboardError, parseRatingBoard, type Circle } from '../../src/app/leaderboardsApi';
import { syncApi } from '../../src/app/syncApi';
import { DAY_MS, type RatingPool } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { handle, type Env } from './index';

// Switched off for the launch; these tests are for when it's on (launch.test.ts checks it's refused).
vi.mock('../../src/game/features', () => ({ FEATURES: { randomOpponent: true, ratingBoards: true, competitiveRush: true } }));

/*
 * The Leaderboards page (README "Leaderboards"): a board per rating pool,
 * and the Daily Rush board narrowed to you and your friends.
 */

// Halloween 2026 has a Daily Rush (a test set, `testThemes.ts`).
const DAY = '2026-10-31';
const NOW = Date.UTC(2026, 9, 31, 12);
const APP = 'https://app.example';
const API = 'https://api.example';
const guestId = (n: number) => `0f8b6c2e-5d4a-4b1c-9e3f-${String(n).padStart(12, '0')}`;

function setup() {
  const { db, sqlite } = fakeD1({ dailyThemes: true });
  const emails: string[] = [];
  const outside = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const none = undefined as unknown as DurableObjectNamespace;
  const env: Env = {
    DB: db, GAMES: none, DAILY: none, LOBBIES: none, QUEUES: none, ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key',
    EMAIL_FROM: 'play@example.com',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, NOW, outside)) as typeof fetch;
  let accounts = 0;

  /** Signs a device in with a synced name; its account's ID is `id`. */
  const player = async (name: string) => {
    const device = guestId(++accounts);
    await authApi(API, device, fetchFn).sendLink(`${name.toLowerCase()}@example.com`, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    const session = await authApi(API, device, fetchFn).signIn(token);
    const identity = { guestId: device, token: session.token };
    await syncApi(API, identity, fetchFn).putProfile({
      guestName: 'Guest-1234', name, country: null, memberSince: NOW,
      settings: { difficulty: 'medium', newestFirst: { easy: false, medium: false, hard: false, extreme: false }, showTutorial: true, shareMarks: true },
    });
    return {
      id: session.account.id,
      identity,
      friends: friendsApi(API, identity, fetchFn),
      board: (pool: RatingPool, circle: Circle = 'everyone') => fetchRatingBoard(API, identity, pool, circle, fetchFn),
      daily: dailyApi(API, identity, fetchFn),
    };
  };
  const rate = (accountId: string, pool: RatingPool, rating: number, rd: number, games: number, ratedAt = NOW) =>
    sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?, ?, ?, ?, 0.06, ?, ?)`)
      .run(accountId, pool, rating, rd, games, ratedAt);
  const guest = (n: number) => ({ guestId: guestId(1000 + n), token: null });
  return { sqlite, fetchFn, player, rate, guest };
}

/** The error code a call rejects with. */
async function refusal(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof LeaderboardError || e instanceof DailyApiError) return e.code;
    throw e;
  }
  throw new Error('the call was accepted');
}

describe('a rating board', () => {
  it('lists established ratings, highest first, ties sharing a rank, and hides provisional ones', async () => {
    const { player, rate, guest, fetchFn } = setup();
    const ann = await player('Ann');
    const bob = await player('Bob');
    const cat = await player('Cat');
    const dan = await player('Dan');
    rate(ann.id, '10m', 1600.4, 80, 20);
    rate(bob.id, '10m', 1712, 90, 31);
    rate(cat.id, '10m', 1599.6, 70, 12);
    rate(dan.id, '10m', 1900, 200, 3);
    const board = await fetchRatingBoard(API, guest(1), '10m', 'everyone', fetchFn);
    expect(board).toEqual({
      pool: '10m', circle: 'everyone', total: 3, you: null,
      top: [
        { rank: 1, name: 'Bob', rating: 1712, games: 31, you: false, friendCode: null },
        { rank: 2, name: 'Ann', rating: 1600, games: 20, you: false, friendCode: null },
        { rank: 2, name: 'Cat', rating: 1600, games: 12, you: false, friendCode: null },
      ],
    });
    // Other pools are apart; rows never carry an account's ID.
    expect((await ann.board('5m')).top).toEqual([]);
    expect(JSON.stringify(board)).not.toContain(ann.id);
  });

  it("has Competitive Rush's board, apart from the PvP pools", async () => {
    const { player, rate } = setup();
    const ann = await player('Ann');
    const bob = await player('Bob');
    rate(ann.id, 'rush', 1650, 90, 14);
    rate(bob.id, '10m', 1712, 90, 31);
    expect(await ann.board('rush')).toMatchObject({
      pool: 'rush', total: 1, top: [{ rank: 1, name: 'Ann', rating: 1650, games: 14, you: true, friendCode: null }],
    });
  });

  it('gives your place, or how many more rated games until you are listed', async () => {
    const { player, rate } = setup();
    const ann = await player('Ann');
    const bob = await player('Bob');
    const cat = await player('Cat');
    rate(ann.id, 'correspondence', 1600, 80, 20);
    rate(bob.id, 'correspondence', 1500, 200, 4);
    expect((await ann.board('correspondence')).you).toEqual({
      rating: { rating: 1600, provisional: false }, games: 20, rank: 1, gamesToList: 0,
    });
    expect((await bob.board('correspondence')).you).toEqual({
      rating: { rating: 1500, provisional: true }, games: 4, rank: null, gamesToList: 9,
    });
    expect((await cat.board('correspondence')).you).toEqual({
      rating: { rating: 1500, provisional: true }, games: 0, rank: null, gamesToList: 11,
    });
  });

  it('drops a rating gone provisional after a long break', async () => {
    const { player, rate } = setup();
    const ann = await player('Ann');
    rate(ann.id, '15m', 1600, 100, 20, NOW - 30 * 7 * DAY_MS);
    const board = await ann.board('15m');
    expect(board.top).toEqual([]);
    expect(board.you).toMatchObject({ rank: null, rating: { provisional: true } });
    expect(board.you!.gamesToList).toBeGreaterThan(0);
  });

  it('narrows to you and your friends, signed in', async () => {
    const { player, rate, guest, fetchFn } = setup();
    const ann = await player('Ann');
    const bob = await player('Bob');
    const cat = await player('Cat');
    for (const [p, rating] of [[ann, 1500], [bob, 1700], [cat, 1800]] as const) rate(p.id, '5m', rating, 60, 30);
    await ann.friends.add((await bob.friends.list()).code);
    // A request isn't a friendship until it's accepted.
    expect((await ann.board('5m', 'friends')).top.map((r) => r.name)).toEqual(['Ann']);
    await bob.friends.add((await ann.friends.list()).code);
    const board = await ann.board('5m', 'friends');
    expect(board.top).toEqual([
      { rank: 1, name: 'Bob', rating: 1700, games: 30, you: false, friendCode: (await bob.friends.list()).code },
      { rank: 2, name: 'Ann', rating: 1500, games: 30, you: true, friendCode: null },
    ]);
    expect(board).toMatchObject({ circle: 'friends', total: 2, you: { rank: 2 } });
    // Only the Friends view says who's a friend.
    expect((await ann.board('5m')).top.map((r) => r.friendCode)).toEqual([null, null, null]);
    expect((await ann.board('5m')).you).toMatchObject({ rank: 3 });
    expect(await refusal(fetchRatingBoard(API, guest(1), '5m', 'friends', fetchFn))).toBe('signed-out');
  });

  it('refuses a pool or circle it does not know', async () => {
    const { guest, fetchFn } = setup();
    const headers = { 'x-guest-id': guest(1).guestId };
    expect((await fetchFn(`${API}/api/leaderboards/ratings?pool=1d`, { headers })).status).toBe(400);
    expect((await fetchFn(`${API}/api/leaderboards/ratings?pool=5m&circle=all`, { headers })).status).toBe(400);
    expect((await fetchFn(`${API}/api/leaderboards/other`, { headers })).status).toBe(404);
  });

  it('is read defensively', () => {
    expect(parseRatingBoard({ pool: '5m', circle: 'everyone', total: 0, top: [], you: null })).not.toBeNull();
    expect(parseRatingBoard({ pool: '1d', circle: 'everyone', total: 0, top: [], you: null })).toBeNull();
    expect(parseRatingBoard({ pool: '5m', circle: 'everyone', total: 1, top: [{ rank: 1, name: 'Ann' }], you: null })).toBeNull();
  });
});

describe('the Daily Rush board, with friends', () => {
  it('ranks you among your friends, including runs from before they signed in', async () => {
    const { sqlite, player, guest, fetchFn } = setup();
    const ann = await player('Ann');
    const bob = await player('Bob');
    const cat = await player('Cat');
    await ann.friends.add((await bob.friends.list()).code);
    await bob.friends.add((await ann.friends.list()).code);
    const result = sqlite.prepare(
      `INSERT INTO daily_results (day, player_id, difficulty, name, guesses, ms, finished_at) VALUES (?, ?, 'medium', ?, ?, 60000, ?)`,
    );
    result.run(DAY, ann.id, 'Ann', 30, NOW);
    // Bob's run was on his device, as a guest, before he signed in.
    result.run(DAY, bob.identity.guestId, 'Bob', 40, NOW);
    result.run(DAY, cat.id, 'Cat', 20, NOW);
    result.run(DAY, guest(1).guestId, 'Dee', 25, NOW);

    const everyone = await ann.daily.board(DAY, 'medium');
    expect(everyone.top.map((r) => [r.rank, r.name])).toEqual([[1, 'Cat'], [2, 'Dee'], [3, 'Ann'], [4, 'Bob']]);
    expect(everyone.you).toMatchObject({ rank: 3, total: 4 });

    const friends = await ann.daily.board(DAY, 'medium', 'friends');
    expect(friends.top.map((r) => [r.rank, r.name, r.you])).toEqual([[1, 'Ann', true], [2, 'Bob', false]]);
    expect(friends).toMatchObject({ total: 2, you: { rank: 1, total: 2, behind: 1 } });

    expect(await refusal(dailyApi(API, guest(1), fetchFn).board(DAY, 'medium', 'friends'))).toBe('signed-out');
  });
});
