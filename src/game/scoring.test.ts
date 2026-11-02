import { describe, expect, it } from 'vitest';
import {
  evaluateGuess, guessesScore, intersection, isWin, letterSet, penalized, scoreGuess,
  totalScore, totalSeconds, averageWord, type WordResult,
} from './scoring';

describe('letterSet', () => {
  it('keeps only distinct letters', () => {
    expect(letterSet('bunny')).toEqual(new Set(['b', 'u', 'n', 'y']));
  });

  it('is case-insensitive', () => {
    expect(letterSet('BeAcH')).toEqual(letterSet('beach'));
  });
});

describe('intersection', () => {
  it('returns items present in both sets', () => {
    expect(intersection(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toEqual(
      new Set(['b', 'c']),
    );
  });
});

describe('scoreGuess', () => {
  // Examples from the README.
  it.each([
    ['bunny', 'beach', 1],
    ['nacre', 'crane', 5],
    ['eerie', 'crane', 2],
    ['plots', 'crane', 0],
  ])('%s vs %s scores %i', (guess, secret, expected) => {
    expect(scoreGuess(guess, secret)).toBe(expected);
  });

  it('ignores case', () => {
    expect(scoreGuess('NACRE', 'Crane')).toBe(5);
  });
});

describe('isWin', () => {
  it('is true only for the exact word, ignoring case', () => {
    expect(isWin('beach', 'beach')).toBe(true);
    expect(isWin('BEACH', 'beach')).toBe(true);
  });

  it('is false for an anagram', () => {
    expect(isWin('nacre', 'crane')).toBe(false);
  });
});

describe('evaluateGuess', () => {
  it('reports the normalized guess, score, and win flag', () => {
    expect(evaluateGuess('Bunny', 'beach')).toEqual({ guess: 'bunny', score: 1, isWin: false });
    expect(evaluateGuess('beach', 'beach')).toEqual({ guess: 'beach', score: 5, isWin: true });
  });
});

describe('run scoring', () => {
  // README "Scoring": Ann, Bob and Dan all play Cat's word.
  const ann: WordResult = { solved: true, guesses: 12, seconds: 180 };
  const bob: WordResult = { solved: true, guesses: 18, seconds: 240 };
  const dan: WordResult = { solved: false, guesses: 3, seconds: 40 };
  const catsWord = [ann, bob, dan];

  it('scores a solved word as played', () => {
    expect(guessesScore(penalized(ann, catsWord, catsWord))).toBe(12);
    expect(guessesScore(penalized(bob, catsWord, catsWord))).toBe(18);
  });

  it("penalizes giving up from the worst solved result for that word", () => {
    expect(penalized(dan, catsWord, catsWord)).toEqual({ guesses: 28, seconds: 240 });
    expect(guessesScore(penalized(dan, catsWord, catsWord))).toBe(28);
  });

  it('never lets giving up beat what was used', () => {
    const stubborn: WordResult = { solved: false, guesses: 30, seconds: 500 };
    expect(penalized(stubborn, [ann, stubborn], [ann, stubborn])).toEqual({ guesses: 40, seconds: 500 });
  });

  it("uses the worst solved result on any word when nobody solved this one", () => {
    const easyWord = [{ solved: true, guesses: 8, seconds: 90 }, { solved: true, guesses: 5, seconds: 120 }];
    const nobody = [dan, { solved: false, guesses: 6, seconds: 70 }];
    expect(penalized(dan, nobody, [...easyWord, ...nobody])).toEqual({ guesses: 18, seconds: 120 });
  });

  it('falls back to what was used when nobody solved anything', () => {
    expect(penalized(dan, [dan], [dan])).toEqual({ guesses: 13, seconds: 40 });
  });

  it('sums a player over their words', () => {
    const words = [{ guesses: 12, seconds: 180 }, { guesses: 28, seconds: 240 }];
    expect(totalScore(words, guessesScore)).toBe(40);
    expect(totalSeconds(words)).toBe(420);
    expect(averageWord(words)).toEqual({ guesses: 20, seconds: 210 });
    expect(averageWord([])).toEqual({ guesses: 0, seconds: 0 });
  });
});

describe('scoring by letter masks (Dev Plan item 19c)', () => {
  it('matches counting shared letters with sets, for every pair of a sample of words', () => {
    const words = ['beach', 'bunny', 'crane', 'Storm', ' house ', 'aaaaa', 'zzzzz', 'abcde', 'vwxyz', 'teach', 'cheap'];
    for (const a of words) {
      for (const b of words) expect(scoreGuess(a, b)).toBe(intersection(letterSet(a), letterSet(b)).size);
    }
  });

  it('counts every letter a–z, z included', () => {
    expect(scoreGuess('abcdefghijklmnopqrstuvwxyz', 'zyxwv')).toBe(5);
    expect(scoreGuess('bunny', 'bunny')).toBe(4);
  });

  it('still scores words with other characters, as distinct characters', () => {
    expect(scoreGuess('ab-cd', 'xa-yz')).toBe(2);
    expect(scoreGuess('éclat', 'éclat')).toBe(5);
  });
});
