import { describe, expect, it } from 'vitest';
import { DIFFICULTY_FACTOR, easierDifficulty, ratedDifficultyFor } from './difficulty';

describe('easierDifficulty', () => {
  it('picks the easier of two', () => {
    expect(easierDifficulty('extreme', 'medium')).toBe('medium');
    expect(easierDifficulty('hard', 'extreme')).toBe('hard');
    expect(easierDifficulty('hard', 'hard')).toBe('hard');
    expect(easierDifficulty('medium', 'easy')).toBe('easy');
  });
});

describe('DIFFICULTY_FACTOR', () => {
  it('counts a guess for less the harder the difficulty', () => {
    expect(DIFFICULTY_FACTOR.easy).toBe(1.2);
    expect(DIFFICULTY_FACTOR.medium).toBe(1);
    expect(DIFFICULTY_FACTOR.hard).toBeLessThan(DIFFICULTY_FACTOR.medium);
    expect(DIFFICULTY_FACTOR.extreme).toBeLessThan(DIFFICULTY_FACTOR.hard);
  });
});

describe('ratedDifficultyFor', () => {
  it('plays an Easy default at Medium in rated play, and keeps the others', () => {
    expect(ratedDifficultyFor('easy')).toBe('medium');
    expect(ratedDifficultyFor('hard')).toBe('hard');
  });
});
