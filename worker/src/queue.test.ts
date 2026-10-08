import { describe, expect, it, vi } from 'vitest';
import { authApi } from '../../src/app/account';
import { friendApi } from '../../src/app/friendApi';
import { queueApi, QueueApiError, type QueueChoice } from '../../src/app/queueApi';
import { NEW_RATING } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeQueues } from './fakeQueues';
import { fakeRooms } from './fakeRooms';
import { handle, type Env } from './index';
import { allowedGap, pickOpponent, STALE_MS, type Seeker } from './queue';

// Switched off for the launch; these tests are for when it's on (launch.test.ts checks it's refused).
vi.mock('../../src/game/features', () => ({ FEATURES: { randomOpponent: true, ratingBoards: true, competitiveRush: true } }));

/*
 * The matchmaking queue (README "Random opponent"): signed-in players wait
 * with their word, one queue per time control and difficulty, and are
 * paired by rating into a rated game.
 */

const NOW = Date.UTC(2026, 8, 28);
const APP = 'https://app.example';
const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
const TEN_HARD: QueueChoice = { timeControl: '10m', difficulty: 'hard' };

const seeker = (accountId: string, rating: number, joinedAt = NOW): Seeker =>
  ({ accountId, name: accountId, secret: 'storm', rating: { ...NEW_RATING, rating }, joinedAt, seenAt: joinedAt });

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
    };
  };
  return { sqlite, player, fetchFn, tick: (ms: number) => { clock += ms; } };
}

const refusal = (call: Promise<unknown>) => call.then(() => 'accepted', (e: QueueApiError) => e.code);

describe('the queue', () => {
  it('is for signed-in players only', async () => {
    const { fetchFn } = setup();
    const guest = queueApi('https://api.example', { guestId: ANN, token: null }, fetchFn);
    expect(await refusal(guest.join(TEN_HARD, 'Ann', 'storm'))).toBe('signed-out');
  });

  it('offers the live clocks only', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    for (const timeControl of ['1d', '3d'] as const) {
      expect(await refusal(ann.queue.join({ timeControl, difficulty: 'hard' }, 'Ann', 'storm'))).toBe('bad-request');
    }
    expect(await ann.queue.join({ timeControl: '5m', difficulty: 'hard' }, 'Ann', 'storm')).toMatchObject({ state: 'waiting' });
  });

  it('leaves Easy out: matched games are rated', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    expect(await refusal(ann.queue.join({ timeControl: '5m', difficulty: 'easy' }, 'Ann', 'storm'))).toBe('bad-request');
  });

  it('refuses a secret word the rules refuse', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    expect(await refusal(ann.queue.join(TEN_HARD, 'Ann', 'bunny'))).toBe('repeated-letters');
  });

  it('pairs two players in the same queue into a rated game, the one who waited as host', async () => {
    const { player, tick } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const cat = await player(CAT, 'Cat');
    expect(await ann.queue.join(TEN_HARD, 'Ann', 'storm')).toEqual({ state: 'waiting', since: NOW, waiting: 0, now: NOW });
    // Another difficulty is another queue.
    expect(await bob.queue.join({ ...TEN_HARD, difficulty: 'medium' }, 'Bob', 'crane')).toMatchObject({ state: 'waiting' });
    tick(5_000);
    const matched = await cat.queue.join(TEN_HARD, 'Cat', 'beach');
    if (matched.state !== 'matched') throw new Error(`not matched: ${matched.state}`);
    expect(await ann.queue.poll(TEN_HARD)).toEqual(matched);

    const fresh = { rating: 1500, provisional: true, after: null };
    expect(await ann.games.get(matched.gameId)).toMatchObject({
      seat: 'host', state: 'playing', guestName: 'Cat', timeControl: '10m', rated: true, matched: true,
      ratings: { you: fresh, opponent: fresh }, view: { difficulty: 'hard', yourSecret: 'storm', rated: true },
    });
    expect(await cat.games.get(matched.gameId)).toMatchObject({ seat: 'guest', view: { yourSecret: 'beach' } });
    // It's listed as each player's game, from any device.
    expect((await cat.games.list()).map((g) => g.id)).toEqual([matched.gameId]);
    expect(await bob.queue.poll({ ...TEN_HARD, difficulty: 'medium' })).toMatchObject({ state: 'waiting' });
  });

  it('drops a player who stops checking in', async () => {
    const { player, tick } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    await ann.queue.join(TEN_HARD, 'Ann', 'storm');
    tick(STALE_MS);
    expect(await bob.queue.join(TEN_HARD, 'Bob', 'beach')).toMatchObject({ state: 'waiting', waiting: 0 });
    expect(await ann.queue.poll(TEN_HARD)).toEqual({ state: 'idle' });
  });

  it('lets a player leave', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    await ann.queue.join(TEN_HARD, 'Ann', 'storm');
    expect(await ann.queue.leave(TEN_HARD)).toEqual({ state: 'idle' });
    expect(await bob.queue.join(TEN_HARD, 'Bob', 'beach')).toMatchObject({ state: 'waiting', waiting: 0 });
  });

  it('matches by rating, widening the gap while they wait', async () => {
    const { player, tick, sqlite } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    sqlite.prepare(`INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?, '10m', 2000, 60, 0.06, 30, ?)`)
      .run(ann.accountId, NOW);
    await ann.queue.join(TEN_HARD, 'Ann', 'storm');
    expect(await bob.queue.join(TEN_HARD, 'Bob', 'beach')).toMatchObject({ state: 'waiting', waiting: 1 });
    for (let waited = 10_000; waited < 30_000; waited += 10_000) {
      tick(10_000);
      expect(await ann.queue.poll(TEN_HARD)).toMatchObject({ state: 'waiting' });
      expect(await bob.queue.poll(TEN_HARD)).toMatchObject({ state: 'waiting' });
    }
    // After 30 seconds the gap of 500 is allowed.
    tick(10_000);
    const matched = await bob.queue.poll(TEN_HARD);
    expect(matched).toMatchObject({ state: 'matched' });
    expect(await ann.queue.poll(TEN_HARD)).toEqual(matched);
  });
});
