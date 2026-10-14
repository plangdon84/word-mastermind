import { describe, expect, it } from 'vitest';
import type { DailyView } from '../game';
import type { DailyToday } from './dailyApi';
import { dailyLeftText } from './dailyCard';

const day = (theme: string | null, status: DailyView['status'] | null): DailyToday => ({
  day: '2026-10-14', theme, runTheme: theme, nextAt: 0, now: 0, placements: [],
  run: status === null ? null : { status } as DailyView,
});
const notStarted = { daily: false, dailyWord: false };

describe("the folded Daily card's line", () => {
  it("counts the daily games you haven't finished or given up", () => {
    expect(dailyLeftText({ daily: day('Made-up theme', null), dailyWord: day(null, null) }, notStarted)).toBe('2 to play');
    expect(dailyLeftText({ daily: day('Made-up theme', 'playing'), dailyWord: day(null, 'finished') }, notStarted)).toBe('1 to play');
    expect(dailyLeftText({ daily: day('Made-up theme', 'gave-up'), dailyWord: day(null, 'finished') }, notStarted)).toBe('Played');
  });

  it('leaves out a day with no Daily Set, and says nothing while either loads', () => {
    expect(dailyLeftText({ daily: day(null, null), dailyWord: day(null, 'finished') }, notStarted)).toBe('Played');
    expect(dailyLeftText({ daily: day(null, null), dailyWord: day(null, null) }, notStarted)).toBe('1 to play');
    expect(dailyLeftText({ daily: null, dailyWord: day(null, null) }, notStarted)).toBeNull();
  });
});
