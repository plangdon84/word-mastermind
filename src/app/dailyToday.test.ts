import { afterEach, describe, expect, it } from 'vitest';
import type { DailyView } from '../game';
import type { DailyToday } from './dailyApi';
import { forgetDailies, knownDailies, mergeDailies } from './dailyToday';

const NEXT = 1_000_000;
const day = (status: DailyView['status'] | null): DailyToday => ({
  day: '2026-10-14', theme: 'Made-up theme', runTheme: 'Made-up theme', nextAt: NEXT, now: 0, placements: [],
  run: status === null ? null : { status } as DailyView,
});

afterEach(forgetDailies);

describe("the title screen's daily games (issue 250)", () => {
  it('keep a game that did not come this time', () => {
    const before = { daily: day('finished'), dailyWord: day('finished') };
    expect(mergeDailies(before, { daily: null, dailyWord: null })).toEqual(before);
    const played = { daily: day('finished'), dailyWord: null };
    expect(mergeDailies({ daily: day('playing'), dailyWord: day('finished') }, played))
      .toEqual({ daily: day('finished'), dailyWord: day('finished') });
  });

  it('know nothing before the first answer', () => {
    expect(knownDailies({ guestId: 'a', token: null }, 0)).toEqual({ daily: null, dailyWord: null });
  });
});
