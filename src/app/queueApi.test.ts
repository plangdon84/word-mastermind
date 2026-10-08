import { describe, expect, it } from 'vitest';
import { queueChoice } from './queueApi';

describe('queueChoice', () => {
  it('keeps a live clock, and makes a saved correspondence one 10 minutes each', () => {
    expect(queueChoice('5m', 'hard')).toEqual({ timeControl: '5m', difficulty: 'hard' });
    expect(queueChoice('1d', 'medium')).toEqual({ timeControl: '10m', difficulty: 'medium' });
    expect(queueChoice('3d', 'extreme')).toEqual({ timeControl: '10m', difficulty: 'extreme' });
  });
});
