import { pickGuessWithRecall, RECALL } from './computer';
import { FEATURES } from './features';
import { evaluateGuess, type GuessResult } from './scoring';
import { SECRET_WORDS } from './wordLists';

/*
 * Computer ratings (Dev Plan item 19o, README "Computer ratings"): the
 * computers a rated ladder can offer when no person is free, each a recall
 * with a fixed rating that never changes. Fixed data, measured by
 * `npm run calibrate` (scripts/calibrate.ts) with Expert pinned at 1500;
 * `computerRatings.test.ts` checks a few rows still hold.
 */

/**
 * One computer: its recall (`pickGuessWithRecall`), its average guesses to
 * find a word, and its rating. A human-like computer (`HUMAN_LADDER`) has an
 * ID in `recall` instead, kept in the same place in records and D1.
 */
export interface RatedComputer {
  recall: number;
  averageGuesses: number;
  rating: number;
  /** A human-like computer's name on the usage dashboard. */
  label?: string;
}

/** The weakest computer a ladder offers: Expert's recall. */
export const COMPUTER_RECALL_FLOOR = RECALL.expert;

/** The rating Expert is pinned at; every other computer is rated against it. */
export const EXPERT_RATING = 1500;

/**
 * Every ladder computer, weakest first: Expert's 0.38, then 0.5 to 1.0 in
 * steps of 0.1. From `npm run calibrate` (20,000 solves a recall, seed 1,
 * word lists of 3 November 2026), where 1.0 beats Expert about 90% of the time.
 */
export const COMPUTER_RATINGS: readonly RatedComputer[] = [
  { recall: 0.38, averageGuesses: 12.2, rating: 1500 },
  { recall: 0.5, averageGuesses: 10.5, rating: 1602 },
  { recall: 0.6, averageGuesses: 9.5, rating: 1673 },
  { recall: 0.7, averageGuesses: 8.7, rating: 1736 },
  { recall: 0.8, averageGuesses: 8.1, rating: 1792 },
  { recall: 0.9, averageGuesses: 7.6, rating: 1839 },
  { recall: 1, averageGuesses: 7.1, rating: 1890 },
];

/**
 * The human-like ladder computers (Dev Plan item 19zr, `humanLike.ts`, their
 * styles in `humanLadder.ts`), weakest first, one for each recall computer's
 * rating. Each one's ID is the recall of the computer it replaced plus 0.005:
 * a number in (0, 1], as every record's `ladder.computer` must be (so an app
 * from before still reads it), and never a recall. Measured by
 * `npm run benchmark-human` (2,000 words, seed 1, 17 November 2026), rated
 * against the recall computers at their table ratings: each within 17 points
 * of the computer it replaced.
 */
export const HUMAN_LADDER: readonly RatedComputer[] = [
  { recall: 0.385, averageGuesses: 11.3, rating: 1503, label: 'Human-like 1' },
  { recall: 0.505, averageGuesses: 10.0, rating: 1619, label: 'Human-like 2' },
  { recall: 0.605, averageGuesses: 9.3, rating: 1672, label: 'Human-like 3' },
  { recall: 0.705, averageGuesses: 8.5, rating: 1742, label: 'Human-like 4' },
  { recall: 0.805, averageGuesses: 8.0, rating: 1796, label: 'Human-like 5' },
  { recall: 0.905, averageGuesses: 7.5, rating: 1850, label: 'Human-like 6' },
  { recall: 0.995, averageGuesses: 7.2, rating: 1890, label: 'Human-like 7' },
];

/** The computers the ladder offers now: human-like unless switched off (`FEATURES.humanLikeLadder`). */
export const ladderComputers = (): readonly RatedComputer[] => (FEATURES.humanLikeLadder ? HUMAN_LADDER : COMPUTER_RATINGS);

/** A human-like ladder computer's ID. */
export const isHumanLike = (recall: number): boolean => HUMAN_LADDER.some((c) => c.recall === recall);

/** The table's row nearest `value` by `key`; on a tie, the weaker computer. */
function nearest(value: number, key: (computer: RatedComputer) => number, table: readonly RatedComputer[]): RatedComputer {
  let best = table[0];
  for (const computer of table) {
    if (Math.abs(key(computer) - value) < Math.abs(key(best) - value)) best = computer;
  }
  return best;
}

/** The computer nearest a player's rating, never below Expert (the floor). */
export const computerForRating = (rating: number, table: readonly RatedComputer[] = COMPUTER_RATINGS): RatedComputer =>
  Number.isFinite(rating) ? nearest(rating, (c) => c.rating, table) : table[0];

/**
 * The computer nearest a player's average guesses per word, never below
 * Expert: an average worse than Expert's gets Expert.
 */
export const computerForAverage = (averageGuesses: number, table: readonly RatedComputer[] = COMPUTER_RATINGS): RatedComputer =>
  Number.isFinite(averageGuesses) ? nearest(averageGuesses, (c) => c.averageGuesses, table) : table[0];

/** The computer with this recall (or human-like ID), if it's one, from either table. */
export const ratedComputer = (recall: number): RatedComputer | undefined =>
  COMPUTER_RATINGS.find((c) => c.recall === recall) ?? HUMAN_LADDER.find((c) => c.recall === recall);

/*
 * Calibration (used by `npm run calibrate` and the test). A computer's solves
 * are a spread of guess counts: `counts[n]` solves took n guesses. Between
 * two computers the fewer guesses win and the same count draws, whoever went
 * first (the final-guess rule).
 */

/** A small seeded random number generator (mulberry32), so a calibration can be repeated. */
export function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many guesses a computer with `recall` takes to find `secret`. */
export function solveWithRecall(secret: string, recall: number, random: () => number): number {
  const history: GuessResult[] = [];
  for (;;) {
    const result = evaluateGuess(pickGuessWithRecall(history, recall, random), secret);
    history.push(result);
    if (result.isWin) return history.length;
  }
}

/** `solves` solves of random secret-list words: `counts[n]` took n guesses. */
export function guessCounts(recall: number, solves: number, random: () => number): number[] {
  const counts: number[] = [];
  for (let i = 0; i < solves; i++) {
    const n = solveWithRecall(SECRET_WORDS[Math.floor(random() * SECRET_WORDS.length)], recall, random);
    counts[n] = (counts[n] ?? 0) + 1;
  }
  return counts;
}

/** The average guesses of a spread of guess counts. */
export function averageOf(counts: readonly number[]): number {
  let total = 0;
  let guesses = 0;
  counts.forEach((count, n) => {
    total += count ?? 0;
    guesses += (count ?? 0) * n;
  });
  return guesses / total;
}

/** A's expected score against B (1 a win, ½ a draw), from each one's guess counts. */
export function expectedScore(a: readonly number[], b: readonly number[]): number {
  const totalA = a.reduce((sum, n) => sum + (n ?? 0), 0);
  const totalB = b.reduce((sum, n) => sum + (n ?? 0), 0);
  let below = 0; // B's solves with fewer guesses than A's current count
  let score = 0;
  const length = Math.max(a.length, b.length);
  for (let n = 0; n < length; n++) {
    const countA = a[n] ?? 0;
    const countB = b[n] ?? 0;
    // A's solves in n guesses beat B's longer ones and draw B's equal ones.
    score += countA * (totalB - below - countB + countB / 2);
    below += countB;
  }
  return score / (totalA * totalB);
}

/** The rating gap the Elo scale gives an expected score (400 points is 10 to 1). */
export const ratingGap = (expected: number): number => 400 * Math.log10(expected / (1 - expected));

/**
 * Ratings for every computer from each pair's expected score, the one at
 * `pinned` set to `pinnedRating`: each rating is the average of what every
 * other computer's rating and the gap to it say, repeated until it settles
 * (a least-squares fit on the Elo scale). Expected scores are clamped, so a
 * pair that never draws or loses still has a finite gap.
 */
export function fitRatings(expected: readonly (readonly number[])[], pinned: number, pinnedRating = EXPERT_RATING): number[] {
  const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p));
  const size = expected.length;
  let ratings = new Array<number>(size).fill(pinnedRating);
  for (let round = 0; round < 1000; round++) {
    const next = ratings.map((_, i) => {
      let sum = 0;
      for (let j = 0; j < size; j++) if (j !== i) sum += ratings[j] + ratingGap(clamp(expected[i][j]));
      return size > 1 ? sum / (size - 1) : pinnedRating;
    });
    const shift = pinnedRating - next[pinned];
    const settled = next.every((r, i) => Math.abs(r + shift - ratings[i]) < 1e-6);
    ratings = next.map((r) => r + shift);
    if (settled) break;
  }
  return ratings;
}
