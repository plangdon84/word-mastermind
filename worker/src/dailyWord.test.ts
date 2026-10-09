import { describe, expect, it } from 'vitest';
import { dailyApi, DailyApiError, type DailyApi } from '../../src/app/dailyApi';
import { fetchPlayed } from '../../src/app/playedApi';
import { addDays, dayEnd, replayEntry, SECRET_WORDS, summarizeGame } from '../../src/game';
import { DAILY_WORD_REPEAT_DAYS, pickWordFor } from './dailyWords';
import { fakeD1 } from './fakeD1';
import { fakeDaily } from './fakeDaily';
import { handle, type Env } from './index';

const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
// Halloween 2026, with the test sets loaded (`testThemes.ts`): its Daily Set is brick, jumpy, solve, night.
const DAY = '2026-10-31';
const NOON = Date.UTC(2026, 9, 31, 12);
const SET = ['brick', 'jumpy', 'solve', 'night'];
const END = dayEnd(DAY);
const HOUR = 60 * 60 * 1000;

/** `random` picks the day's word; always 0 (the default) takes the first secret word it may. */
function setup(random?: () => number) {
  const { db, sqlite } = fakeD1({ dailyThemes: true });
  let clock = NOON;
  const { namespace } = fakeDaily({ db, now: () => clock, random });
  const env: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: namespace, LOBBIES: undefined as unknown as DurableObjectNamespace,
    QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init), env, clock)) as typeof fetch;
  const identity = (guestId: string) => ({ guestId, token: null });
  return {
    db,
    sqlite,
    fetchFn,
    word: (guestId: string): DailyApi => dailyApi('https://api.example', identity(guestId), fetchFn, 'dailyWord'),
    set: (guestId: string): DailyApi => dailyApi('https://api.example', identity(guestId), fetchFn),
    played: (guestId: string) => fetchPlayed('https://api.example', identity(guestId), 0, fetchFn),
    /** The day's word, once picked. */
    wordOf: (day = DAY) => (sqlite.prepare('SELECT word FROM daily_words WHERE day = ?').get(day) as { word: string } | undefined)?.word,
    tick: (ms: number) => { clock += ms; },
    setClock: (ms: number) => { clock = ms; },
  };
}

async function refusal(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof DailyApiError) return e.code;
    throw e;
  }
  throw new Error('the call was accepted');
}

/** A secret word other than `word`, as a wrong guess. */
const other = (word: string) => SECRET_WORDS.find((w) => w !== word && ![...w].some((c) => word.includes(c)))!;

describe("today's Daily Word", () => {
  it('has no theme, and picks the word when first started, hiding it until found', async () => {
    const s = setup();
    const before = await s.word(ANN).today();
    expect(before).toMatchObject({ day: DAY, theme: null, runTheme: null, run: null, placements: [] });
    expect(s.wordOf()).toBeUndefined();
    const started = await s.word(ANN).start(DAY, 'hard', 'Ann');
    const word = s.wordOf()!;
    expect(SECRET_WORDS).toContain(word);
    expect(started.run).toMatchObject({ difficulty: 'hard', status: 'playing', pausable: false, pausesLeft: 0 });
    expect(started.run?.words).toHaveLength(1);
    expect(JSON.stringify(started)).not.toContain(word);
  });

  it("is the same word for everyone, never one of the day's Daily Set, nor a Daily Word of the past year", async () => {
    const s = setup();
    // With `random` 0 it would be the first secret word; make that, and the next, a recent Daily Word.
    const [first, second] = SECRET_WORDS.filter((w) => !SET.includes(w));
    s.sqlite.prepare('INSERT INTO daily_words (day, word) VALUES (?, ?), (?, ?)')
      .run(addDays(DAY, -1), first, addDays(DAY, 1 - DAILY_WORD_REPEAT_DAYS), second);
    await s.word(ANN).start(DAY, 'medium', 'Ann');
    await s.word(BOB).start(DAY, 'medium', 'Bob');
    const word = s.wordOf()!;
    expect([first, second, ...SET]).not.toContain(word);
    // Both play the one word: the first to find it wins nothing from the other, but both find it with it.
    expect((await s.word(BOB).guess(DAY, word)).run?.status).toBe('finished');
    expect((await s.word(ANN).guess(DAY, word)).run?.status).toBe('finished');
  });

  it('can repeat a word from more than a year ago, and keeps a day\'s word once picked', async () => {
    const { db, sqlite } = fakeD1({ dailyThemes: true });
    const [first] = SECRET_WORDS.filter((w) => !SET.includes(w));
    sqlite.prepare('INSERT INTO daily_words (day, word) VALUES (?, ?)').run(addDays(DAY, -DAILY_WORD_REPEAT_DAYS - 1), first);
    expect(await pickWordFor(db, DAY, () => 0)).toBe(first);
    expect(await pickWordFor(db, DAY, () => 0.99)).toBe(first);
  });

  it('is once a day, has no Pause, and is played apart from the Daily Set', async () => {
    const s = setup();
    await s.set(ANN).start(DAY, 'medium', 'Ann');
    const started = await s.word(ANN).start(DAY, 'medium', 'Ann');
    expect(started.run?.words).toHaveLength(1);
    expect(await refusal(s.word(ANN).start(DAY, 'medium', 'Ann'))).toBe('already-played');
    expect(await refusal(s.word(ANN).pause(DAY))).toBe('not-found');
    // Each keeps its own run.
    expect((await s.set(ANN).today()).run?.words).toHaveLength(4);
    expect((await s.word(ANN).today()).run?.words).toHaveLength(1);
  });

  it('can be given up, which leaves no entry and keeps the word hidden until the day is over', async () => {
    const s = setup();
    await s.word(ANN).start(DAY, 'medium', 'Ann');
    const word = s.wordOf()!;
    s.tick(1000);
    await s.word(ANN).guess(DAY, other(word));
    const quit = await s.word(ANN).giveUp(DAY);
    expect(quit.run?.status).toBe('gave-up');
    expect(JSON.stringify(quit)).not.toContain(word);
    expect(s.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_word_results').get()).toEqual({ n: 0 });
  });

  it('saves a finished word to its own board and the game history, as a Daily Word', async () => {
    const s = setup();
    await s.word(ANN).start(DAY, 'extreme', 'Ann');
    const word = s.wordOf()!;
    s.tick(2000);
    await s.word(ANN).guess(DAY, other(word));
    s.tick(3000);
    expect((await s.word(ANN).guess(DAY, word)).run?.status).toBe('finished');
    expect(s.sqlite.prepare('SELECT day, player_id, difficulty, name, guesses, ms FROM daily_word_results').get())
      .toEqual({ day: DAY, player_id: ANN, difficulty: 'extreme', name: 'Ann', guesses: 2, ms: 5000 });
    expect(s.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_results').get()).toEqual({ n: 0 });
    const { games } = await s.played(ANN);
    expect(games).toHaveLength(1);
    const { entry, ref } = games[0];
    expect(entry).toMatchObject({ mode: 'dailyWord', day: DAY });
    expect(entry.id).toMatch(/^dailyWord-[0-9a-f]{40}$/);
    expect(ref).toBe(DAY);
    expect(summarizeGame(replayEntry(entry)!)).toMatchObject({ mode: 'dailyWord', yourGuesses: 2, gaveUp: false });
  });

  it('can be finished during the next day, off the board', async () => {
    const s = setup();
    await s.word(ANN).start(DAY, 'medium', 'Ann');
    const word = s.wordOf()!;
    s.setClock(END + HOUR);
    expect((await s.word(ANN).today()).run?.day).toBe(DAY);
    expect((await s.word(ANN).guess(DAY, word)).run?.status).toBe('finished');
    expect(s.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_word_results').get()).toEqual({ n: 0 });
    expect((await s.played(ANN)).games).toHaveLength(1);
  });
});

describe("the Daily Word's board", () => {
  async function played() {
    const s = setup();
    for (const [id, name, difficulty, wrong, gap] of [
      [ANN, 'Ann', 'medium', 1, 1000], [BOB, 'Bob', 'medium', 0, 4000], [CAT, 'Cat', 'medium', 0, 2000],
    ] as const) {
      s.setClock(NOON);
      await s.word(id).start(DAY, difficulty, name);
      const word = s.wordOf()!;
      for (let i = 0; i < wrong; i++) {
        s.tick(gap);
        await s.word(id).guess(DAY, other(word));
      }
      s.tick(gap);
      await s.word(id).guess(DAY, word);
    }
    return s;
  }

  it('ranks by fewest guesses, time breaking ties, with your place', async () => {
    const s = await played();
    const board = await s.word(ANN).board(DAY, 'medium');
    expect(board).toMatchObject({ day: DAY, theme: null, difficulty: 'medium', rankBy: 'crush', words: null, total: 3 });
    expect(board.top.map((r) => [r.rank, r.name, r.guesses, r.ms])).toEqual([[1, 'Cat', 1, 2000], [2, 'Bob', 1, 4000], [3, 'Ann', 2, 2000]]);
    expect(board.you).toMatchObject({ rank: 3, total: 3, behind: 0, guesses: 2, mode: 'dailyWord' });
    expect(JSON.stringify(board)).not.toContain(BOB);
    // The Daily Set's board is its own.
    expect((await s.set(ANN).board(DAY, 'medium')).total).toBe(0);
  });

  it('has no Rush board', async () => {
    const s = setup();
    expect(await refusal(s.word(ANN).board(DAY, 'medium', 'everyone', 'rush'))).toBe('bad-request');
  });

  it("is there today before anyone has played, shows the word once the day is over, and no day without one", async () => {
    const s = setup();
    expect(await s.word(ANN).board(DAY, 'medium')).toMatchObject({ total: 0, words: null, top: [], you: null });
    await s.word(ANN).start(DAY, 'medium', 'Ann');
    s.setClock(END + HOUR);
    expect((await s.word(ANN).board(DAY, 'medium')).words).toBeNull();
    await s.word(ANN).giveUp(DAY);
    expect((await s.word(ANN).board(DAY, 'medium')).words).toEqual([s.wordOf()]);
    expect(await refusal(s.word(ANN).board(addDays(DAY, -1), 'medium'))).toBe('not-found');
    expect(await refusal(s.word(ANN).board(addDays(DAY, 2), 'medium'))).toBe('not-found');
  });

  it("gives your final places on past days, marked as the Daily Word's", async () => {
    const s = await played();
    expect((await s.word(ANN).today()).placements).toEqual([]);
    s.setClock(END + HOUR);
    expect((await s.word(ANN).today()).placements).toEqual([
      { day: DAY, difficulty: 'medium', rank: 3, total: 3, behind: 0, finishedAt: expect.any(Number), mode: 'dailyWord' },
    ]);
    // The Daily Set's places leave the Daily Word's out.
    expect((await s.set(ANN).today()).placements).toEqual([]);
  });
});
