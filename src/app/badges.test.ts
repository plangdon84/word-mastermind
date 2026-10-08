import { describe, expect, it } from 'vitest';
import { localDay, parseBadgeNotices } from './badges';

describe('parseBadgeNotices', () => {
  it('keeps known badge IDs once each, and drops the rest', () => {
    const raw = JSON.stringify({ announced: ['solo-medium', 'solo-medium', 'nope', 7], unseen: ['clutch'] });
    expect(parseBadgeNotices(raw)).toEqual({ announced: ['solo-medium'], unseen: ['clutch'] });
  });

  it('starts empty from nothing or garbage', () => {
    const empty = { announced: [], unseen: [] };
    expect(parseBadgeNotices(null)).toEqual(empty);
    expect(parseBadgeNotices('{')).toEqual(empty);
    expect(parseBadgeNotices('[1]')).toEqual({ announced: [], unseen: [] });
  });
});

describe('localDay', () => {
  it('numbers consecutive local days one apart', () => {
    const noon = new Date(2026, 8, 28, 12).getTime();
    expect(localDay(noon + 24 * 3_600_000) - localDay(noon)).toBe(1);
    expect(localDay(new Date(2026, 8, 28, 0, 1).getTime())).toBe(localDay(new Date(2026, 8, 28, 23, 59).getTime()));
  });
});
