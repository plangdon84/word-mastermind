import { describe, expect, it } from 'vitest';
import {
  addDays, betterThan, dailyDay, dailyTotals, dailyView, dayEnd, dayStart, isDailyDay, isTopTen, isTopTenPercent,
  NEW_YORK_FROM, ordinal,
} from './daily';
import { createRun, endRun, submitRunGuess, type RunGame } from './run';

const T = Date.UTC(2026, 9, 31, 23, 59);
const HOUR = 60 * 60 * 1000;

function play(run: RunGame, guesses: [string, number][]): RunGame {
  for (const [word, at] of guesses) {
    const result = submitRunGuess(run, word, at);
    if (!result.ok) throw new Error(result.error);
    run = result.game;
  }
  return run;
}

const start = () => {
  const result = createRun(['beach', 'storm', 'crane', 'light'], T, { difficulty: 'hard' });
  if (!result.ok) throw new Error(result.error);
  return result.game;
};

describe('Daily Rush days', () => {
  it('changed at midnight UTC before New York days', () => {
    expect(NEW_YORK_FROM > '2026-10-12').toBe(true);
    expect(dailyDay(Date.UTC(2026, 9, 12, 23, 59))).toBe('2026-10-12');
    expect(dayEnd('2026-10-12')).toBe(Date.UTC(2026, 9, 13));
    expect(dailyDay(Date.UTC(2026, 9, 13, 2))).toBe('2026-10-13');
    expect(dayStart('2026-10-13')).toBe(Date.UTC(2026, 9, 13));
  });

  it('change at midnight in New York from then on, following daylight saving', () => {
    // Summer time: 4:00 UTC.
    expect(dailyDay(T)).toBe('2026-10-31');
    expect(dayEnd('2026-10-31')).toBe(Date.UTC(2026, 10, 1, 4));
    expect(dailyDay(dayEnd('2026-10-31') - 1)).toBe('2026-10-31');
    expect(dailyDay(dayEnd('2026-10-31'))).toBe('2026-11-01');
    // Clocks go back early on 1 November: that day runs 25 hours, and winter's end at 5:00 UTC.
    expect(dayEnd('2026-11-01') - dayStart('2026-11-01')).toBe(25 * HOUR);
    expect(dayStart('2026-11-02')).toBe(Date.UTC(2026, 10, 2, 5));
    expect(dailyDay(Date.UTC(2026, 10, 2, 4, 59))).toBe('2026-11-01');
    // And forward in March: a 23-hour day.
    expect(dayEnd('2027-03-14') - dayStart('2027-03-14')).toBe(23 * HOUR);
  });

  it('run a few hours longer on the first New York day, starting at midnight UTC', () => {
    const first = NEW_YORK_FROM;
    expect(dayStart(first)).toBe(Date.parse(`${first}T00:00:00Z`));
    expect(dayEnd(first)).toBe(Date.parse(`${addDays(first, 1)}T04:00:00Z`));
    expect(dailyDay(dayStart(first))).toBe(first);
    // New York still has the day before, but that day is over.
    expect(dailyDay(dayStart(first) + HOUR)).toBe(first);
    expect(dailyDay(dayEnd(first) - 1)).toBe(first);
    expect(dailyDay(dayEnd(first))).toBe(addDays(first, 1));
    expect(dayEnd(addDays(first, -1))).toBe(dayStart(first));
  });

  it('step on the calendar, whatever their lengths', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays(NEW_YORK_FROM, -1) < NEW_YORK_FROM).toBe(true);
  });

  it('are only real dates, written one way', () => {
    expect(isDailyDay('2028-02-29')).toBe(true);
    expect(isDailyDay('2027-02-29')).toBe(false);
    expect(isDailyDay('2026-1-01')).toBe(false);
    expect(isDailyDay(20261001)).toBe(false);
  });
});

describe('a Daily Rush as its player sees it', () => {
  it("hides the words they haven't found", () => {
    const run = play(start(), [['bunny', T + 1000], ['beach', T + 5000]]);
    const view = dailyView('2026-10-31', run);
    expect(view).toMatchObject({ day: '2026-10-31', difficulty: 'hard', current: 1, status: 'playing' });
    expect(view.words.map((w) => w.word)).toEqual(['beach', null, null, null]);
    expect(view.words[0].guesses).toHaveLength(2);
    expect(JSON.stringify(view)).not.toMatch(/storm|crane|light/);
  });

  it('is given up once ended, still hiding the words', () => {
    const ended = endRun(play(start(), [['beach', T + 1]]), T + 2);
    const view = ended.ok && dailyView('2026-10-31', ended.game);
    expect(view && view.status).toBe('gave-up');
    expect(JSON.stringify(view)).not.toMatch(/storm|crane|light/);
    expect(ended.ok && dailyTotals(ended.game)).toBeNull();
  });

  it('is finished once every word is found, totalling guesses and time', () => {
    const run = play(start(), [
      ['bunny', T + 1000], ['beach', T + 2000], ['storm', T + 3000], ['crane', T + 4000], ['light', T + 65_000],
    ]);
    expect(dailyView('2026-10-31', run).status).toBe('finished');
    expect(dailyTotals(run)).toEqual({ guesses: 5, ms: 65_000 });
  });
});

describe('placements', () => {
  it('say who you beat, once there is someone to beat', () => {
    expect(betterThan({ rank: 12, total: 340 })).toBe(96);
    expect(betterThan({ rank: 1, total: 1 })).toBeNull();
    expect(betterThan({ rank: 1, total: 6 })).toBe(100);
    expect(betterThan({ rank: 6, total: 6 })).toBe(0);
    expect(betterThan({ rank: 2, total: 2 })).toBe(0);
    // Tied for first: both are 100%.
    expect(betterThan({ rank: 1, total: 2 })).toBe(100);
  });

  it('earn the top 10 and top 10% badges', () => {
    expect(isTopTen({ rank: 10 })).toBe(true);
    expect(isTopTen({ rank: 11 })).toBe(false);
    expect(isTopTenPercent({ rank: 1, total: 10 })).toBe(true);
    expect(isTopTenPercent({ rank: 1, total: 9 })).toBe(false);
    expect(isTopTenPercent({ rank: 34, total: 340 })).toBe(true);
  });

  it('read as ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(ordinal))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '112th']);
  });
});
