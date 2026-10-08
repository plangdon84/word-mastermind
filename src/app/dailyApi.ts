import {
  isCount, isDailyDay, isDifficulty, isObject, isTime, type DailyDay, type DailyPlacement, type DailyView, type DailyWordView,
  type Difficulty, type GuessResult,
} from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';
import type { Circle } from './leaderboardsApi';

/*
 * Daily Rush (README "Rush modes"), refereed by the server (`worker/`): one
 * run a day per player, the words kept on the server until found, and a
 * leaderboard per day and difficulty.
 */

/** Today's Daily Rush, from your side. */
export interface DailyToday {
  day: DailyDay;
  /** The theme's name, or null on a day without one (the calendar has run out). */
  theme: string | null;
  /**
   * The theme of your run's day: today's, or yesterday's while you finish a
   * run that was still going when the day changed (it's then off the board).
   */
  runTheme: string | null;
  /** When the next set is out: midnight New York time. */
  nextAt: number;
  /** The server's clock when it answered, so the app's clock can follow it. */
  now: number;
  /** Your run today, or null if you haven't started. */
  run: DailyView | null;
  /** Your places on past days' leaderboards, which are final once the day is over. */
  placements: DailyPlacement[];
}

/** One row of a leaderboard. */
export interface DailyBoardRow {
  rank: number;
  name: string;
  guesses: number;
  ms: number;
  /** This row is yours. */
  you: boolean;
}

/** A day's leaderboard for one difficulty. */
export interface DailyBoard {
  day: DailyDay;
  theme: string;
  difficulty: Difficulty;
  /** The day's words, once the day is over; null before. */
  words: string[] | null;
  /** Everyone who finished on this difficulty. */
  total: number;
  /** The top 10, ties sharing a rank. */
  top: DailyBoardRow[];
  /** Your place and totals, if you finished on this difficulty. */
  you: (DailyPlacement & { guesses: number; ms: number }) | null;
}

/** The server's reasons for refusing a request, beyond a word the rules refuse. */
export type DailyError =
  | 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'not-found' | 'no-theme' | 'already-played'
  | 'not-started' | 'day-over' | 'game-over' | 'offensive-name' | 'paused' | 'not-paused' | 'not-pausable' | 'no-pauses-left'
  | 'wrong-length' | 'not-letters' | 'repeated-letters' | 'not-in-word-list' | 'not-easy' | 'no-suggestions';

const isGuess = (value: unknown): value is GuessResult =>
  isObject(value) && typeof value.guess === 'string' && typeof value.score === 'number' && typeof value.isWin === 'boolean';
const timeOrNull = (value: unknown) => value === null || isTime(value);

/** One word of a Rush run as the server sends it (Daily Rush, and Rush with Friends). */
export function parseWordView(value: unknown): DailyWordView | null {
  if (!isObject(value)) return null;
  const { word, guesses, startedAt, endedAt, outcome } = value;
  if (!(word === null || typeof word === 'string') || !Array.isArray(guesses) || !guesses.every(isGuess)) return null;
  if (!timeOrNull(startedAt) || !timeOrNull(endedAt)) return null;
  if (!(outcome === null || outcome === 'solved' || outcome === 'gave-up' || outcome === 'unsolved')) return null;
  // An older server doesn't count suggestions, or pauses.
  const suggested = typeof value.suggested === 'number' ? value.suggested : 0;
  const pausedMs = isCount(value.pausedMs) ? value.pausedMs : 0;
  return { word, guesses, startedAt: startedAt as number | null, endedAt: endedAt as number | null, outcome, suggested, pausedMs };
}

export function parseDailyView(value: unknown): DailyView | null {
  if (!isObject(value)) return null;
  const { day, difficulty, startedAt, current, status } = value;
  if (!isDailyDay(day) || !isDifficulty(difficulty) || !isTime(startedAt) || !isCount(current)) return null;
  if (status !== 'playing' && status !== 'finished' && status !== 'gave-up') return null;
  if (!Array.isArray(value.words)) return null;
  const words = value.words.map(parseWordView);
  if (words.some((w) => w === null)) return null;
  // Nor can its runs pause.
  const pausable = value.pausable === true;
  const pausedAt = isTime(value.pausedAt) ? value.pausedAt : null;
  const pausesLeft = isCount(value.pausesLeft) ? value.pausesLeft : 0;
  return { day, difficulty, startedAt, current, status, words: words as DailyWordView[], pausable, pausedAt, pausesLeft };
}

export function parsePlacement(value: unknown): DailyPlacement | null {
  if (!isObject(value)) return null;
  const { day, difficulty, rank, total, behind, finishedAt } = value;
  if (!isDailyDay(day) || !isDifficulty(difficulty) || !isCount(rank) || !isCount(total) || !isCount(behind)) return null;
  if (!isTime(finishedAt)) return null;
  return { day, difficulty, rank, total, behind, finishedAt };
}

export function parseDailyToday(value: unknown): DailyToday | null {
  if (!isObject(value)) return null;
  const { day, theme, nextAt, now } = value;
  if (!isDailyDay(day) || !(theme === null || typeof theme === 'string') || !isTime(nextAt) || !isTime(now)) return null;
  const run = value.run === null ? null : parseDailyView(value.run);
  if (value.run !== null && run === null) return null;
  if (!Array.isArray(value.placements)) return null;
  const placements = value.placements.map(parsePlacement).filter((p): p is DailyPlacement => p !== null);
  // An older server only sends today's run.
  const runTheme = typeof value.runTheme === 'string' ? value.runTheme : theme;
  return { day, theme, runTheme, nextAt, now, run, placements };
}

export function parseDailyBoard(value: unknown): DailyBoard | null {
  if (!isObject(value)) return null;
  const { day, theme, difficulty, words, total } = value;
  if (!isDailyDay(day) || typeof theme !== 'string' || !isDifficulty(difficulty) || !isCount(total)) return null;
  if (!(words === null || (Array.isArray(words) && words.every((w) => typeof w === 'string')))) return null;
  if (!Array.isArray(value.top)) return null;
  const top: DailyBoardRow[] = [];
  for (const row of value.top) {
    if (!isObject(row) || !isCount(row.rank) || typeof row.name !== 'string' || !isCount(row.guesses)) return null;
    if (!isCount(row.ms) || typeof row.you !== 'boolean') return null;
    top.push({ rank: row.rank, name: row.name, guesses: row.guesses, ms: row.ms, you: row.you });
  }
  let you: DailyBoard['you'] = null;
  if (value.you !== null) {
    const placement = parsePlacement(value.you);
    const v = value.you as Record<string, unknown>;
    if (!placement || !isCount(v.guesses) || !isCount(v.ms)) return null;
    you = { ...placement, guesses: v.guesses, ms: v.ms };
  }
  return { day, theme, difficulty, words: words as string[] | null, total, top, you };
}

/** A request the server refused, with its reason. */
export class DailyApiError extends Error {
  constructor(readonly code: DailyError | 'unreachable', readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

export interface DailyApi {
  today(): Promise<DailyToday>;
  /** Starts today's run at `difficulty`, under your display name on the leaderboard. */
  start(day: DailyDay, difficulty: Difficulty, name: string): Promise<DailyToday>;
  guess(day: DailyDay, word: string): Promise<DailyToday>;
  /** Quits today's Daily Rush, with no leaderboard entry. */
  giveUp(day: DailyDay): Promise<DailyToday>;
  /** Stops your clock and covers the board, until `resume`. */
  pause(day: DailyDay): Promise<DailyToday>;
  resume(day: DailyDay): Promise<DailyToday>;
  /** Records that Easy's Suggest offered `word` at the word being played (README "Easy"). */
  suggest(day: DailyDay, word: string): Promise<DailyToday>;
  /** A day's board for one difficulty: everyone's, or (signed in) you and your friends'. */
  board(day: DailyDay, difficulty: Difficulty, circle?: Circle): Promise<DailyBoard>;
}

/**
 * Talks to the worker at `apiUrl`, as this device's guest or, signed in, its
 * account (`identity`). Every call rejects with a `DailyApiError`.
 */
export function dailyApi(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): DailyApi {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new DailyApiError(code as DailyError, status));
  const today = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<DailyToday> => {
    const parsed = parseDailyToday(await request(method, path, body));
    if (!parsed) throw new DailyApiError('bad-request', 200);
    return parsed;
  };
  return {
    today: () => today('GET', '/api/daily'),
    start: (day, difficulty, name) => today('POST', '/api/daily/start', { day, difficulty, name }),
    guess: (day, word) => today('POST', '/api/daily/guess', { day, word }),
    giveUp: (day) => today('POST', '/api/daily/give-up', { day }),
    pause: (day) => today('POST', '/api/daily/pause', { day }),
    resume: (day) => today('POST', '/api/daily/resume', { day }),
    suggest: (day, word) => today('POST', '/api/daily/suggest', { day, word }),
    board: async (day, difficulty, circle = 'everyone') => {
      const query = `day=${day}&difficulty=${difficulty}${circle === 'friends' ? '&circle=friends' : ''}`;
      const board = parseDailyBoard(await request('GET', `/api/daily/board?${query}`));
      if (!board) throw new DailyApiError('bad-request', 200);
      return board;
    },
  };
}
