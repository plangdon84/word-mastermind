import { describe, expect, it, vi } from 'vitest';
import { authApi } from '../../src/app/account';
import { lobbyApi, LobbyApiError } from '../../src/app/lobbyApi';
import { fetchRatings } from '../../src/app/ratingsApi';
import {
  createCompetitiveLobby, joinLobby, playLobby, SECRET_WORDS, startLobby, type LobbyRecord, type LobbyResult,
} from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeLobbies } from './fakeLobbies';
import { handle, type Env } from './index';
import { saveFinishedLobby } from './lobbyRoom';

// Switched off for the launch; these tests are for when it's on (launch.test.ts checks it's refused).
vi.mock('../../src/game/features', () => ({ FEATURES: { randomOpponent: true, ratingBoards: true, competitiveRush: true } }));

/*
 * Competitive Rush (README "Rush modes"): a lobby where each player sets a
 * word and solves the others', computers filling the empty seats. It's
 * rated, so only signed-in players can play.
 */

const NOW = Date.UTC(2026, 9, 3, 18);
const APP = 'https://app.example';
const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';

function setup() {
  const { db, sqlite } = fakeD1();
  let clock = NOW;
  const lobbies = fakeLobbies({ db, now: () => clock });
  const emails: string[] = [];
  const outside = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    emails.push((JSON.parse(String(init?.body)) as { text: string }).text);
    return new Response('{}');
  }) as typeof fetch;
  const env: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace,
    LOBBIES: lobbies.namespace, QUEUES: undefined as unknown as DurableObjectNamespace,
    ALLOWED_ORIGINS: APP, RESEND_API_KEY: 'key', EMAIL_FROM: 'play@example.com',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock, outside)) as typeof fetch;

  /** Signs a device in by an emailed link. */
  const player = async (guestId: string, name: string) => {
    clock += 60_000;
    await authApi('https://api.example', guestId, fetchFn).sendLink(`${name.toLowerCase()}@example.com`, APP);
    const token = /\?login=([\w-]+)/.exec(emails[emails.length - 1])![1];
    const session = await authApi('https://api.example', guestId, fetchFn).signIn(token);
    const id = { guestId, token: session.token };
    return { session, lobbies: lobbyApi('https://api.example', id, fetchFn), ratings: () => fetchRatings('https://api.example', id, fetchFn) };
  };
  const guest = (guestId: string) => lobbyApi('https://api.example', { guestId, token: null }, fetchFn);
  return { sqlite, player, guest, lobbies, tick: (ms: number) => { clock += ms; } };
}

/** The error a call rejects with. */
async function refusal(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof LobbyApiError) return e.code;
    throw e;
  }
  throw new Error('the call was accepted');
}

describe('a Competitive Rush lobby', () => {
  it('is for signed-in players only, each with a secret word', async () => {
    const { player, guest } = setup();
    expect(await refusal(guest(CAT).create('Cat', 'medium', 'crane'))).toBe('account-needed');
    const ann = await player(ANN, 'Ann');
    expect(await refusal(ann.lobbies.create('Ann', 'medium', 'geese'))).toBe('repeated-letters');
    const { lobby } = await ann.lobbies.create('Ann', 'medium', 'crane');
    expect(lobby).toMatchObject({ kind: 'competitive', yourWord: 'crane', settings: { computers: 4 } });
    expect(await refusal(guest(CAT).join(lobby.code, 'Cat', 'storm'))).toBe('account-needed');
    const bob = await player(BOB, 'Bob');
    expect(await refusal(bob.lobbies.join(lobby.code, 'Bob'))).toBe('need-word');
    const joined = (await bob.lobbies.join(lobby.code, 'Bob', 'beach')).lobby;
    expect(joined).toMatchObject({ yourWord: 'beach', settings: { computers: 3 } });
    expect((await bob.lobbies.setWord(lobby.code, 'Storm')).lobby.yourWord).toBe('storm');
    // Nobody sees anyone else's word.
    expect((await ann.lobbies.get(lobby.code)).lobby.yourWord).toBe('crane');
    expect(JSON.stringify(await ann.lobbies.get(lobby.code))).not.toContain('storm');
  });

  it("gives each player the others' words: theirs, and a computer's for each empty seat", async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const { code } = (await ann.lobbies.create('Ann', 'medium', 'crane')).lobby;
    await bob.lobbies.join(code, 'Bob', 'storm');
    const { lobby } = await ann.lobbies.start(code);
    expect(lobby.players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Computer 1', 'Computer 2', 'Computer 3']);
    expect(lobby.run?.setBy).toEqual(['Bob', 'Computer 1', 'Computer 2', 'Computer 3']);
    // Ann's first word is Bob's.
    const found = (await ann.lobbies.guess(code, 'storm')).lobby;
    expect(found.run?.words[0]).toMatchObject({ word: 'storm', outcome: 'solved' });
    // With `random` always 0, the computers' words are the first on the secret list.
    const bobs = (await bob.lobbies.guess(code, SECRET_WORDS[0])).lobby;
    expect(bobs.run?.words.map((w) => w.outcome)).toEqual([null, null, null, null]);
    expect((await bob.lobbies.guess(code, 'crane')).lobby.run?.words[0].outcome).toBe('solved');
  });

  it('refuses to start while two players share a word, until one changes it', async () => {
    const { player } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const { code } = (await ann.lobbies.create('Ann', 'medium', 'crane')).lobby;
    await bob.lobbies.join(code, 'Bob', 'crane');
    expect(await refusal(ann.lobbies.start(code))).toBe('same-words');
    expect((await bob.lobbies.setWord(code, 'storm')).lobby.yourWord).toBe('storm');
    expect((await ann.lobbies.start(code)).lobby.state).toBe('playing');
  });
});

describe('rating', () => {
  const MINUTES = 30 * 60_000;

  it('rates each pair of people by their places once the Rush is over, leaving computers out', async () => {
    const { player, sqlite, tick, lobbies } = setup();
    const ann = await player(ANN, 'Ann');
    const bob = await player(BOB, 'Bob');
    const { code } = (await ann.lobbies.create('Ann', 'medium', 'crane')).lobby;
    await bob.lobbies.join(code, 'Bob', 'storm');
    await ann.lobbies.start(code);
    // Ann finds Bob's word and gives up the rest; Bob gives up at once.
    await ann.lobbies.guess(code, 'storm');
    await ann.lobbies.giveUp(code);
    const done = await bob.lobbies.giveUp(code);
    expect(done.rating).toBeNull();
    // The computers play on until the time is up.
    tick(MINUTES);
    await lobbies.runAlarms();
    const over = await ann.lobbies.get(code);
    expect(over.lobby.state).toBe('over');
    expect(over.rating).toMatchObject({ rating: 1500, provisional: true, after: { provisional: true } });
    expect(over.rating!.after!.rating).toBeGreaterThan(1500);
    const bobs = await bob.lobbies.get(code);
    expect(bobs.rating!.after!.rating).toBe(1500 - (over.rating!.after!.rating - 1500));
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM rated_games WHERE pool = 'rush'").get()).toEqual({ n: 2 });
    expect(await ann.ratings()).toEqual([{ pool: 'rush', rating: over.rating!.after!.rating, provisional: true, games: 1 }]);
    // Asking again doesn't rate it again.
    await ann.lobbies.get(code);
    expect(await bob.ratings()).toMatchObject([{ pool: 'rush', games: 1 }]);
  });

  it('leaves a Rush against computers alone unrated', async () => {
    const { player, tick, lobbies } = setup();
    const ann = await player(ANN, 'Ann');
    const { code } = (await ann.lobbies.create('Ann', 'medium', 'crane')).lobby;
    await ann.lobbies.start(code);
    await ann.lobbies.giveUp(code);
    tick(MINUTES);
    await lobbies.runAlarms();
    expect(await ann.lobbies.get(code)).toMatchObject({ lobby: { state: 'over' }, rating: null });
    expect(await ann.ratings()).toEqual([]);
  });
});

describe('saving a rated game', () => {
  const ok = (result: LobbyResult): LobbyRecord => {
    if (!result.ok) throw new Error(result.error);
    return result.lobby;
  };
  /** Ann and Bob (by account ID), both given up at once, with computers who haven't finished. */
  const finished = () => {
    let lobby = ok(createCompetitiveLobby('ABCDEF', { id: 'ann', name: 'Ann', word: 'crane' }, 'medium', NOW));
    lobby = ok(joinLobby(lobby, { id: 'bob', name: 'Bob', word: 'storm' }, NOW));
    lobby = ok(startLobby(lobby, 'ann', ['beach', 'light', 'ghost', 'moist', 'chair'], NOW, () => 0));
    lobby = ok(playLobby(lobby, 'ann', { kind: 'guess', word: 'storm' }, NOW + 1000));
    for (const id of ['ann', 'bob']) lobby = ok(playLobby(lobby, id, { kind: 'give-up' }, NOW + 2000));
    return lobby;
  };

  it('rates it whole or not at all, and once, however often it is saved', async () => {
    const { db, sqlite } = fakeD1();
    const account = (id: string) =>
      sqlite.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)').run(id, `${id}@example.com`, NOW);
    for (const id of ['ann', 'bob']) {
      sqlite.prepare('INSERT INTO guests (id, created_at, last_seen_at) VALUES (?, ?, ?)').run(id, NOW, NOW);
    }
    const lobby = finished();
    const endedAt = NOW + 30 * 60_000;
    // Bob's account is missing, so storing his rating fails: Ann's mustn't stay behind.
    account('ann');
    await expect(saveFinishedLobby(db, lobby, endedAt)).rejects.toThrow();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ratings').get()).toEqual({ n: 0 });
    // Saving again (the lobby tries on its next request) rates it.
    account('bob');
    const changes = await saveFinishedLobby(db, lobby, endedAt);
    expect(changes!.ann.after.rating).toBeGreaterThan(1500);
    expect(changes!.bob.after.rating).toBeLessThan(1500);
    // And again returns the same changes, without rating it twice.
    const again = await saveFinishedLobby(db, lobby, endedAt);
    expect(again!.ann.after.rating).toBe(changes!.ann.after.rating);
    expect(again!.ann.before).toMatchObject({ rating: 1500, rd: 350 });
    expect(sqlite.prepare("SELECT games FROM ratings WHERE account_id = 'ann'").get()).toEqual({ games: 1 });
  });
});
