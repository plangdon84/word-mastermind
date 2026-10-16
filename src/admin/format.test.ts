import { describe, expect, it } from 'vitest';
import { niceMax } from './BarChart';
import { finishedOn, modeName, periodLabel, topCountries } from './format';

describe('the usage dashboard', () => {
  it('labels periods', () => {
    expect(periodLabel('2026-10-16', 'day')).toBe('16 Oct');
    expect(periodLabel('2026-10-12', 'week')).toBe('12 Oct');
    expect(periodLabel('2026-01-01', 'month')).toBe('Jan 2026');
  });

  it('names modes, Competitive Rush apart from Rush with Friends', () => {
    expect(modeName('lobby')).toBe('Rush with Friends');
    expect(modeName('competitive')).toBe('Competitive Rush');
    expect(modeName('something-new')).toBe('something-new');
  });

  it('adds up a day’s finished entries', () => {
    expect(finishedOn({ day: '2026-10-16', started: 9, finished: { easy: 2, hard: 3 } })).toBe(5);
  });

  it('lists the top countries and sums the rest', () => {
    const countries = [{ country: 'GB', count: 5 }, { country: 'US', count: 3 }, { country: 'FR', count: 1 }, { country: 'DE', count: 1 }];
    expect(topCountries(countries, 2)).toEqual({ rows: [{ name: 'United Kingdom', count: 5 }, { name: 'United States', count: 3 }], others: 2 });
    expect(topCountries(countries).others).toBeNull();
  });

  it('rounds a chart’s top up to 1, 2 or 5 times a power of ten', () => {
    expect([0, 1, 3, 7, 10, 11, 180, 2001].map(niceMax)).toEqual([1, 1, 5, 10, 10, 20, 200, 5000]);
  });
});
