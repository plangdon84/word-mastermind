import { describe, expect, it } from 'vitest';
import { addDays, dailyDay, replayEntry, type HistoryEntry } from '../game';
import { dailyEntry, lobbyEntry, soloEntry } from '../game/testGames';
import { parseSharedSummary } from './friendsApi';
import { RELEASES } from './releases';
import { sharedSummary } from './sharedSummary';

/*
 * What a player shares with friends (Dev Plan item 18cb): worked out on
 * their own device, from the games friends can see.
 */

const NOW = Date.UTC(2026, 9, 9, 12);
const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
const games = (entries: HistoryEntry[]) => entries.map((entry) => ({ entry, replayed: replayEntry(entry)! }));
const words = [['beach'], ['crane'], ['storm'], ['house']];

describe('a shared summary', () => {
  it("leaves out a Daily Set until the day after it is over, from the count, stats and badges", () => {
    const today = dailyDay(NOW);
    const entries = [
      soloEntry('solo', NOW - 60_000, ['crane', 'beach']),
      dailyEntry('daily-old', addDays(today, -2), NOW - 3 * 86_400_000, words),
      dailyEntry('daily-yesterday', addDays(today, -1), NOW - 86_400_000, words),
      dailyEntry('daily-today', today, NOW - 120_000, words),
    ];
    const summary = sharedSummary(games(entries), [], NOW, dayOf);
    expect(summary.games).toBe(2);
    expect(summary.stats.modes.daily.played).toBe(1);
    expect(summary.badges.every((b) => !['daily-yesterday', 'daily-today'].includes(b.gameId))).toBe(true);
    expect(summary.version).toBe(RELEASES[0].version);
  });

  it('points at its best and fastest games, without a rating, and reads back as sent', () => {
    const lobby = { ...lobbyEntry('lobby', NOW - 60_000, words, { rank: 1 }), rating: { before: 1500, after: 1520 } } as HistoryEntry;
    const summary = sharedSummary(games([soloEntry('solo', NOW - 60_000, ['crane', 'beach']), lobby]), [], NOW, dayOf);
    expect(summary.featured.map((e) => e.id).sort()).toEqual(['lobby', 'solo']);
    expect(JSON.stringify(summary)).not.toContain('1520');
    expect(parseSharedSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });
});
