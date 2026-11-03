import { describe, expect, it } from 'vitest';
import { RECALL } from './computer';
import {
  averageOf,
  COMPUTER_RATINGS,
  COMPUTER_RECALL_FLOOR,
  computerForAverage,
  computerForRating,
  EXPERT_RATING,
  expectedScore,
  fitRatings,
  guessCounts,
  ratedComputer,
  ratingGap,
  seededRandom,
} from './computerRatings';

describe('the computer ratings table', () => {
  it('runs from Expert at 1500 to 1.0 in steps of 0.1, each stronger than the last', () => {
    expect(COMPUTER_RATINGS.map((c) => c.recall)).toEqual([0.38, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(COMPUTER_RATINGS[0]).toMatchObject({ recall: RECALL.expert, rating: EXPERT_RATING });
    expect(COMPUTER_RECALL_FLOOR).toBe(RECALL.expert);
    for (let i = 1; i < COMPUTER_RATINGS.length; i++) {
      expect(COMPUTER_RATINGS[i].rating).toBeGreaterThan(COMPUTER_RATINGS[i - 1].rating);
      expect(COMPUTER_RATINGS[i].averageGuesses).toBeLessThan(COMPUTER_RATINGS[i - 1].averageGuesses);
    }
  });

  // A small seeded run of the calibration (`npm run calibrate` plays
  // 20,000 solves a recall). If the word lists change and this fails, rerun
  // the calibration and update COMPUTER_RATINGS.
  const solves = 400;
  const rows = [COMPUTER_RATINGS[0], COMPUTER_RATINGS[3], COMPUTER_RATINGS[6]];
  const counts = rows.map((row, i) => guessCounts(row.recall, solves, seededRandom(100 + i)));

  rows.forEach((row, i) => {
    it(`recall ${row.recall} still averages about ${row.averageGuesses} guesses`, () => {
      expect(Math.abs(averageOf(counts[i]) - row.averageGuesses)).toBeLessThan(1);
    });
  });

  it('the rating gaps still hold head to head', () => {
    const expected = counts.map((a) => counts.map((b) => expectedScore(a, b)));
    const ratings = fitRatings(expected, 0);
    rows.forEach((row, i) => expect(Math.abs(ratings[i] - row.rating)).toBeLessThan(60));
  });
});

describe('computerForRating', () => {
  it('picks the nearest computer, never below Expert', () => {
    expect(computerForRating(1200).recall).toBe(0.38);
    expect(computerForRating(1500).recall).toBe(0.38);
    expect(computerForRating(1560).recall).toBe(0.5);
    expect(computerForRating(1700).recall).toBe(0.6);
    expect(computerForRating(1720).recall).toBe(0.7);
    expect(computerForRating(2400).recall).toBe(1);
    expect(computerForRating(Number.NaN).recall).toBe(0.38);
  });
});

describe('computerForAverage', () => {
  it('picks the nearest computer by average guesses, never below Expert', () => {
    expect(computerForAverage(25).recall).toBe(0.38);
    expect(computerForAverage(12).recall).toBe(0.38);
    expect(computerForAverage(10.4).recall).toBe(0.5);
    expect(computerForAverage(8).recall).toBe(0.8);
    expect(computerForAverage(5).recall).toBe(1);
    expect(computerForAverage(Number.NaN).recall).toBe(0.38);
  });
});

describe('ratedComputer', () => {
  it('finds a table row by recall', () => {
    expect(ratedComputer(0.7)?.rating).toBe(COMPUTER_RATINGS[3].rating);
    expect(ratedComputer(0.75)).toBeUndefined();
  });
});

describe('expectedScore', () => {
  it('counts fewer guesses as a win and the same count as a draw', () => {
    // A always takes 5 guesses; B takes 4, 5 or 6 equally often.
    const a = [0, 0, 0, 0, 0, 3];
    const b = [0, 0, 0, 0, 1, 1, 1];
    expect(expectedScore(a, b)).toBeCloseTo((0 + 0.5 + 1) / 3);
    expect(expectedScore(b, a)).toBeCloseTo(1 - (0 + 0.5 + 1) / 3);
    expect(expectedScore(a, a)).toBe(0.5);
  });
});

describe('fitRatings', () => {
  it('pins one computer and spaces the rest by their head-to-head scores', () => {
    // Exact Elo scores for 1500, 1600 and 1800.
    const elo = (gap: number) => 1 / (1 + 10 ** (-gap / 400));
    const truth = [1500, 1600, 1800];
    const expected = truth.map((a) => truth.map((b) => elo(a - b)));
    fitRatings(expected, 0).forEach((rating, i) => expect(rating).toBeCloseTo(truth[i], 3));
    expect(ratingGap(elo(100))).toBeCloseTo(100);
  });
});
