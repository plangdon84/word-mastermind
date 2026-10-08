import { describe, expect, it } from 'vitest';
import { parseDailySaved, parsePlacements } from './dailyStorage';

describe('parseDailySaved', () => {
  it("restores the day's marks and whether it's in progress", () => {
    const saved = { day: '2026-10-31', playing: true, marks: [{ a: 'in' }, {}, {}, {}] };
    expect(parseDailySaved(JSON.stringify(saved))).toEqual(saved);
  });

  it('drops anything malformed', () => {
    expect(parseDailySaved(null)).toBeNull();
    expect(parseDailySaved('{nope')).toBeNull();
    expect(parseDailySaved(JSON.stringify({ day: '2026-13-01', marks: [] }))).toBeNull();
    expect(parseDailySaved(JSON.stringify({ day: '2026-10-31', marks: [{ a: 'maybe' }] }))?.marks).toEqual([{}]);
  });
});

describe('parsePlacements', () => {
  it('keeps the placements that parse', () => {
    const good = { day: '2026-10-31', difficulty: 'hard', rank: 3, total: 40, behind: 37, finishedAt: 1 };
    expect(parsePlacements(JSON.stringify([good, { ...good, rank: -1 }, 'x']))).toEqual([good]);
    expect(parsePlacements('oops')).toEqual([]);
  });
});
