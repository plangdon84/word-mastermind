import { describe, expect, it } from 'vitest';
import { dailyApi, DailyApiError, type DailyApi } from '../../src/app/dailyApi';
import { DAY_MS, dayEnd, replayRun, validateSecretWord, type RunRecord } from '../../src/game';
import type { DailyEntry } from './dailyRoom';
import { themeFor } from './dailyThemes';
import { calendarDays, themeDayProblems, themeDaysSql, type ThemeDay } from './themeDays';
import { fakeD1 } from './fakeD1';
import { fakeDaily } from './fakeDaily';
import { TEST_THEMES, testThemeDays } from './testThemes';
import { handle, type Env } from './index';

const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const BOB = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const CAT = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';
// Halloween 2026, with the test sets loaded (`testThemes.ts`): Test set A.
const DAY = '2026-10-31';
const NOON = Date.UTC(2026, 9, 31, 12);
const WORDS = ['brick', 'jumpy', 'solve', 'night'];
/** Midnight in New York (4:00 UTC, in summer time), when the next day's set is out. */
const END = dayEnd(DAY);

function setup(random?: () => number) {
  const { db, sqlite } = fakeD1({ dailyThemes: true });
  let clock = NOON;
  const { namespace, days } = fakeDaily({ db, now: () => clock, random });
  const env: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: namespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '',
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) =>
    handle(new Request(input, init), env, clock)) as typeof fetch;
  const as = (guestId: string): DailyApi => dailyApi('https://api.example', { guestId, token: null }, fetchFn);
  return { env, sqlite, days, as, tick: (ms: number) => { clock += ms; }, setClock: (ms: number) => { clock = ms; } };
}

/** The error a call rejects with. */
async function refusal(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    if (e instanceof DailyApiError) return e.code;
    throw e;
  }
  throw new Error('the call was accepted');
}

/** Finds every word, `extra` wrong guesses first on each, a second a guess. */
async function solve(api: DailyApi, tick: (ms: number) => void, extra = 0) {
  let today = await api.today();
  for (const word of WORDS) {
    for (let i = 0; i < extra; i++) {
      tick(1000);
      await api.guess(DAY, ['bunny', 'crane', 'storm', 'light'][i]);
    }
    tick(1000);
    today = await api.guess(DAY, word);
  }
  return today;
}

describe('the themes in D1', () => {
  const day = (d: string, words = ['brick', 'jumpy', 'solve', 'night']): ThemeDay =>
    ({ day: d, id: 'test-a', theme: 'Test set A', words });
  const isSecret = (word: string) => validateSecretWord(word).ok;

  it('gives a loaded day its theme, and none to a day without one', async () => {
    const { db } = fakeD1({ dailyThemes: true });
    expect(await themeFor(db, DAY)).toEqual({ id: 'test-a', theme: 'Test set A', words: WORDS });
    expect(await themeFor(db, '2030-01-01')).toBeNull();
  });

  it('has test sets of 4 different secret words', () => {
    for (const { words } of TEST_THEMES) expect(themeDayProblems([day(DAY, [...words])], isSecret)).toEqual([]);
    expect(testThemeDays('2026-12-31', 2).map((d) => d.day)).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('loads new days and days to come, but never changes today or a day before it', async () => {
    const { db, sqlite } = fakeD1();
    const load = (days: ThemeDay[], today: string) => sqlite.exec(themeDaysSql(days, today));
    load([day('2026-10-30'), day('2026-10-31'), day('2026-11-01')], '2026-10-01');
    const other = ['guild', 'fight', 'vowel', 'dusty'];
    load([day('2026-10-30', other), day('2026-10-31', other), day('2026-11-01', other), day('2026-11-02', other)], '2026-10-31');
    expect((await themeFor(db, '2026-10-30'))?.words).toEqual(WORDS);
    expect((await themeFor(db, '2026-10-31'))?.words).toEqual(WORDS);
    expect((await themeFor(db, '2026-11-01'))?.words).toEqual(other);
    expect((await themeFor(db, '2026-11-02'))?.words).toEqual(other);
  });

  it("quotes a theme's name", async () => {
    const { db, sqlite } = fakeD1();
    sqlite.exec(themeDaysSql([{ ...day(DAY), theme: "Ann's '; DROP TABLE daily_themes; --" }], '2026-01-01'));
    expect((await themeFor(db, DAY))?.theme).toBe("Ann's '; DROP TABLE daily_themes; --");
  });

  it('finds what is wrong with a day before loading it', () => {
    expect(themeDayProblems([day('2026-02-30'), day('2026-02-30')], isSecret)).toEqual([
      '2026-02-30: not a date', '2026-02-30: not a date', '2026-02-30: listed twice',
    ]);
    expect(themeDayProblems([day('2026-13-01'), day('2026-01-32'), day('Oct 1')], isSecret)).toEqual([
      '2026-13-01: not a date', '2026-01-32: not a date', 'Oct 1: not a date',
    ]);
    expect(themeDayProblems([{ ...day(DAY), id: 'Bad id', theme: ' ' }], isSecret)).toEqual([
      `${DAY}: the theme ID "Bad id" isn't lower-case letters, digits and dashes`, `${DAY}: the theme has no name`,
    ]);
    expect(themeDayProblems([day(DAY, ['brick', 'brick', 'solve', 'night'])], isSecret)).toEqual([`${DAY}: needs 4 different words`]);
    expect(themeDayProblems([day(DAY, ['brick', 'jumpy', 'solve', 'llama'])], isSecret)).toEqual([`${DAY}: llama isn't on the secret list`]);
  });

  it("joins the private calendar's files, and refuses a day whose theme is missing", () => {
    const themes = { themes: [{ id: 'test-a', theme: 'Test set A', words: WORDS }] };
    expect(calendarDays({ themes, calendar: { days: [{ date: DAY, id: 'test-a' }] } })).toEqual([day(DAY)]);
    expect(() => calendarDays({ themes, calendar: { days: [{ date: DAY, id: 'gone' }] } })).toThrow("theme gone isn't");
  });
});

describe("today's Daily Rush", () => {
  it("shows the theme and when the next set is out, but not the words", async () => {
    const { as } = setup();
    const today = await as(ANN).today();
    expect(today).toEqual({
      day: DAY, theme: 'Test set A', runTheme: 'Test set A', nextAt: END, now: NOON, run: null, placements: [],
    });
    expect(JSON.stringify(today)).not.toMatch(/\b(brick|jumpy|solve|night)\b/);
    expect(END).toBe(Date.UTC(2026, 10, 1, 4));
  });

  it('has no theme on a day without one loaded', async () => {
    const { as, setClock } = setup();
    setClock(Date.UTC(2030, 0, 1, 12));
    expect((await as(ANN).today()).theme).toBeNull();
    expect(await refusal(as(ANN).start('2030-01-01', 'medium', 'Ann'))).toBe('no-theme');
  });

  it('starts at the chosen difficulty, hiding the words until found', async () => {
    const { as, tick } = setup();
    const started = await as(ANN).start(DAY, 'hard', 'Ann');
    expect(started.run).toMatchObject({ day: DAY, difficulty: 'hard', startedAt: NOON, current: 0, status: 'playing' });
    tick(3000);
    const guessed = await as(ANN).guess(DAY, 'brick');
    expect(guessed.run?.words.map((w) => w.word)).toEqual(['brick', null, null, null]);
    expect(JSON.stringify(guessed)).not.toMatch(/\b(jumpy|solve|night)\b/);
    expect((await as(ANN).today()).run?.current).toBe(1);
  });

  it('is once a day: starting again is refused', async () => {
    const { as } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    expect(await refusal(as(ANN).start(DAY, 'extreme', 'Ann'))).toBe('already-played');
  });

  it("refuses a guess that isn't a word, and moves before starting", async () => {
    const { as } = setup();
    expect(await refusal(as(ANN).guess(DAY, 'brick'))).toBe('not-started');
    await as(ANN).start(DAY, 'medium', 'Ann');
    expect(await refusal(as(ANN).guess(DAY, 'qzxvj'))).toBe('not-in-word-list');
    expect((await as(ANN).today()).run?.words[0].guesses).toEqual([]);
  });

  it("records Easy's suggestion, one a word, and only at Easy", async () => {
    const { as } = setup();
    await as(ANN).start(DAY, 'easy', 'Ann');
    await as(ANN).suggest(DAY, 'crane');
    expect(await refusal(as(ANN).suggest(DAY, 'crane'))).toBe('no-suggestions');
    const today = await as(ANN).guess(DAY, 'crane');
    expect(today.run?.words[0]).toMatchObject({ suggested: 1, guesses: [{ guess: 'crane' }] });
    await as(BOB).start(DAY, 'medium', 'Bob');
    expect(await refusal(as(BOB).suggest(DAY, 'crane'))).toBe('not-easy');
  });

  it('refuses a malformed start', async () => {
    const { as } = setup();
    expect(await refusal(as(ANN).start(DAY, 'novice' as 'medium', 'Ann'))).toBe('bad-request');
    expect(await refusal(as(ANN).start(DAY, 'medium', 'x'))).toBe('bad-request');
    expect(await refusal(as(ANN).start(DAY, 'medium', 'Big Dick'))).toBe('offensive-name');
    expect(await refusal(as('nobody').start(DAY, 'medium', 'Ann'))).toBe('bad-guest-id');
  });

  it('can be finished during the next day, kept in the history but not on the board', async () => {
    const { as, setClock, sqlite } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    await as(ANN).guess(DAY, 'brick');
    setClock(END + 1000);
    // The new day shows the run still going, with its own day's theme, until it's over.
    const next = await as(ANN).today();
    expect(next).toMatchObject({ day: '2026-11-01', theme: 'Test set B', runTheme: 'Test set A', run: { day: DAY, status: 'playing' } });
    // Bob never started: nothing to finish, and the day is over for starting.
    expect((await as(BOB).today()).run).toBeNull();
    expect(await refusal(as(BOB).start(DAY, 'medium', 'Bob'))).toBe('day-over');
    // That day's words are on its board, but not for Ann until her run is over.
    expect((await as(BOB).board(DAY, 'medium')).words).toEqual(WORDS);
    expect((await as(ANN).board(DAY, 'medium')).words).toBeNull();
    for (const word of WORDS.slice(1, 3)) await as(ANN).guess(DAY, word);
    const done = await as(ANN).guess(DAY, WORDS[3]);
    expect((await as(ANN).board(DAY, 'medium')).words).toEqual(WORDS);
    expect(done).toMatchObject({ day: '2026-11-01', runTheme: 'Test set A', run: { day: DAY, status: 'finished' } });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM daily_results').get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM games WHERE mode = 'daily'").get()).toEqual({ n: 1 });
    // Once it's over, today's set: Ann can start it.
    expect(await as(ANN).today()).toMatchObject({ day: '2026-11-01', run: null });
    expect((await as(ANN).start('2026-11-01', 'medium', 'Ann')).run).toMatchObject({ day: '2026-11-01', status: 'playing' });
  });

  it('can only be finished for a day: two days on, it is over', async () => {
    const { as, setClock } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    setClock(dayEnd('2026-11-01') + 1000);
    expect(await refusal(as(ANN).guess(DAY, 'brick'))).toBe('day-over');
    expect((await as(ANN).today()).run).toBeNull();
  });

  it('once given up, leaves the new day to start', async () => {
    const { as, setClock } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    setClock(END + 1000);
    await as(ANN).giveUp(DAY);
    expect((await as(ANN).today()).run).toBeNull();
  });

  it('counts a run finished in the last millisecond of the day', async () => {
    const { as, setClock, sqlite } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    for (const word of WORDS.slice(0, 3)) await as(ANN).guess(DAY, word);
    setClock(END - 1);
    expect(await as(ANN).guess(DAY, WORDS[3])).toMatchObject({ day: DAY, run: { status: 'finished' } });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM daily_results').get()).toEqual({ n: 1 });
  });

  it('can be given up, which leaves no entry and keeps the words hidden', async () => {
    const { as, sqlite } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    await as(ANN).guess(DAY, 'brick');
    const quit = await as(ANN).giveUp(DAY);
    expect(quit.run?.status).toBe('gave-up');
    expect(JSON.stringify(quit)).not.toMatch(/\b(jumpy|solve|night)\b/);
    expect(await refusal(as(ANN).guess(DAY, 'jumpy'))).toBe('game-over');
    expect(await refusal(as(ANN).start(DAY, 'medium', 'Ann'))).toBe('already-played');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM daily_results').get()).toEqual({ n: 0 });
  });

  it('saves a finished run to the leaderboard and the game history, where it replays', async () => {
    const { as, tick, sqlite } = setup();
    await as(ANN).start(DAY, 'extreme', 'Ann');
    const done = await solve(as(ANN), tick, 1);
    expect(done.run?.status).toBe('finished');
    expect(sqlite.prepare('SELECT day, player_id, difficulty, name, guesses, ms FROM daily_results').get())
      .toEqual({ day: DAY, player_id: ANN, difficulty: 'extreme', name: 'Ann', guesses: 8, ms: 8000 });
    const game = sqlite.prepare("SELECT record FROM games WHERE mode = 'daily'").get() as { record: string };
    const replayed = replayRun(JSON.parse(game.record) as RunRecord);
    expect(replayed.ok && replayed.game.results.every((r) => r.outcome === 'solved')).toBe(true);
  });
});

describe('Pause', () => {
  it('stops your clock, refusing guesses until you resume, and your time leaves it out', async () => {
    const { as, tick, sqlite } = setup();
    expect((await as(ANN).start(DAY, 'medium', 'Ann')).run).toMatchObject({ pausable: true, pausedAt: null });
    tick(1000);
    await as(ANN).guess(DAY, 'brick');
    tick(1000);
    expect((await as(ANN).pause(DAY)).run).toMatchObject({ pausedAt: NOON + 2000 });
    expect(await refusal(as(ANN).pause(DAY))).toBe('paused');
    tick(60_000);
    expect(await refusal(as(ANN).guess(DAY, 'jumpy'))).toBe('paused');
    const resumed = await as(ANN).resume(DAY);
    expect(resumed.run).toMatchObject({ pausedAt: null });
    expect(resumed.run?.words[1].pausedMs).toBe(60_000);
    expect(await refusal(as(ANN).resume(DAY))).toBe('not-paused');
    for (const word of WORDS.slice(1)) {
      tick(1000);
      await as(ANN).guess(DAY, word);
    }
    // 4 seconds of guessing, and the minute paused left out.
    expect(sqlite.prepare('SELECT guesses, ms FROM daily_results').get()).toEqual({ guesses: 4, ms: 5000 });
    const game = sqlite.prepare("SELECT record FROM games WHERE mode = 'daily'").get() as { record: string };
    const record = JSON.parse(game.record) as RunRecord;
    expect(record.moves.map((m) => m.kind)).toContain('pause');
    expect(replayRun(record).ok).toBe(true);
  });

  it('allows two pauses a run, leaving out all the time paused', async () => {
    const { as, tick, sqlite } = setup();
    expect((await as(ANN).start(DAY, 'medium', 'Ann')).run).toMatchObject({ pausesLeft: 2 });
    await as(ANN).pause(DAY);
    tick(8 * 60_000);
    expect((await as(ANN).resume(DAY)).run).toMatchObject({ pausesLeft: 1 });
    await as(ANN).pause(DAY);
    tick(5 * 60_000);
    expect((await as(ANN).resume(DAY)).run).toMatchObject({ pausesLeft: 0 });
    expect(await refusal(as(ANN).pause(DAY))).toBe('no-pauses-left');
    for (const word of WORDS) {
      tick(1000);
      await as(ANN).guess(DAY, word);
    }
    // 13 minutes paused, all left out: only the 4 seconds of guessing.
    expect(sqlite.prepare('SELECT ms FROM daily_results').get()).toEqual({ ms: 4000 });
  });

  it("can't pause a run started before Pause", async () => {
    const { days, as } = setup();
    await as(ANN).start(DAY, 'medium', 'Ann');
    // As a run from before Pause was saved: not pausable.
    const storage = days.get(DAY)!;
    const entry = await storage.get<DailyEntry>(`run:${ANN}`);
    await storage.put(`run:${ANN}`, { ...entry!, record: { ...entry!.record, pausable: false } });
    expect((await as(ANN).today()).run?.pausable).toBe(false);
    expect(await refusal(as(ANN).pause(DAY))).toBe('not-pausable');
  });
});

describe('the leaderboard', () => {
  async function played() {
    const s = setup();
    await s.as(ANN).start(DAY, 'medium', 'Ann');
    await solve(s.as(ANN), s.tick, 1);
    await s.as(BOB).start(DAY, 'medium', 'Bob');
    await solve(s.as(BOB), s.tick, 0);
    await s.as(CAT).start(DAY, 'hard', 'Cat');
    await solve(s.as(CAT), s.tick, 2);
    return s;
  }

  it('ranks by total guesses per difficulty, with your place', async () => {
    const { as } = await played();
    const board = await as(ANN).board(DAY, 'medium');
    expect(board).toMatchObject({ day: DAY, theme: 'Test set A', difficulty: 'medium', words: null, total: 2 });
    expect(board.top).toEqual([
      { rank: 1, name: 'Bob', guesses: 4, ms: 4000, you: false },
      { rank: 2, name: 'Ann', guesses: 8, ms: 8000, you: true },
    ]);
    expect(board.you).toMatchObject({ rank: 2, total: 2, behind: 0, guesses: 8 });
    expect((await as(CAT).board(DAY, 'hard')).top.map((r) => r.name)).toEqual(['Cat']);
    expect((await as(CAT).board(DAY, 'medium')).you).toBeNull();
    // Player IDs are credentials.
    expect(JSON.stringify(board)).not.toContain(BOB);
  });

  it('breaks ties on time, and shares a rank when both tie', async () => {
    const s = setup();
    for (const [id, name, gap] of [[ANN, 'Ann', 2000], [BOB, 'Bob', 1000], [CAT, 'Cat', 1000]] as const) {
      s.setClock(NOON);
      await s.as(id).start(DAY, 'medium', name);
      await solve(s.as(id), (ms) => s.tick(ms === 1000 ? gap : ms));
    }
    const board = await s.as(ANN).board(DAY, 'medium');
    expect(board.top.map((r) => [r.rank, r.name])).toEqual([[1, 'Bob'], [1, 'Cat'], [3, 'Ann']]);
  });

  it('ranks the Rush board by time, then guesses, with your place there', async () => {
    const s = setup();
    // Ann guesses twice a word, quickly; Bob once a word, slowly.
    for (const [id, name, extra, gap] of [[ANN, 'Ann', 1, 100], [BOB, 'Bob', 0, 3000]] as const) {
      s.setClock(NOON);
      await s.as(id).start(DAY, 'medium', name);
      await solve(s.as(id), () => s.tick(gap), extra);
    }
    const rush = await s.as(ANN).board(DAY, 'medium', 'everyone', 'rush');
    expect(rush.rankBy).toBe('rush');
    expect(rush.top.map((r) => [r.rank, r.name])).toEqual([[1, 'Ann'], [2, 'Bob']]);
    expect(rush.you).toMatchObject({ rank: 1, total: 2, behind: 1, rankBy: 'rush' });
    const crush = await s.as(ANN).board(DAY, 'medium');
    expect(crush.rankBy).toBe('crush');
    expect(crush.top.map((r) => r.name)).toEqual(['Bob', 'Ann']);
    expect(crush.you).not.toHaveProperty('rankBy');
  });

  it('shows the words once the day is over, and no day to come', async () => {
    const { as, setClock } = await played();
    setClock(END + 60 * 60 * 1000);
    expect((await as(ANN).board(DAY, 'medium')).words).toEqual(WORDS);
    expect(await refusal(as(ANN).board('2026-11-02', 'medium'))).toBe('not-found');
    expect(await refusal(as(ANN).board('2020-01-01', 'medium'))).toBe('not-found');
  });

  it("gives your final places on past days, for the badges", async () => {
    const { as, setClock } = await played();
    expect((await as(ANN).today()).placements).toEqual([]);
    setClock(END + 60 * 60 * 1000);
    // The Crush board's place first, as an older app takes a day's first; then the Rush board's.
    expect((await as(ANN).today()).placements).toEqual([
      { day: DAY, difficulty: 'medium', rank: 2, total: 2, behind: 0, finishedAt: expect.any(Number) },
      { day: DAY, difficulty: 'medium', rank: 2, total: 2, behind: 0, finishedAt: expect.any(Number), rankBy: 'rush' },
    ]);
    expect((await as(CAT).today()).placements).toMatchObject([{ rank: 1, total: 1 }, { rank: 1, total: 1, rankBy: 'rush' }]);
  });
});

describe('requests', () => {
  it('are for today only', async () => {
    const { as } = setup();
    expect(await refusal(as(ANN).start('2026-10-30', 'medium', 'Ann'))).toBe('day-over');
    expect(await refusal(as(ANN).start('2026-11-01', 'medium', 'Ann'))).toBe('bad-request');
  });

  it('need a guest ID', async () => {
    const { env } = setup();
    const response = await handle(new Request('https://api.example/api/daily'), env, NOON + DAY_MS);
    expect(response.status).toBe(400);
  });
});

describe("each player's order", () => {
  it('gives everyone the day\'s words in their own order, kept in their run', async () => {
    // Each call in turn: Ann's shuffle takes the first three, Bob's the next.
    const picks = [0.9, 0.9, 0.9, 0, 0, 0];
    const { as, sqlite, tick } = setup(() => picks.shift() ?? 0);
    await as(ANN).start(DAY, 'medium', 'Ann');
    await as(BOB).start(DAY, 'medium', 'Bob');
    const annOrder = ['night', 'brick', 'jumpy', 'solve'];
    for (const word of annOrder) {
      tick(1000);
      await as(ANN).guess(DAY, word);
    }
    const row = sqlite.prepare("SELECT record FROM games WHERE mode = 'daily'").get() as { record: string };
    expect((JSON.parse(row.record) as RunRecord).words).toEqual(annOrder);
    // Bob's are in the theme's own order: BRICK first.
    const bob = await as(BOB).guess(DAY, 'brick');
    expect(bob.run?.words[0]).toMatchObject({ word: 'brick', outcome: 'solved' });
  });
});
