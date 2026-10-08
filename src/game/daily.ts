import type { Difficulty } from './difficulty';
import { DAY_MS } from './pvp';
import type { RunGame, WordOutcome } from './run';
import type { GuessResult } from './scoring';

/*
 * Daily Rush (README "Rush modes"): everyone plays the same themed set of 4
 * words each day, once, refereed by the server. The day changes at midnight
 * UTC for everyone. Like the rest of the game logic, nothing here reads the
 * clock: the time is passed in.
 */

/** A Daily Rush day: its UTC date, e.g. `2026-10-31`. */
export type DailyDay = string;

/** The day `now` falls on. */
export function dailyDay(now: number): DailyDay {
  return new Date(now).toISOString().slice(0, 10);
}

/** Is this a day as `dailyDay` writes them? */
export function isDailyDay(value: unknown): value is DailyDay {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const start = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(start) && dailyDay(start) === value;
}

/** When a day starts, in milliseconds since the epoch. */
export const dayStart = (day: DailyDay): number => Date.parse(`${day}T00:00:00Z`);

/** When a day ends, and the next set of words is out. */
export const dayEnd = (day: DailyDay): number => dayStart(day) + DAY_MS;

/** The day before or after, `by` days away. */
export const addDays = (day: DailyDay, by: number): DailyDay => dailyDay(dayStart(day) + by * DAY_MS);

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
    words: run.results.map((r) => ({
      word: r.outcome === 'solved' ? r.word : null,
      guesses: r.guesses,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      outcome: r.outcome,
      suggested: r.suggested,
    })),
  };
}

/** A finished Daily Rush's totals, which the leaderboard ranks: fewer guesses first, then less time. */
export interface DailyTotals {
  guesses: number;
  ms: number;
}

/** Null until every word is found. The clock never pauses, so the time is start to last find. */
export function dailyTotals(run: RunGame): DailyTotals | null {
  if (dailyStatus(run) !== 'finished') return null;
  const guesses = run.results.reduce((sum, r) => sum + r.guesses.length, 0);
  const end = Math.max(...run.results.map((r) => r.endedAt ?? run.startedAt));
  return { guesses, ms: end - run.startedAt };
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
