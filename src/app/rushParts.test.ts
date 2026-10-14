import { describe, expect, it } from 'vitest';
import { formatClock, formatClockUp, rushScoreText } from './rushParts';

describe('formatClockUp', () => {
  it('rounds up to the whole second, unlike the running clock (Dev Plan item 18zc)', () => {
    expect(formatClock(120.6)).toBe('2:00');
    expect(formatClockUp(120.6)).toBe('2:01');
    expect(formatClockUp(120)).toBe('2:00');
    expect(formatClockUp(59.01)).toBe('1:00');
  });

  it('keeps a whole second that floating point put a hair over', () => {
    expect(formatClockUp(100 * 1.2)).toBe('2:00');
    expect(formatClockUp(130 * 0.9)).toBe('1:57');
  });
});

describe('rushScoreText', () => {
  it('reads as a time a word, never a number of guesses', () => {
    expect(rushScoreText(264.2)).toBe('4:25 a word');
  });
});
