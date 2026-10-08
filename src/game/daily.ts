import type { Difficulty } from './difficulty';
import { dayEnd, type DailyDay } from './dailyDays';
import { runElapsedMs, type RunGame, type WordOutcome } from './run';
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

/** A finished Daily Rush's totals, which the leaderboard ranks: fewer guesses first, then less time (pauses left out). */
export interface DailyTotals {
  guesses: number;
  ms: number;
}

/** Null until every word is found. The clock never pauses, so the time is start to last find. */
export function dailyTotals(run: RunGame): DailyTotals | null {
  if (dailyStatus(run) !== 'finished') return null;
  const guesses = run.results.reduce((sum, r) => sum + r.guesses.length, 0);
  return { guesses, ms: runElapsedMs(run, lastEnd(run)) };
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
