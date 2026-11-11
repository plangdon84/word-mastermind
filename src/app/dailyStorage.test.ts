import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyToday } from './dailyApi';
import { keepPlacements, loadPlacements, parseDailySaved, parsePlacements, placesHeldThrough } from './dailyStorage';

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

describe('keepPlacements (item 19zm)', () => {
  const ann = { guestId: 'ann', token: null };
  const place = (day: string) => ({ day, difficulty: 'medium' as const, rank: 1, total: 2, behind: 1, finishedAt: 1 });
  const answer = (day: string, placements: DailyToday['placements'], placementsAfter?: string | null): DailyToday => ({
    day, theme: null, runTheme: null, nextAt: 0, now: 0, run: null, placements,
    ...(placementsAfter === undefined ? {} : { placementsAfter }),
  });
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });

  it('holds a whole list through the day before yesterday, then merges the later days', () => {
    expect(placesHeldThrough(ann, 'daily')).toBeNull();
    keepPlacements(ann, 'daily', answer('2026-10-31', [place('2026-10-29')]));
    expect(placesHeldThrough(ann, 'daily')).toBe('2026-10-29');
    keepPlacements(ann, 'daily', answer('2026-11-02', [place('2026-11-01')], '2026-10-29'));
    expect(loadPlacements().map((p) => p.day)).toEqual(['2026-10-29', '2026-11-01']);
    expect(placesHeldThrough(ann, 'daily')).toBe('2026-10-31');
  });

  it("asks for yesterday's place again, so one that changed after midnight replaces the old one", () => {
    keepPlacements(ann, 'daily', answer('2026-11-01', [place('2026-10-31')]));
    expect(placesHeldThrough(ann, 'daily')).toBe('2026-10-30');
    keepPlacements(ann, 'daily', answer('2026-11-01', [{ ...place('2026-10-31'), rank: 3 }], '2026-10-30'));
    expect(loadPlacements()).toMatchObject([{ day: '2026-10-31', rank: 3 }]);
  });

  it("keeps what it holds for an action's answer, and ignores later days for a list it no longer holds", () => {
    keepPlacements(ann, 'daily', answer('2026-10-31', [place('2026-10-29')]));
    expect(keepPlacements(ann, 'daily', answer('2026-10-31', [], null))).toBeNull();
    expect(loadPlacements()).toHaveLength(1);
    expect(keepPlacements(ann, 'daily', answer('2026-11-02', [place('2026-11-01')], '2026-10-28'))).toBeNull();
    expect(loadPlacements()).toHaveLength(1);
  });

  it("asks again for them all once it's another player: signed in, or a new device ID", () => {
    keepPlacements(ann, 'daily', answer('2026-10-31', [place('2026-10-29')]));
    expect(placesHeldThrough({ guestId: 'ann', token: 'session' }, 'daily')).toBeNull();
    expect(placesHeldThrough({ guestId: 'bob', token: null }, 'daily')).toBeNull();
    expect(placesHeldThrough(ann, 'dailyWord')).toBeNull();
    expect(keepPlacements({ guestId: 'bob', token: null }, 'daily', answer('2026-11-02', [], '2026-10-30'))).toBeNull();
  });
});
