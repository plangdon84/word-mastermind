import { describe, expect, it } from 'vitest';
import { deduceMarks, evaluateGuess, isValidGuessWord, isValidSecretWord } from '../game';
import { SAMPLE_GUESSES, SAMPLE_SECRET } from './sampleGame';

describe('the sample game', () => {
  it('plays real words to a win', () => {
    expect(isValidSecretWord(SAMPLE_SECRET)).toBe(true);
    for (const { word } of SAMPLE_GUESSES) {
      expect(isValidGuessWord(word)).toBe(true);
      expect(evaluateGuess(word, SAMPLE_SECRET).isWin).toBe(false);
    }
  });

  it('asks for exactly the marks the scores settle, step by step', () => {
    const guesses = SAMPLE_GUESSES.map(({ word }) => evaluateGuess(word, SAMPLE_SECRET));
    SAMPLE_GUESSES.forEach(({ marks }, i) => {
      const deduced = deduceMarks(guesses.slice(0, i + 1));
      // Only the letters on the board: Easy also rules out letters no guess has.
      const seen = new Set(guesses.slice(0, i + 1).flatMap((g) => [...g.guess]));
      const onBoard = Object.fromEntries(Object.entries(deduced).filter(([c]) => seen.has(c)));
      expect(marks, SAMPLE_GUESSES[i].word).toEqual(onBoard);
    });
  });

  it('settles every letter of the word before the winning guess', () => {
    const last = SAMPLE_GUESSES[SAMPLE_GUESSES.length - 1].marks;
    expect(Object.keys(last).filter((c) => last[c] === 'in').sort()).toEqual([...SAMPLE_SECRET].sort());
  });
});
