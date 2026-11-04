import { describe, expect, it, vi } from 'vitest';
import { authApi } from '../../src/app/account';
import { friendApi, FriendApiError } from '../../src/app/friendApi';
import { friendsApi } from '../../src/app/friendsApi';
import type { QueueChoice } from '../../src/game';
import { queueApi, QueueApiError } from '../../src/app/queueApi';
import { sharedSummary } from '../../src/app/sharedSummary';
import { COMPUTER_RATINGS, NEW_RATING, updateRating } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeQueues } from './fakeQueues';
import { fakeRooms } from './fakeRooms';
import { handle, type Env } from './index';
import { allowedGap, COMPUTER_TRIES, handleQueue, pickOpponent, STALE_MS, STARTING_MS, type QueueDeps, type Seeker } from './queue';
import { listRatings } from './ratings';
import { memoryStorage } from './fakeRooms';
import { COMPUTER_ID } from './room';

// Switched off for the launch; these tests are for when it's on (launch.test.ts checks it's refused).
vi.mock('../../src/game/features', () => ({ FEATURES: { randomOpponent: true, ratingBoards: ['15m', '10m', '5m', 'correspondence', 'rush'], competitiveRush: true } }));

/*
 * The matchmaking queue (README "Random opponent"): signed-in players wait
 * with their word in the one queue, Live 10 at Medium (Dev Plan item 19p),
 * and are paired by rating into a rated game, or with a computer at their
 * level after 30 seconds.
 */

const NOW = Date.UTC(2026, 8, 28);
const APP = 'https://app.example';
const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
const LADDER: QueueChoice = { timeControl: '10m', difficulty: 'medium' };

const seeker = (accountId: string, rating: number, joinedAt = NOW): Seeker =>
  ({ accountId, name: accountId, secret: 'storm', rating: { ...NEW_RATING, rating }, computer: 0.38, joinedAt, seenAt: joinedAt });

describe('pickOpponent', () => {
  it('picks the closest rating within the gap, never yourself', () => {
    const me = seeker('me', 1500);
    expect(pickOpponent(me, [me, seeker('far', 1800), seeker('near', 1560), seeker('nearer', 1450)], NOW)?.accountId)
      .toBe('nearer');
    expect(pickOpponent(me, [me, seeker('far', 1800)], NOW)).toBeNull();
  });

  it('allows a wider gap the longer either player has waited', () => {
    const waiting = seeker('waiting', 2000, NOW - 30_000);
    expect(allowedGap(seeker('me', 1500), waiting, NOW)).toBe(500);
    expect(pickOpponent(seeker('me', 1500), [waiting], NOW)?.accountId).toBe('waiting');
    expect(pickOpponent(seeker('me', 1500), [waiting], NOW - 1)).toBeNull();
  });

  it('takes the longest waiting when two are as close', () => {
    const early = seeker('early', 1550, NOW - 5_000);
    expect(pickOpponent(seeker('me', 1500), [seeker('late', 1450), early], NOW)?.accountId).toBe('early');
  });
});

function setup() {
  const { db, sqlite } = fakeD1();
  let clock = NOW;
  const rooms = fakeRooms({ db, now: () => clock });
  const emails: string[] = [];
  const outside = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const env: Env = {
    DB: db, GAMES: rooms.namespace, DAILY: undefined as unknown as DurableObjectNamespace,
    LOBBIES: undefined as unknown as DurableObjectNamespace,
    QUEUES: fakeQueues({ env: () => env, now: () => clock }).namespace,
    ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key', EMAIL_FROM: 'play@example.com',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock, outside)) as typeof fetch;

  /** Signs a device in. */
  const player = async (guestId: string, name: string) => {
    await authApi('https://api.example', guestId, fetchFn).sendLink(`${name.toLowerCase()}@example.com`, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    const session = await authApi('https://api.example', guestId, fetchFn).signIn(token);
    const identity = { guestId, token: session.token };
    return {
      name,
      accountId: session.account.id,
      queue: queueApi('https://api.example', identity, fetchFn),
      games: friendApi('https://api.example', identity, fetchFn),
      friends: friendsApi('https://api.example', identity, fetchFn),
    };
  };
  return { db, sqlite, player, fetchFn, rooms, tick: (ms: number) => { clock += ms; } };
}

const refusal = (call: Promise<unknown>) => call.then(() => 'accepted', (e: QueueApiError) => e.code);

describe('the queue', () => {
  it('is for signed-in players only', async () => {
    const { fetchFn } = setup();
    const guest = queueApi('https://api.example', { guestId: ANN, token: null }, fetchFn);
    expect(await refusal(guest.join(LADDER, 'Ann', 'storm'))).toBe('signed-out');
  });

  it('is Live 10 at Medium alone', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    for (const choice of [
      { timeControl: '1d', difficulty: 'medium' }, { timeControl: '5m', difficulty: 'medium' }, { timeControl: '15m', difficulty: 'medium' },
      { timeControl: '10m', difficulty: 'hard' }, { timeControl: '10m', difficulty: 'easy' },
    ] as const) {
      expect(await refusal(ann.queue.join(choice, 'Ann', 'storm'))).toBe('bad-request');
    }
    expect(await ann.queue.join(LADDER, 'Ann', 'storm')).toMatchObject({ state: 'waiting' });
  });

  it('refuses a secret word the rules refuse', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    expect(await refusal(ann.queue.join(LADDER, 'Ann', 'bunny'))).toBe('repeated-letters');
  });

  it('pairs two players in the same queue into a rated game, the one who waited as host', async () => {
    const { player, tick } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const cat = await player(CAT, 'Cat');
    expect(await ann.queue.join(LADDER, 'Ann', 'storm')).toEqual({ state: 'waiting', since: NOW, waiting: 0, now: NOW });
    tick(5_000);
    const matched = await cat.queue.join(LADDER, 'Cat', 'beach');
    if (matched.state !== 'matched') throw new Error(`not matched: ${matched.state}`);
    expect(await ann.queue.poll(LADDER)).toEqual(matched);

    const fresh = { rating: 1500, provisional: true, after: null };
    expect(await ann.games.get(matched.gameId)).toMatchObject({
      seat: 'host', state: 'playing', guestName: 'Cat', timeControl: '10m', rated: true, matched: true, computer: false,
      ratings: { you: fresh, opponent: fresh }, view: { difficulty: 'medium', yourSecret: 'storm', rated: true },
    });
    expect(await cat.games.get(matched.gameId)).toMatchObject({ seat: 'guest', view: { yourSecret: 'beach' } });
    // It's listed as each player's game, from any device.
    expect((await cat.games.list()).map((g) => g.id)).toEqual([matched.gameId]);
    // Bob, who joined after the match, is still waiting.
    expect(await bob.queue.join(LADDER, 'Bob', 'crane')).toMatchObject({ state: 'waiting', waiting: 0 });
  });

  it('drops a player who stops checking in', async () => {
    const { player, tick } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    await ann.queue.join(LADDER, 'Ann', 'storm');
    tick(STALE_MS);
    expect(await bob.queue.join(LADDER, 'Bob', 'beach')).toMatchObject({ state: 'waiting', waiting: 0 });
    expect(await ann.queue.poll(LADDER)).toEqual({ state: 'idle' });
  });

  it('lets a player leave', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    await ann.queue.join(LADDER, 'Ann', 'storm');
    expect(await ann.queue.leave(LADDER)).toEqual({ state: 'idle' });
    expect(await bob.queue.join(LADDER, 'Bob', 'beach')).toMatchObject({ state: 'waiting', waiting: 0 });
  });

  it('matches by rating, widening the gap while they wait', async () => {
    const { player, tick, sqlite } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?, 'correspondence', 2000, 60, 0.06, 30, ?)`)
      .run(ann.accountId, NOW);
    await ann.queue.join(LADDER, 'Ann', 'storm');
    expect(await bob.queue.join(LADDER, 'Bob', 'beach')).toMatchObject({ state: 'waiting', waiting: 1 });
    for (let waited = 10_000; waited < 30_000; waited += 10_000) {
      tick(10_000);
      expect(await ann.queue.poll(LADDER)).toMatchObject({ state: 'waiting' });
      expect(await bob.queue.poll(LADDER)).toMatchObject({ state: 'waiting' });
    }
    // After 30 seconds the gap of 500 is allowed, and a person comes before a computer.
    tick(10_000);
    const matched = await bob.queue.poll(LADDER);
    expect(matched).toMatchObject({ state: 'matched' });
    expect(await ann.queue.poll(LADDER)).toEqual(matched);
  });
});

describe('a computer when nobody is free (Dev Plan item 19p)', () => {
  /** Joins alone and waits out the 30 seconds: the next check-in starts a game against a computer. */
  async function computerGame(setupResult: ReturnType<typeof setup>, ann: Awaited<ReturnType<ReturnType<typeof setup>['player']>>) {
    await ann.queue.join(LADDER, 'Ann', 'storm');
    setupResult.tick(29_999);
    expect(await ann.queue.poll(LADDER)).toMatchObject({ state: 'waiting' });
    setupResult.tick(1);
    const matched = await ann.queue.poll(LADDER);
    if (matched.state !== 'matched') throw new Error(`not matched: ${matched.state}`);
    // Asked again, the match is still there for the page to open.
    expect(await ann.queue.poll(LADDER)).toEqual(matched);
    return matched.gameId;
  }

  const ratedAfter = (sqlite: ReturnType<typeof setup>['sqlite'], gameId: string) =>
    sqlite.prepare('SELECT account_id, pool, rating_before, rating_after, computer_recall FROM rated_games WHERE game_id = ?').all(gameId);

  it('offers a computer after 30 seconds, labelled as one, which plays its turns after a short pause', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const gameId = await computerGame(context, ann);
    const game = await ann.games.get(gameId);
    expect(game).toMatchObject({
      seat: 'host', state: 'playing', guestName: '🤖 Computer', timeControl: '10m', rated: true, matched: true, computer: true,
      ratings: { you: { rating: 1500, provisional: true }, opponent: { rating: 1500, provisional: false } },
      view: { difficulty: 'medium', yourSecret: 'storm', rated: true },
    });
    // The test rooms' random numbers are all 0: Ann goes first, and the computer waits 3 seconds.
    await ann.games.guess(gameId, 'crane');
    context.tick(2_999);
    expect((await ann.games.get(gameId)).view?.theirGuesses).toHaveLength(0);
    context.tick(1);
    expect((await ann.games.get(gameId)).view?.theirGuesses).toHaveLength(1);
    // The room's alarm plays it too, with nobody asking.
    await ann.games.guess(gameId, 'plots');
    context.tick(3_000);
    await context.rooms.runAlarms();
    const room = context.rooms.rooms.get(gameId)!;
    const stored = await room.get<{ record: { moves: { seat: string; kind: string }[] } }>('room');
    expect(stored!.record.moves.filter((m) => m.seat === 'guest' && m.kind === 'guess')).toHaveLength(2);
  });

  it('rates the player alone, by the full change while provisional, and keeps it as their game only', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const gameId = await computerGame(context, ann);
    await ann.games.concede(gameId);
    const expert = { rating: 1500, rd: 50, volatility: 0.06 };
    const full = updateRating(NEW_RATING, [{ opponent: expert, score: 0 }]);
    expect(ratedAfter(context.sqlite, gameId)).toEqual([
      { account_id: ann.accountId, pool: 'correspondence', rating_before: 1500, rating_after: full.rating, computer_recall: 0.38 },
    ]);
    expect(context.sqlite.prepare('SELECT guest_id FROM game_players WHERE game_id = ?').all(gameId))
      .not.toContainEqual({ guest_id: COMPUTER_ID });
    const kept = context.sqlite.prepare('SELECT mode, record FROM games WHERE id = ?').get(gameId) as { mode: string; record: string };
    expect(kept.mode).toBe('friend');
    expect(JSON.parse(kept.record)).toMatchObject({ rated: true, ladder: { computer: 0.38 } });
    expect(await ann.games.get(gameId)).toMatchObject({ state: 'over', ratings: { you: { after: { rating: Math.round(full.rating) } } } });
  });

  it('times out the player in the same request that plays the computer\'s late guess', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const gameId = await computerGame(context, ann);
    await ann.games.guess(gameId, 'crane');
    // Nobody asks and no alarm runs until well past Ann's whole clock after the computer's guess was due.
    context.tick(3_000 + 10 * 60_000 + 1_000);
    const game = await ann.games.get(gameId);
    expect(game.state).toBe('over');
    expect(game.view?.theirGuesses).toHaveLength(1);
    expect(game.view?.outcome).toMatchObject({ reason: 'timed-out' });
  });

  it('rates a computer game by the computer the game started with, even after the table changes', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const gameId = await computerGame(context, ann);
    // As if the table were recalibrated mid-game, leaving this recall out.
    const storage = context.rooms.rooms.get(gameId)!;
    const room = (await storage.get<Record<string, unknown> & { computer: Record<string, unknown> }>('room'))!;
    await storage.put('room', { ...room, computer: { ...room.computer, recall: 0.42, rating: 1520 } });
    await ann.games.concede(gameId);
    expect(ratedAfter(context.sqlite, gameId)).toMatchObject([{ account_id: ann.accountId, computer_recall: 0.42 }]);
    expect(context.sqlite.prepare('SELECT account_id FROM ratings').all()).toEqual([{ account_id: ann.accountId }]);
    expect(context.rooms.notices.map((n) => n.guestId)).not.toContain(COMPUTER_ID);
  });

  it('picks a settled player\'s computer by rating, and moves their rating by half', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const settled = { rating: 1700, rd: 60, volatility: 0.06 };
    context.sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?, 'correspondence', ?, ?, ?, 30, ?)`)
      .run(ann.accountId, settled.rating, settled.rd, settled.volatility, NOW);
    const gameId = await computerGame(context, ann);
    const computer = COMPUTER_RATINGS.find((c) => c.recall === 0.6)!;
    expect(await ann.games.get(gameId)).toMatchObject({ ratings: { opponent: { rating: computer.rating } } });
    await ann.games.concede(gameId);
    const full = updateRating(settled, [{ opponent: { rating: computer.rating, rd: 50, volatility: 0.06 }, score: 0 }]);
    const [row] = ratedAfter(context.sqlite, gameId) as { rating_after: number; computer_recall: number }[];
    expect(row.computer_recall).toBe(0.6);
    expect(row.rating_after).toBeCloseTo(settled.rating + (full.rating - settled.rating) / 2, 6);
  });

  it('picks a provisional player\'s computer by the average their device shared', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const summary = { ...sharedSummary([], [], NOW, () => 0), ladderAverage: 8 };
    context.sqlite.prepare('INSERT INTO shared_profiles (account_id, summary, summary_at) VALUES (?, ?, ?)')
      .run(ann.accountId, JSON.stringify(summary), NOW);
    const gameId = await computerGame(context, ann);
    expect(await ann.games.get(gameId)).toMatchObject({ ratings: { opponent: { rating: COMPUTER_RATINGS.find((c) => c.recall === 0.8)!.rating } } });
  });

  it('matches a person who comes along before the next check-in, rather than a computer', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const bob = await context.player(BOB, 'Bob');
    await ann.queue.join(LADDER, 'Ann', 'storm');
    context.tick(20_000);
    expect(await ann.queue.poll(LADDER)).toMatchObject({ state: 'waiting' });
    // Ann's 30 seconds are up, but Bob joins before her next check-in: Bob's join pairs them.
    context.tick(15_000);
    const matched = await bob.queue.join(LADDER, 'Bob', 'beach');
    if (matched.state !== 'matched') throw new Error('not matched');
    expect(await ann.queue.poll(LADDER)).toEqual(matched);
    expect(await ann.games.get(matched.gameId)).toMatchObject({ guestName: 'Bob', computer: false });
  });

  it('gives a computer when the only other player is too far apart in rating', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const bob = await context.player(BOB, 'Bob');
    context.sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?, 'correspondence', 2200, 60, 0.06, 30, ?)`)
      .run(ann.accountId, NOW);
    await ann.queue.join(LADDER, 'Ann', 'storm');
    await bob.queue.join(LADDER, 'Bob', 'beach');
    context.tick(15_000);
    expect(await ann.queue.poll(LADDER)).toMatchObject({ state: 'waiting' });
    expect(await bob.queue.poll(LADDER)).toMatchObject({ state: 'waiting' });
    // At 30 seconds the gap of 700 is still past the 500 allowed.
    context.tick(15_000);
    const matched = await ann.queue.poll(LADDER);
    if (matched.state !== 'matched') throw new Error('not matched');
    expect(await ann.games.get(matched.gameId)).toMatchObject({ guestName: '🤖 Computer', computer: true });
  });
});

describe('starting a computer game (review round 1)', () => {
  const join = { action: 'join' as const, accountId: 'ann', name: 'Ann', secret: 'storm', rating: NEW_RATING, computer: 0.38 };
  const poll = { action: 'poll' as const, accountId: 'ann' };

  it('keeps the player waiting, out of matching, while their computer game is made', async () => {
    const storage = memoryStorage();
    let finish: (id: string) => void = () => {};
    const started: string[] = [];
    const deps: QueueDeps = {
      startGame: async () => { throw new Error('no person game expected'); },
      startComputerGame: (seeker) => {
        started.push(seeker.accountId);
        return new Promise((resolve) => { finish = resolve; });
      },
    };
    await handleQueue(storage, deps, join, NOW);
    await handleQueue(storage, deps, poll, NOW + 20_000);
    const first = handleQueue(storage, deps, poll, NOW + 30_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A check-in and a join while it's being made both keep waiting, and Bob can't be matched with Ann.
    expect((await handleQueue(storage, deps, poll, NOW + 31_000)).body).toMatchObject({ state: 'waiting' });
    expect((await handleQueue(storage, deps, join, NOW + 31_500)).body).toMatchObject({ state: 'waiting' });
    expect((await handleQueue(storage, deps, { ...join, accountId: 'bob', name: 'Bob' }, NOW + 32_000)).body)
      .toMatchObject({ state: 'waiting' });
    finish('a'.repeat(64));
    expect((await first).body).toEqual({ state: 'matched', gameId: 'a'.repeat(64) });
    expect((await handleQueue(storage, deps, poll, NOW + 33_000)).body).toEqual({ state: 'matched', gameId: 'a'.repeat(64) });
    expect(started).toEqual(['ann']);
  });

  it(`tries ${COMPUTER_TRIES} times, then waits for a person alone`, async () => {
    const storage = memoryStorage();
    let tries = 0;
    const deps: QueueDeps = {
      startGame: async () => 'b'.repeat(64),
      startComputerGame: async () => { tries++; throw new Error('room down'); },
    };
    await handleQueue(storage, deps, join, NOW);
    await handleQueue(storage, deps, poll, NOW + 20_000);
    for (let i = 0; i < COMPUTER_TRIES + 2; i++) {
      expect((await handleQueue(storage, deps, poll, NOW + 30_000 + i * 2_000)).body).toMatchObject({ state: 'waiting' });
    }
    expect(tries).toBe(COMPUTER_TRIES);
  });
});

describe('leaving while a computer game is made (Dev Plan item 19x)', () => {
  const join = { action: 'join' as const, accountId: 'ann', name: 'Ann', secret: 'storm', rating: NEW_RATING, computer: 0.38 };
  const poll = { action: 'poll' as const, accountId: 'ann' };
  const leave = { action: 'leave' as const, accountId: 'ann' };

  /** A queue whose computer game is held until `finish` or `fail` is called. */
  function held() {
    const storage = memoryStorage();
    let finish: (id: string) => void = () => {};
    let fail: () => void = () => {};
    const deps: QueueDeps = {
      startGame: async () => { throw new Error('no person game expected'); },
      startComputerGame: () => new Promise((resolve, reject) => { finish = resolve; fail = () => reject(new Error('room down')); }),
    };
    const starting = async () => {
      await handleQueue(storage, deps, join, NOW);
      await handleQueue(storage, deps, poll, NOW + 20_000);
      const first = handleQueue(storage, deps, poll, NOW + 30_000);
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { first };
    };
    return { storage, deps, starting, finish: (id: string) => finish(id), fail: () => fail() };
  }

  it("doesn't put a player who cancelled back in the queue when the game then fails", async () => {
    const queue = held();
    const { first } = await queue.starting();
    expect((await handleQueue(queue.storage, queue.deps, leave, NOW + 31_000)).body).toEqual({ state: 'idle' });
    queue.fail();
    expect((await first).body).toEqual({ state: 'idle' });
    expect((await handleQueue(queue.storage, queue.deps, poll, NOW + 32_000)).body).toEqual({ state: 'idle' });
  });

  it("doesn't hand a game made after they cancelled to a player who joined again", async () => {
    const queue = held();
    const { first } = await queue.starting();
    await handleQueue(queue.storage, queue.deps, leave, NOW + 31_000);
    expect((await handleQueue(queue.storage, queue.deps, { ...join, secret: 'plant' }, NOW + 32_000)).body)
      .toMatchObject({ state: 'waiting', since: NOW + 32_000 });
    queue.finish('a'.repeat(64));
    expect((await first).body).toMatchObject({ state: 'waiting', since: NOW + 32_000 });
    expect((await handleQueue(queue.storage, queue.deps, poll, NOW + 33_000)).body).toMatchObject({ state: 'waiting', since: NOW + 32_000 });
  });

  it('keeps a player who rejoined in their new place when the first game fails', async () => {
    const queue = held();
    const { first } = await queue.starting();
    await handleQueue(queue.storage, queue.deps, leave, NOW + 31_000);
    await handleQueue(queue.storage, queue.deps, { ...join, secret: 'plant' }, NOW + 32_000);
    queue.fail();
    expect((await first).body).toMatchObject({ state: 'waiting', since: NOW + 32_000 });
    const stored = await queue.storage.get<{ seekers: Seeker[] }>('queue');
    expect(stored?.seekers).toEqual([expect.objectContaining({ accountId: 'ann', secret: 'plant', joinedAt: NOW + 32_000 })]);
    expect(stored?.seekers[0].computerFails).toBeUndefined();
  });

  it('still counts a failure for a player who kept waiting', async () => {
    const queue = held();
    const { first } = await queue.starting();
    queue.fail();
    expect((await first).body).toMatchObject({ state: 'waiting', since: NOW });
    const stored = await queue.storage.get<{ seekers: Seeker[] }>('queue');
    expect(stored?.seekers[0]).toMatchObject({ accountId: 'ann', computerFails: 1 });
    expect(stored?.seekers[0].starting).toBeUndefined();
  });
});

describe('review round 2 fixes', () => {
  it('treats a starting mark left by a stopped queue as gone after its time limit', async () => {
    const storage = memoryStorage();
    const stuck = { ...seeker('ann', 1500, NOW), computer: 0.38, starting: NOW };
    await storage.put('queue', { seekers: [stuck], matches: {} });
    const started: string[] = [];
    const deps: QueueDeps = {
      startGame: async () => { throw new Error('no person game expected'); },
      startComputerGame: async (s) => { started.push(s.accountId); return 'c'.repeat(64); },
    };
    const poll = { action: 'poll' as const, accountId: 'ann' };
    expect((await handleQueue(storage, deps, poll, NOW + STARTING_MS - 1)).body).toMatchObject({ state: 'waiting' });
    expect(started).toEqual([]);
    expect((await handleQueue(storage, deps, poll, NOW + STARTING_MS)).body).toEqual({ state: 'matched', gameId: 'c'.repeat(64) });
  });

  it('lists only the shown rating pools, never the retired clock ones', async () => {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    for (const [pool, games] of [['15m', 40], ['correspondence', 5], ['rush', 3]] as const) {
      context.sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?, ?, 1600, 80, 0.06, ?, ?)`)
        .run(ann.accountId, pool, games, NOW);
    }
    expect((await listRatings(context.db, ann.accountId, NOW)).map((r) => r.pool).sort()).toEqual(['correspondence', 'rush']);
  });
});

describe('friending your ladder opponent (Dev Plan item 19e)', () => {
  const gameRefusal = (call: Promise<unknown>) => call.then(() => 'accepted', (e: FriendApiError) => e.code);

  /** Ann and Cat matched in the ladder: Ann waited, so she's the host. */
  async function ladderGame() {
    const context = setup();
    const ann = await context.player(ANN, 'Ann');
    const cat = await context.player(CAT, 'Cat');
    await ann.queue.join(LADDER, 'Ann', 'storm');
    const matched = await cat.queue.join(LADDER, 'Cat', 'beach');
    if (matched.state !== 'matched') throw new Error(`not matched: ${matched.state}`);
    return { ...context, ann, cat, gameId: matched.gameId };
  }

  it('is offered once the game is over, never during it, and sends a request the other player answers', async () => {
    const { ann, cat, gameId } = await ladderGame();
    expect(await ann.games.get(gameId)).toMatchObject({ state: 'playing', ladderFriend: null });
    expect(await gameRefusal(ann.games.addFriend(gameId))).toBe('not-over');
    expect((await ann.friends.list()).sent).toEqual([]);

    await ann.games.concede(gameId);
    expect(await ann.games.get(gameId)).toMatchObject({ state: 'over', ladderFriend: 'none', opponentCode: null });
    expect(await cat.games.get(gameId)).toMatchObject({ ladderFriend: 'none' });

    // Neither had opened their friends list, so neither had a code: the request still shows on both.
    expect(await ann.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'sent', opponentCode: null });
    const [annCode, catCode] = [(await ann.friends.list()).code, (await cat.friends.list()).code];
    expect((await ann.friends.list()).sent.map((f) => f.code)).toEqual([catCode]);
    expect((await cat.friends.list()).received.map((f) => f.code)).toEqual([annCode]);
    expect(await cat.games.get(gameId)).toMatchObject({ ladderFriend: 'received' });
    // Asking again changes nothing.
    expect(await ann.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'sent' });

    // Cat accepts from the game: friends, and Ann's name now opens her profile.
    expect(await cat.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'friends', opponentCode: annCode });
    expect((await ann.friends.list()).friends.map((f) => f.code)).toEqual([catCode]);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'friends', opponentCode: catCode });
  });

  it('can be declined from the friends list, and then rests for a week (the owner, review of PR #75)', async () => {
    const { ann, cat, gameId, tick, sqlite } = await ladderGame();
    await cat.games.concede(gameId);
    await ann.games.addFriend(gameId);
    const annCode = (await ann.friends.list()).code;
    expect((await cat.friends.remove(annCode)).received).toEqual([]);
    expect((await ann.friends.list()).sent).toEqual([]);
    // Ann's game stops offering Add friend for a week, and refuses one sent anyway; Cat can still ask Ann.
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'declined' });
    expect(await gameRefusal(ann.games.addFriend(gameId))).toBe('declined');
    expect((await cat.friends.list()).received).toEqual([]);
    expect(await cat.games.get(gameId)).toMatchObject({ ladderFriend: 'none' });
    tick(7 * 24 * 60 * 60 * 1000 - 1);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'declined' });
    tick(1);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'none' });
    expect(await ann.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'sent' });
    // A request that Cat sends Ann in the week is still Ann's to accept from the game.
    await cat.friends.remove(annCode);
    await cat.friends.add(annCode);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'received' });
    expect(await ann.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'friends' });
    // One row per sender and player, however often they declined.
    expect(sqlite.prepare('SELECT sender_id FROM friend_declines').all()).toHaveLength(1);
  });

  it('is never offered against a computer, nor to anyone outside the game', async () => {
    const context = await ladderGame();
    const bob = await context.player(BOB, 'Bob');
    await context.ann.games.concede(context.gameId);
    expect(await gameRefusal(bob.games.addFriend(context.gameId))).toBe('not-a-player');

    await bob.queue.join(LADDER, 'Bob', 'crane');
    context.tick(29_999);
    await bob.queue.poll(LADDER);
    context.tick(1);
    const vsComputer = await bob.queue.poll(LADDER);
    if (vsComputer.state !== 'matched') throw new Error(`not matched: ${vsComputer.state}`);
    await bob.games.concede(vsComputer.gameId);
    expect(await bob.games.get(vsComputer.gameId)).toMatchObject({ computer: true, state: 'over', ladderFriend: null });
    expect(await gameRefusal(bob.games.addFriend(vsComputer.gameId))).toBe('bad-request');
  });

  it("isn't offered in a game that didn't come from the ladder", async () => {
    const { ann, cat } = await ladderGame();
    const invite = await ann.games.create({ name: 'Ann', secret: 'storm', difficulty: 'medium', timeControl: '1d' });
    await cat.games.join(invite.id, { name: 'Cat', secret: 'beach', difficulty: 'medium' });
    await ann.games.concede(invite.id);
    expect(await ann.games.get(invite.id)).toMatchObject({ state: 'over', ladderFriend: null });
    expect(await gameRefusal(ann.games.addFriend(invite.id))).toBe('bad-request');
  });

  it("doesn't rest Add friend after a decline of a request by email, which would tell whose email it was", async () => {
    const { ann, cat, gameId } = await ladderGame();
    await ann.friends.requestByEmail('cat@example.com');
    const annCode = (await ann.friends.list()).code;
    await cat.friends.remove(annCode);
    await ann.games.concede(gameId);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'none' });
    // One request from the game reaches her; declining that one rests it as usual.
    expect(await ann.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'sent' });
    await cat.friends.remove(annCode);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'declined' });
  });

  it("keeps a request sent by email out of sight, so the game can't tell whose email it was", async () => {
    const { ann, cat, gameId } = await ladderGame();
    await ann.friends.requestByEmail('cat@example.com');
    await ann.games.concede(gameId);
    expect(await ann.games.get(gameId)).toMatchObject({ ladderFriend: 'none' });
    // Cat sees it, as she would on her list.
    expect(await cat.games.get(gameId)).toMatchObject({ ladderFriend: 'received' });
    // Adding her from the game starts a request as if the email never was.
    expect(await ann.games.addFriend(gameId)).toMatchObject({ ladderFriend: 'sent' });
    expect((await ann.friends.list()).sent.map((f) => f.code)).toEqual([(await cat.friends.list()).code]);
  });
});
