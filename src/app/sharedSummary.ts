import {
  addDays, computeAchievements, computeStats, dailyDay, HISTORY_MODES, type DailyPlacement, type HistoryEntry, type ReplayedGame,
} from '../game';
import { SHARED_FORMAT, type SharedSummary } from './friendsApi';

/*
 * What a player shares with friends (Dev Plan item 18cb, README "Friends'
 * profiles"), worked out by their own device: `profileShare.ts` sends it.
 */

/** A game without your rating change: friends never see your rating (the server applies it too). */
export const withoutRating = (entry: HistoryEntry): HistoryEntry =>
  entry.mode === 'friend' || entry.mode === 'lobby' ? { ...entry, rating: null } : entry;

/**
 * What you share with friends: your stats and badges from every game they
 * can see, so not a Daily Set or Daily Word until the day after it is over (a run started
 * before midnight can be finished the next day), and the games your stats
 * point at, to open from them. `dayOf` is the day streaks count by: the
 * player's own local days (`localDay`).
 */
export function sharedSummary(
  games: readonly { entry: HistoryEntry; replayed: ReplayedGame }[], placements: readonly DailyPlacement[], now: number,
  dayOf: (ms: number) => number,
): SharedSummary {
  const hiddenFrom = addDays(dailyDay(now), -1);
  const shown = games.filter((g) => (g.entry.mode !== 'daily' && g.entry.mode !== 'dailyWord') || g.entry.day < hiddenFrom);
  const statsGames = shown.map((g) => ({ id: g.entry.id, replayed: g.replayed }));
  const stats = computeStats(statsGames, now);
  const featuredIds = new Set<string>();
  for (const mode of HISTORY_MODES) {
    const { best, bestRush, fastest } = stats.modes[mode];
    for (const ref of [best, bestRush, fastest]) if (ref) featuredIds.add(ref.id);
  }
  return {
    format: SHARED_FORMAT,
    games: shown.length,
    stats,
    badges: computeAchievements(statsGames, dayOf, placements.filter((p) => p.day < hiddenFrom)),
    featured: shown.filter((g) => featuredIds.has(g.entry.id)).map((g) => withoutRating(g.entry)),
  };
}

