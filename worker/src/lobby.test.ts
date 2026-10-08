import { describe, expect, it } from 'vitest';
import { lobbyApi, LobbyApiError, type LobbyApi } from '../../src/app/lobbyApi';
import { SECRET_WORDS } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { fakeLobbies } from './fakeLobbies';
import { handle, type Env } from './index';

const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
const START = Date.UTC(2026, 9, 3, 18);
/** With `random` always 0, the words are the first 4 on the secret list. */
const WORDS = SECRET_WORDS.slice(0, 4);
const NO_COMPUTERS = { computers: 0, strength: 'skilled' } as const;

function setup() {
  const { db, sqlite } = fakeD1();
  let clock = START;
  const lobbies = fakeLobbies({ db, now: () => clock });
  const env: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace,
    LOBBIES: lobbies.namespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock)) as typeof fetch;
  const as = (guestId: string): LobbyApi => lobbyApi('https://api.example', { guestId, token: null }, fetchFn);
  return { sqlite, as, lobbies, tick: (ms: number) => { clock += ms; } };
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

/** Ann opens a lobby and Bob joins it. */
async function opened(setupResult = setup()) {
  const { as } = setupResult;
  const ann = as(ANN);
  const bob = as(BOB);
  const { lobby } = await ann.create('Ann', 'medium');
  await bob.join(lobby.code, 'Bob');
  return { ...setupResult, ann, bob, code: lobby.code };
}

describe('a lobby', () => {
  it('opens with a join code, and others join by it', async () => {
    const { ann, bob, code, as } = await opened();
    const view = (await ann.get(code)).lobby;
    expect(view).toMatchObject({
      code, state: 'open', host: true, joined: true, settings: { difficulty: 'medium', minutes: 30 },
      players: [{ name: 'Ann', you: true }, { name: 'Bob', you: false }],
    });
    expect((await bob.get(code)).lobby).toMatchObject({ host: false, joined: true });
    expect((await as(CAT).get(code)).lobby).toMatchObject({ joined: false, hostName: 'Ann' });
    expect(await refusal(as(CAT).get('ZZZZZZ'))).toBe('not-found');
  });

  it('refuses names that would be shown to others if they are offensive', async () => {
    const { as, code } = await opened();
    expect(await refusal(as(CAT).join(code, 'Shithead'))).toBe('offensive-name');
  });

  it('opens at Easy with a duration that is one of the choices', async () => {
    const { as } = setup();
    const { lobby } = await as(ANN).create('Ann', 'easy');
    expect(lobby.settings).toMatchObject({ difficulty: 'easy', minutes: 20 });
    expect((await as(ANN).settings(lobby.code, { ...NO_COMPUTERS, difficulty: 'easy', minutes: 20 })).lobby.settings.minutes).toBe(20);
  });

  it('lets only the host change settings, start or close it', async () => {
    const { ann, bob, code } = await opened();
    expect(await refusal(bob.settings(code, { ...NO_COMPUTERS, difficulty: 'hard', minutes: 20 }))).toBe('not-host');
    expect((await ann.settings(code, { ...NO_COMPUTERS, difficulty: 'extreme', minutes: 50 })).lobby.settings)
      .toEqual({ ...NO_COMPUTERS, difficulty: 'extreme', minutes: 50 });
    expect(await refusal(ann.settings(code, { ...NO_COMPUTERS, difficulty: 'hard', minutes: 7 }))).toBe('bad-settings');
    expect(await refusal(bob.start(code))).toBe('not-host');
    expect(await refusal(bob.close(code))).toBe('not-host');
    expect((await bob.leave(code)).lobby.joined).toBe(false);
    expect(await refusal(ann.start(code))).toBe('need-players');
    expect((await ann.close(code)).lobby.state).toBe('closed');
  });
});

describe('the game', () => {
  it("records Easy's suggestions for each player, never shown to the others", async () => {
    const { ann, code, tick } = await opened();
    expect(await refusal(ann.suggest(code, 'crane'))).toBe('not-started');
    await ann.start(code);
    tick(1000);
    expect(await refusal(ann.suggest(code, 'crane'))).toBe('not-easy');
    const easy = await opened();
    await easy.ann.settings(easy.code, { ...NO_COMPUTERS, difficulty: 'easy', minutes: 30 });
    await easy.ann.start(easy.code);
    easy.tick(1000);
    const suggested = (await easy.ann.suggest(easy.code, 'crane')).lobby;
    expect(suggested.run?.words[0]).toMatchObject({ suggested: 1, guesses: [] });
    expect((await easy.bob.get(easy.code)).lobby.run?.words[0]).toMatchObject({ suggested: 0 });
  });

  it('gives everyone the same words on one clock, found one at a time', async () => {
    const { ann, bob, code, as, tick } = await opened();
    const started = (await ann.start(code)).lobby;
    expect(started).toMatchObject({ state: 'playing', startedAt: START, endsAt: START + 30 * 60_000, words: null });
    expect(await refusal(as(CAT).join(code, 'Cat'))).toBe('already-started');

    tick(5000);
    const afterAnn = (await ann.guess(code, WORDS[0])).lobby;
    expect(afterAnn.run?.words[0]).toMatchObject({ word: WORDS[0], outcome: 'solved' });
    expect(afterAnn.run?.current).toBe(1);
    // Bob sees that Ann found one, but not the word or her guesses.
    const bobs = (await bob.get(code)).lobby;
    expect(bobs.run?.words[0]).toMatchObject({ word: null, guesses: [] });
    expect(bobs.standings?.find((p) => p.name === 'Ann')).toMatchObject(
      { rank: null, words: [{ outcome: 'solved', guesses: 1, counted: null }, {}, {}, {}] });
    expect(JSON.stringify(bobs)).not.toContain(WORDS[0]);
    expect(await refusal(bob.guess(code, 'zzzzz'))).toBe('not-in-word-list');
  });

  it('ends when everyone has finished, and keeps the game in D1', async () => {
    const { ann, bob, code, sqlite, tick } = await opened();
    await ann.start(code);
    for (const word of WORDS) {
      tick(1000);
      await ann.guess(code, word);
    }
    await bob.giveUpWord(code);
    expect((await bob.get(code)).lobby.run?.words[0].word).toBeNull();
    const over = (await bob.giveUp(code)).lobby;
    expect(over.state).toBe('over');
    expect(over.words).toEqual(WORDS);
    expect(over.run?.words.map((w) => w.word)).toEqual(WORDS);
    const games = sqlite.prepare("SELECT mode, started_at, finished_at FROM games WHERE mode = 'lobby'").all();
    expect(games).toEqual([{ mode: 'lobby', started_at: START, finished_at: START + 4000 }]);
    const players = sqlite.prepare('SELECT guest_id FROM game_players ORDER BY guest_id').all();
    expect(players.map((p) => p.guest_id)).toEqual([BOB, ANN].sort());
    expect(await refusal(ann.guess(code, 'crane'))).toBe('game-over');
  });

  it('ends when the time is up, even with nobody looking', async () => {
    const { ann, code, sqlite, lobbies, tick } = await opened();
    await ann.settings(code, { ...NO_COMPUTERS, difficulty: 'hard', minutes: 10 });
    await ann.start(code);
    tick(10 * 60_000);
    await lobbies.runAlarms();
    expect(sqlite.prepare("SELECT finished_at FROM games WHERE mode = 'lobby'").all())
      .toEqual([{ finished_at: START + 10 * 60_000 }]);
    const over = (await ann.get(code)).lobby;
    expect(over.state).toBe('over');
    expect(over.standings?.find((p) => p.name === 'Bob')?.words.map((w) => w.outcome)).toEqual(['unsolved', 'unsolved', 'unsolved', 'unsolved']);
  });
});

describe('computer players', () => {
  it('fill seats the host asks for, and play on their own', async () => {
    const { as, sqlite, lobbies, tick } = setup();
    const ann = as(ANN);
    const { code } = (await ann.create('Ann', 'medium')).lobby;
    const settings = { difficulty: 'medium', minutes: 90, computers: 1, strength: 'mastermind' } as const;
    expect((await ann.settings(code, settings)).lobby.players).toEqual([
      { name: 'Ann', strength: null, you: true }, { name: 'Computer 1', strength: 'mastermind', you: false },
    ]);
    await ann.start(code);
    // Mastermind guesses every 90 min ÷ 4 ÷ 7, about 3 minutes.
    tick(193_000);
    expect((await ann.get(code)).lobby.standings?.find((p) => p.strength)?.words[0].guesses).toBe(1);
    await ann.giveUp(code);
    expect((await ann.get(code)).lobby.state).toBe('playing');
    // Nobody looks again: the lobby's alarm ends the game when the computer finishes.
    for (let i = 0; i < 60 && sqlite.prepare("SELECT 1 FROM games WHERE mode = 'lobby'").all().length === 0; i++) {
      tick(193_000);
      await lobbies.runAlarms();
    }
    const [game] = sqlite.prepare("SELECT finished_at FROM games WHERE mode = 'lobby'").all();
    expect(game.finished_at).toBeLessThan(START + 90 * 60_000);
    const over = (await ann.get(code)).lobby;
    expect(over.state).toBe('over');
    expect(over.standings?.[0]).toMatchObject(
      { name: 'Computer 1', rank: 1, finished: true, words: WORDS.map(() => ({ outcome: 'solved' })) });
    // Only people are in the history's players.
    expect(sqlite.prepare('SELECT guest_id FROM game_players').all()).toEqual([{ guest_id: ANN }]);
  });
});

describe('standings and notifications', () => {
  it('rank finished players with the group penalty, provisional until the end', async () => {
    const { ann, bob, code, tick } = await opened();
    await ann.start(code);
    // Ann finds every word first time; Bob finds the first, then gives up the rest.
    for (const word of WORDS) {
      tick(1000);
      await ann.guess(code, word);
    }
    const provisional = (await bob.guess(code, WORDS[0])).lobby;
    expect(provisional.state).toBe('playing');
    expect(provisional.standings?.map((s) => [s.name, s.rank])).toEqual([['Ann', 1], ['Bob', null]]);
    const over = (await bob.giveUp(code)).lobby;
    expect(over.standings?.map((s) => [s.name, s.rank, s.score])).toEqual([
      // Bob's 3 words given up each count as Ann's 1 guess + 10.
      ['Ann', 1, 1], ['Bob', 2, (1 + 11 * 3) / 4],
    ]);
  });

  it("tell the others when a player finishes, and everyone their place at the end", async () => {
    const { ann, bob, code, as, lobbies, tick } = await opened();
    const cat = as(CAT);
    await cat.join(code, 'Cat');
    await ann.start(code);
    for (const word of WORDS) {
      tick(1000);
      await ann.guess(code, word);
    }
    expect(lobbies.notices.map((n) => [n.guestId, n.message.title])).toEqual([
      [BOB, 'Ann finished the Rush'], [CAT, 'Ann finished the Rush'],
    ]);
    expect(lobbies.notices[0].message).toMatchObject({
      body: 'Score 1.0, with 4 of 4 words found. Keep going!', gameId: `lobby-${code}`, url: `/?lobby=${code}`,
    });
    lobbies.notices.length = 0;
    await bob.giveUp(code);
    expect(lobbies.notices.map((n) => [n.guestId, n.message.body])).toEqual([
      [ANN, "Score 11.0, with 0 of 4 words found. You're 1st so far."],
      [CAT, 'Score 11.0, with 0 of 4 words found. Keep going!'],
    ]);
    lobbies.notices.length = 0;
    await cat.giveUp(code);
    expect(lobbies.notices.map((n) => [n.guestId, n.message.title, n.message.body])).toEqual([
      [ANN, 'You won the Rush with Friends!', 'Your score: 1.0. Bob came 2nd with 11.0.'],
      [BOB, 'The Rush is over: you came tied 2nd of 3', 'Ann won with 1.0. Your score: 11.0.'],
      [CAT, 'The Rush is over: you came tied 2nd of 3', 'Ann won with 1.0. Your score: 11.0.'],
    ]);
  });

  it('announce a computer finishing, but never notify a computer', async () => {
    const { as, lobbies, tick } = setup();
    const ann = as(ANN);
    const { code } = (await ann.create('Ann', 'medium')).lobby;
    await ann.settings(code, { difficulty: 'medium', minutes: 90, computers: 1, strength: 'mastermind' });
    await ann.start(code);
    for (let i = 0; i < 60 && lobbies.notices.length === 0; i++) {
      tick(193_000);
      await lobbies.runAlarms();
    }
    expect(lobbies.notices.map((n) => [n.guestId, n.message.title])).toEqual([[ANN, 'Computer 1 finished the Rush']]);
  });
});
