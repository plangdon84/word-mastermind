import type { Difficulty } from './difficulty';
import { dayEnd, type DailyDay } from './dailyDays';
import type { RunGame, WordOutcome } from './run';
import type { GuessResult } from './scoring';

/*
 * Daily Rush (README "Rush modes"): everyone plays the same themed set of 4
 * words each day, once, refereed by the server. The day changes at midnight
 * in New York for everyone (`dailyDays.ts`). Like the rest of the game logic,
 * nothing here reads the clock: the time is passed in.
 */

export { addDays, dailyDay, dayEnd, dayStart, isDailyDay, NEW_YORK_FROM, type DailyDay } from './dailyDays';

/**
 * Where a player's Daily Rush is. It's finished once every word is found;
 * giving up (a word or the run) quits it, with no leaderboard entry.
 */
export type DailyStatus = 'playing' | 'finished' | 'gave-up';

/** One word as the player may see it: the word itself only once they've found it. */
export interface DailyWordView {
  word: string | null;
  guesses: readonly GuessResult[];
  startedAt: number | null;
  endedAt: number | null;
  outcome: WordOutcome | null;
  /** Suggestions taken at this word (Easy). */
  suggested: number;
  /** Time spent paused at this word, which doesn't count. */
  pausedMs: number;
}

/** A player's Daily Rush as the server sends it: the words not yet found stay hidden. */
export interface DailyView {
  day: DailyDay;
  difficulty: Difficulty;
  startedAt: number;
  /** The index of the word being played; the number of words once it's over. */
  current: number;
  status: DailyStatus;
  words: readonly DailyWordView[];
  /** Whether the clock can be paused: runs started before Pause (Dev Plan item 18y) can't. */
  pausable: boolean;
  /** When the clock was paused, or null while it runs. */
  pausedAt: number | null;
  /** Pauses not yet used (`DAILY_PAUSES` a run). */
  pausesLeft: number;
}

/** Pauses a Daily Rush allows (owner, 8 October 2026). */
export const DAILY_PAUSES = 2;

/** Pauses used so far in a run. */
export const pausesUsed = (run: Pick<RunGame, 'moves'>): number => run.moves.filter((m) => m.kind === 'pause').length;

/** What a Daily Rush's time is counted from: the server's run, or the app's view of it. */
interface DailyClock {
  startedAt: number;
  pausedAt: number | null;
  words: readonly { endedAt: number | null; pausedMs: number }[];
}

/**
 * A Daily Rush's time at `now` (or, once over, at its last word): start to
 * end, less the time paused. The one sum the board, the result and the clock
 * on screen all use.
 */
export function dailyElapsedMs(run: DailyClock, over: boolean, now: number): number {
  const end = over ? Math.max(run.startedAt, ...run.words.map((w) => w.endedAt ?? run.startedAt)) : now;
  const paused = run.words.reduce((sum, w) => sum + w.pausedMs, 0) + (!over && run.pausedAt !== null ? Math.max(0, now - run.pausedAt) : 0);
  return Math.max(0, end - run.startedAt - paused);
}

export function dailyStatus(run: RunGame): DailyStatus {
  if (run.status === 'playing') return 'playing';
  return run.results.every((r) => r.outcome === 'solved') ? 'finished' : 'gave-up';
}

/** The run as its player may see it. */
export function dailyView(day: DailyDay, run: RunGame): DailyView {
  return {
    day,
    difficulty: run.difficulty,
    startedAt: run.startedAt,
    current: run.current,
    status: dailyStatus(run),
    pausable: run.pausable,
    pausedAt: run.pausedAt,
    pausesLeft: run.pausable ? Math.max(0, DAILY_PAUSES - pausesUsed(run)) : 0,
    words: run.results.map((r) => ({
      word: r.outcome === 'solved' ? r.word : null,
      guesses: r.guesses,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      outcome: r.outcome,
      suggested: r.suggested,
      pausedMs: r.pausedMs,
    })),
  };
}

/** When the last word was found or given up: the run's end, once it's over. */
const lastEnd = (run: RunGame): number => Math.max(run.startedAt, ...run.results.map((r) => r.endedAt ?? run.startedAt));

/** A finished Daily Rush's totals, which the leaderboard ranks: fewer guesses first, then less time (`dailyElapsedMs`). */
export interface DailyTotals {
  guesses: number;
  ms: number;
}

/** Null until every word is found. */
export function dailyTotals(run: RunGame): DailyTotals | null {
  if (dailyStatus(run) !== 'finished') return null;
  const guesses = run.results.reduce((sum, r) => sum + r.guesses.length, 0);
  return { guesses, ms: dailyElapsedMs({ ...run, words: run.results }, true, lastEnd(run)) };
}

/**
 * A run finished after its day ended (README "Daily Rush"): it could still be
 * played to the end, but it isn't on the leaderboard or the Daily Rush streak.
 */
export function finishedLate(day: DailyDay, run: RunGame): boolean {
  return dailyStatus(run) === 'finished' && lastEnd(run) >= dayEnd(day);
}

/** Your place on a day's leaderboard for your difficulty. */
export interface DailyPlacement {
  day: DailyDay;
  difficulty: Difficulty;
  /** 1 for the best; tied players share a rank. */
  rank: number;
  /** Everyone on that leaderboard, you included. */
  total: number;
  /** How many did worse than you. */
  behind: number;
  /** When you finished, in milliseconds since the epoch. */
  finishedAt: number;
  /** The Daily Set's Rush board, by time; left out for its Crush board, by guesses, as every place was before. */
  rankBy?: 'rush';
}

/**
 * "Better than 96%": (players − your place) ÷ (players − 1), rounded down, so
 * it leaves you out and first place is 100% (tied players share a place).
 * Null when you're alone on the board.
 */
export function betterThan({ rank, total }: Pick<DailyPlacement, 'rank' | 'total'>): number | null {
  return total < 2 ? null : Math.floor((100 * (total - rank)) / (total - 1));
}

/** The Daily Rush badges (README "Achievements"): a top 10 finish, and a top 10% one. */
export const isTopTen = ({ rank }: Pick<DailyPlacement, 'rank'>) => rank <= 10;
export const isTopTenPercent = ({ rank, total }: Pick<DailyPlacement, 'rank' | 'total'>) => rank * 10 <= total;

/** "12th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}
