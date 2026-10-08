import { describe, expect, it } from 'vitest';
import { earlierGuess } from './repeats';
import { evaluateGuess } from './scoring';

const guesses = [evaluateGuess('crane', 'beach'), evaluateGuess('bunny', 'beach')];

describe('earlierGuess', () => {
  it('finds a word guessed before, with its number and score', () => {
    expect(earlierGuess(guesses, 'bunny')).toEqual({ number: 2, result: guesses[1] });
  });

  it('ignores case and surrounding spaces', () => {
    expect(earlierGuess(guesses, '  CRANE ')?.number).toBe(1);
  });

  it('is null for a new word or an empty game', () => {
    expect(earlierGuess(guesses, 'plumb')).toBeNull();
    expect(earlierGuess([], 'crane')).toBeNull();
  });
});
