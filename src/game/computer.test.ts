import { describe, expect, it } from 'vitest';
import { pickComputerGuess, pickGuessWithRecall, RECALL, strengthForAverage, type Strength } from './computer';
import { evaluateGuess, scoreGuess, type GuessResult } from './scoring';
import { SECRET_WORDS } from './wordLists';

/** A small seeded PRNG (mulberry32), so simulations are repeatable. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many guesses the computer takes to find `secret`. */
function solve(secret: string, pick: (history: GuessResult[]) => string): number {
  const history: GuessResult[] = [];
  for (;;) {
    const result = evaluateGuess(pick(history), secret);
    history.push(result);
    if (result.isWin) return history.length;
    if (history.length > 500) throw new Error(`no solution for ${secret}`);
  }
}

function meanGuesses(recall: number, games: number, seed: number): number {
  const random = seeded(seed);
  let total = 0;
  for (let i = 0; i < games; i++) {
    const secret = SECRET_WORDS[Math.floor(random() * SECRET_WORDS.length)];
    total += solve(secret, (history) => pickGuessWithRecall(history, recall, random));
  }
  return total / games;
}

describe('pickGuessWithRecall', () => {
  it('guesses a secret-list word', () => {
    expect(SECRET_WORDS).toContain(pickGuessWithRecall([], 1, seeded(1)));
  });

  it('with full recall, guesses only words that fit every clue', () => {
    const history = ['crane', 'plots', 'bumpy'].map((w) => evaluateGuess(w, 'storm'));
    const random = seeded(2);
    for (let i = 0; i < 50; i++) {
      const guess = pickGuessWithRecall(history, 1, random);
      for (const clue of history) expect(scoreGuess(clue.guess, guess)).toBe(clue.score);
    }
  });

  it('never repeats a guess', () => {
    const words = ['crane', 'storm', 'beach'];
    const history = [evaluateGuess('crane', 'storm'), evaluateGuess('beach', 'storm')];
    expect(pickGuessWithRecall(history, 0, seeded(3), words)).toBe('storm');
  });

  it('never forgets a guess that scored 5, so guesses only its anagrams from then on', () => {
    // Recall 0 forgets every other clue; `alert` scored 5 against `later`.
    const history = [evaluateGuess('crane', 'later'), evaluateGuess('alert', 'later')];
    const random = seeded(5);
    for (let i = 0; i < 50; i++) {
      const guess = pickGuessWithRecall(history, 0, random);
      expect(scoreGuess('alert', guess)).toBe(5);
      expect(guess).not.toBe('alert');
    }
  });

  it('falls back to any unguessed word if no word fits the clues', () => {
    const words = ['crane', 'beach'];
    const history = [{ guess: 'plots', score: 5, isWin: false }];
    expect(words).toContain(pickGuessWithRecall(history, 1, seeded(4), words));
  });

});

describe('computer strength', () => {
  // The targets in README "Computer strength". If the word lists change
  // and a level drifts out of its range, recalibrate RECALL in computer.ts.
  const targets: Record<Strength, [number, number]> = {
    casual: [25, 30],
    skilled: [15, 20],
    expert: [10, 15],
    mastermind: [6, 8],
  };

  for (const [strength, [low, high]] of Object.entries(targets) as [Strength, [number, number]][]) {
    it(`${strength} averages ${low}–${high} guesses`, () => {
      const mean = meanGuesses(RECALL[strength], 300, 42);
      expect(mean).toBeGreaterThanOrEqual(low);
      expect(mean).toBeLessThanOrEqual(high);
    });
  }

  it('gets stronger with each level', () => {
    expect(RECALL.casual).toBeLessThan(RECALL.skilled);
    expect(RECALL.skilled).toBeLessThan(RECALL.expert);
    expect(RECALL.expert).toBeLessThan(RECALL.mastermind);
  });

  it('pickComputerGuess uses the strength', () => {
    expect(SECRET_WORDS).toContain(pickComputerGuess([], 'expert', seeded(6)));
  });
});

describe('strengthForAverage', () => {
  it('ranks an average by the strength targets', () => {
    expect(strengthForAverage(7)).toBe('mastermind');
    expect(strengthForAverage(9.9)).toBe('mastermind');
    expect(strengthForAverage(10)).toBe('expert');
    expect(strengthForAverage(14.8)).toBe('expert');
    expect(strengthForAverage(15)).toBe('skilled');
    expect(strengthForAverage(20)).toBe('skilled');
    expect(strengthForAverage(20.5)).toBe('casual');
    expect(strengthForAverage(40)).toBe('casual');
  });
});
