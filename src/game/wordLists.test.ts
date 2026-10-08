import { describe, expect, it } from 'vitest';
import bannedText from '../../wordlist/lists/banned.txt?raw';
import { GUESS_WORD_SET, GUESS_WORDS, SECRET_WORDS } from './wordLists';
import { validateGuess, validateSecretWord } from './words';

// Sanity checks on the generated lists as the app sees them. The ETL has its
// own tests (npm run test:wordlist); these guard the TypeScript side.
describe('word lists', () => {
  it('are non-empty, sorted and free of duplicates', () => {
    for (const words of [SECRET_WORDS, GUESS_WORDS]) {
      expect(words.length).toBeGreaterThan(0);
      expect([...new Set(words)].sort()).toEqual(words);
    }
  });

  it('contain only valid secret words on the secret list', () => {
    expect(SECRET_WORDS.filter((word) => !validateSecretWord(word).ok)).toEqual([]);
  });

  it('contain only valid guesses on the guess list', () => {
    expect(GUESS_WORDS.filter((word) => !validateGuess(word).ok)).toEqual([]);
  });

  it('make the guess list a superset of the secret list', () => {
    expect(SECRET_WORDS.filter((word) => !GUESS_WORD_SET.has(word))).toEqual([]);
  });

  it('leave banned words off both lists', () => {
    const banned = bannedText.split('\n').filter((line) => line !== '');
    expect(banned.length).toBeGreaterThan(0);
    expect(banned.filter((word) => GUESS_WORD_SET.has(word))).toEqual([]);
  });
});
