import { describe, expect, it } from 'vitest';
import { shuffleLetters } from './keyboard';

describe('shuffleLetters', () => {
  it('keeps the same letters in a different order', () => {
    for (let n = 0; n < 50; n++) {
      const shuffled = shuffleLetters('crane');
      expect(shuffled).not.toBe('crane');
      expect([...shuffled].sort().join('')).toBe('acenr');
    }
  });

  it('works on a part-typed guess', () => {
    expect(shuffleLetters('ab')).toBe('ba');
  });

  it('leaves letters that can only stay as they are', () => {
    expect(shuffleLetters('')).toBe('');
    expect(shuffleLetters('a')).toBe('a');
    expect(shuffleLetters('ooo')).toBe('ooo');
  });
});
