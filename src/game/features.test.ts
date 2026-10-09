import { describe, expect, it } from 'vitest';
import { BADGES, badgesFor, computeAchievements, HUNTED_BADGES } from './achievements';
import { FEATURES } from './features';
import { DAY, lobby } from './testGames';

describe('the launch switches', () => {
  it('are off for 1.0: Random opponent, the rating boards, Competitive Rush and the top 10% badge; Easy\'s Suggest is on', () => {
    expect(FEATURES).toEqual({
      randomOpponent: false, ratingBoards: false, competitiveRush: false, suggest: true, dailyTopTenPercent: false,
    });
  });

  it("leave a switched-off mode's badge out, and out of Achievement Hunter's count", () => {
    const all = badgesFor({ randomOpponent: true, ratingBoards: true, competitiveRush: true, suggest: true, dailyTopTenPercent: true });
    expect(all.map((b) => b.id)).toEqual(expect.arrayContaining(['competitive-win', 'daily-top-10-percent']));
    expect(BADGES.map((b) => b.id)).not.toContain('competitive-win');
    expect(BADGES.map((b) => b.id)).not.toContain('daily-top-10-percent');
    expect(BADGES.length).toBe(all.length - 2);
    // Every badge but Hunter's own 4: 50 at 1.0, 53 from item 18o, 57 from 18z and 60 from 7b, so 15, 30, 45 and 60.
    expect(HUNTED_BADGES).toBe(BADGES.length - 4);
    expect(HUNTED_BADGES).toBe(60);
    // A Competitive Rush won before the switch went off earns nothing.
    const won = lobby('l', Date.UTC(2026, 0, 1), [['beach'], ['crane'], ['storm'], ['house']], { rank: 1, kind: 'competitive' });
    expect(computeAchievements([won], (ms) => Math.floor(ms / DAY)).map((b) => b.id)).not.toContain('competitive-win');
    // Nor does a Daily Rush top 10% place.
    const place = { day: '2026-10-01', difficulty: 'medium' as const, rank: 30, total: 400, behind: 370, finishedAt: 0 };
    expect(computeAchievements([], (ms) => Math.floor(ms / DAY), [place])).toEqual([]);
  });
});
