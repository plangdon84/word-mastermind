import { normalizeWord } from './words';

export interface GuessResult {
  guess: string;
  /** Number of distinct letters shared by the guess and the secret word (0–5). */
  score: number;
  isWin: boolean;
}

/** The distinct letters in a word: `bunny` → {b, u, n, y}. */
export function letterSet(word: string): Set<string> {
  return new Set(normalizeWord(word));
}

export function intersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const shared = new Set<T>();
  for (const item of a) {
    if (b.has(item)) shared.add(item);
  }
  return shared;
}

/** Count of distinct letters present in both words; position is ignored. */
export function scoreGuess(guess: string, secret: string): number {
  return intersection(letterSet(guess), letterSet(secret)).size;
}

/** Only the exact word wins; an anagram scores 5 but does not win. */
export function isWin(guess: string, secret: string): boolean {
  return normalizeWord(guess) === normalizeWord(secret);
}

export function evaluateGuess(guess: string, secret: string): GuessResult {
  return {
    guess: normalizeWord(guess),
    score: scoreGuess(guess, secret),
    isWin: isWin(guess, secret),
  };
}

/*
 * Scoring a run (README "Scoring"): each word's raw guesses and seconds are
 * recorded, and one small, swappable formula turns them into a score. Lower
 * is better; a player's score is the sum over their words.
 */

/** One player's result on one word of a run. */
export interface WordResult {
  solved: boolean;
  guesses: number;
  seconds: number;
}

/** The part of a result a formula scores: after any penalty, for a word not solved. */
export type ScoredWord = Pick<WordResult, 'guesses' | 'seconds'>;

export type ScoreFormula = (word: ScoredWord) => number;

/** Guesses only; total time breaks ties (`totalSeconds`). */
export const guessesScore: ScoreFormula = ({ guesses }) => guesses;

/** Added to the guesses of a word given up, or unsolved when the timer ends. */
export const PENALTY_GUESSES = 10;

/**
 * Added to the time of a word given up, or unsolved when the timer ends, in a
 * Rush ranked by time (README "Scoring"). A Crush ranks by guesses, so its
 * time, only a tiebreak, takes no added penalty, as before Rush and Crush.
 */
export const PENALTY_SECONDS = 120;

/**
 * What a Word Set ranks by (README "Rush modes"): **Rush**, the fastest total
 * time (fewer guesses break ties), or **Crush**, the fewest guesses (time
 * breaks ties). Games from before the choice were Crush.
 */
export type RankBy = 'rush' | 'crush';

export const RANK_BYS: readonly RankBy[] = ['rush', 'crush'];

export const isRankBy = (value: unknown): value is RankBy => value === 'rush' || value === 'crush';

/** A game's name for what it ranks by: Rush or Crush. */
export const rankByName = (rankBy: RankBy) => (rankBy === 'rush' ? 'Rush' : 'Crush');

/**
 * A Word Set's name (README "Rush modes"): Solo Rush or Solo Crush, Rush
 * with Friends or Crush with Friends, Competitive Rush or Competitive Crush.
 */
export function wordSetName(kind: 'solo' | 'friends' | 'competitive', rankBy: RankBy): string {
  const name = rankByName(rankBy);
  return kind === 'solo' ? `Solo ${name}` : kind === 'friends' ? `${name} with Friends` : `Competitive ${name}`;
}

/** How a game ranks, in a few words: "fastest" or "fewest" (guesses). */
export const rankByHow = (rankBy: RankBy) => (rankBy === 'rush' ? 'fastest' : 'fewest');

const worstSolved = (results: readonly WordResult[]): ScoredWord | null => {
  const solved = results.filter((r) => r.solved);
  if (solved.length === 0) return null;
  return {
    guesses: Math.max(...solved.map((r) => r.guesses)),
    seconds: Math.max(...solved.map((r) => r.seconds)),
  };
};

/**
 * What a result counts as. A solved word counts as played. A word given up or
 * unsolved counts as the higher of what was used and the worst solved result
 * for that word in the group, plus `PENALTY_GUESSES` guesses. If nobody solved
 * the word, the worst solved result on any word in the group is used; if
 * nobody solved anything, just what was used. In a Rush, ranked by time, the
 * word also takes `PENALTY_SECONDS`.
 *
 * `sameWord`: everyone's results on this word. `group`: everyone's results on
 * every word.
 */
export function penalized(
  result: WordResult,
  sameWord: readonly WordResult[],
  group: readonly WordResult[],
  rankBy: RankBy = 'crush',
): ScoredWord {
  if (result.solved) return { guesses: result.guesses, seconds: result.seconds };
  const worst = worstSolved(sameWord) ?? worstSolved(group) ?? { guesses: 0, seconds: 0 };
  return {
    guesses: Math.max(result.guesses, worst.guesses) + PENALTY_GUESSES,
    seconds: Math.max(result.seconds, worst.seconds) + (rankBy === 'rush' ? PENALTY_SECONDS : 0),
  };
}

/** A result as a ranking compares it: the score (guesses) and the time. Lower is better. */
export interface Ranked {
  score: number;
  seconds: number;
}

/**
 * Orders two results, best first: a Rush by time, then score; a Crush by
 * score, then time.
 */
export const compareRanked = (rankBy: RankBy) => (a: Ranked, b: Ranked): number =>
  rankBy === 'rush' ? a.seconds - b.seconds || a.score - b.score : a.score - b.score || a.seconds - b.seconds;

/** A player's total over their words, already penalized. */
export function totalScore(words: readonly ScoredWord[], formula: ScoreFormula): number {
  return words.reduce((sum, word) => sum + formula(word), 0);
}

export function totalSeconds(words: readonly ScoredWord[]): number {
  return words.reduce((sum, word) => sum + word.seconds, 0);
}

/** Guesses and seconds per word, on average; zero for no words. */
export function averageWord(words: readonly ScoredWord[]): ScoredWord {
  if (words.length === 0) return { guesses: 0, seconds: 0 };
  const guesses = words.reduce((sum, word) => sum + word.guesses, 0);
  return { guesses: guesses / words.length, seconds: totalSeconds(words) / words.length };
}
