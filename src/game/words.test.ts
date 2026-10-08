import { describe, expect, it } from 'vitest';
import {
  hasRepeatedLetters,
  isAlphabetic,
  isWordError,
  hasValidLength,
  isValidGuessWord,
  isValidSecretWord,
  normalizeWord,
  validateGuess,
  validateSecretWord,
  validateWord,
} from './words';

describe('normalizeWord', () => {
  it('lowercases and trims', () => {
    expect(normalizeWord('  CrAnE ')).toBe('crane');
  });
});

describe('hasValidLength', () => {
  it('accepts exactly 5 letters', () => {
    expect(hasValidLength('crane')).toBe(true);
  });

  it.each(['', 'crab', 'cranes'])('rejects %j', (word) => {
    expect(hasValidLength(word)).toBe(false);
  });
});

describe('isAlphabetic', () => {
  it('accepts letters in any case', () => {
    expect(isAlphabetic('Crane')).toBe(true);
  });

  it.each(['cr4ne', 'cra-e', 'cr ne', 'crañe', 'cr@ne'])('rejects %j', (word) => {
    expect(isAlphabetic(word)).toBe(false);
  });
});

describe('hasRepeatedLetters', () => {
  it('detects a repeated letter', () => {
    expect(hasRepeatedLetters('bunny')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hasRepeatedLetters('BunNy')).toBe(true);
  });

  it('is false when every letter is distinct', () => {
    expect(hasRepeatedLetters('beach')).toBe(false);
  });
});

describe('isValidSecretWord / isValidGuessWord', () => {
  it('accept a common word on both lists, ignoring case and spaces', () => {
    expect(isValidSecretWord(' Beach ')).toBe(true);
    expect(isValidGuessWord('BEACH')).toBe(true);
  });

  it('accept a word only on the guess list as a guess, not a secret', () => {
    expect(isValidSecretWord('nacre')).toBe(false);
    expect(isValidGuessWord('nacre')).toBe(true);
  });

  it('reject words on neither list', () => {
    expect(isValidSecretWord('zzzzz')).toBe(false);
    expect(isValidGuessWord('zzzzz')).toBe(false);
  });

  it('reject banned words', () => {
    expect(isValidGuessWord('boner')).toBe(false);
  });
});

describe('validateSecretWord / validateGuess', () => {
  it('returns the normalized word when valid', () => {
    expect(validateSecretWord('BEACH')).toEqual({ ok: true, word: 'beach' });
    expect(validateGuess('Bunny')).toEqual({ ok: true, word: 'bunny' });
  });

  it('rejects repeated letters in a secret word but not in a guess', () => {
    expect(validateSecretWord('bunny')).toEqual({ ok: false, error: 'repeated-letters' });
    expect(validateGuess('bunny')).toEqual({ ok: true, word: 'bunny' });
  });

  it('rejects digits and special characters in secrets and guesses', () => {
    expect(validateSecretWord('ab1de')).toEqual({ ok: false, error: 'not-letters' });
    expect(validateGuess('b#nny')).toEqual({ ok: false, error: 'not-letters' });
  });

  it('rejects the wrong length', () => {
    expect(validateSecretWord('bee')).toEqual({ ok: false, error: 'wrong-length' });
    expect(validateGuess('beaches')).toEqual({ ok: false, error: 'wrong-length' });
  });

  it('rejects words that are not on the word lists', () => {
    expect(validateSecretWord('nacre')).toEqual({ ok: false, error: 'not-in-word-list' });
    expect(validateSecretWord('zyxwv')).toEqual({ ok: false, error: 'not-in-word-list' });
    expect(validateGuess('zzzzz')).toEqual({ ok: false, error: 'not-in-word-list' });
  });
});

describe('validateWord', () => {
  it('checks a secret word or a guess by kind', () => {
    expect(validateWord('secret', 'bunny')).toEqual({ ok: false, error: 'repeated-letters' });
    expect(validateWord('guess', 'bunny')).toEqual({ ok: true, word: 'bunny' });
  });

  it('recognizes its errors', () => {
    expect(isWordError('not-in-word-list')).toBe(true);
    expect(isWordError('game-over')).toBe(false);
    expect(isWordError(undefined)).toBe(false);
  });
});
