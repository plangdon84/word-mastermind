import { describe, expect, it } from 'vitest';
import { queueChoice } from './queueApi';

describe('queueChoice', () => {
  it('is always the ladder, Live 10 at Medium', () => {
    expect(queueChoice('5m', 'hard')).toEqual({ timeControl: '10m', difficulty: 'medium' });
    expect(queueChoice('1d', 'medium')).toEqual({ timeControl: '10m', difficulty: 'medium' });
    expect(queueChoice('10m', 'extreme')).toEqual({ timeControl: '10m', difficulty: 'medium' });
  });
});
