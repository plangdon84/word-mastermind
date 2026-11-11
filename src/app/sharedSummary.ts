import { addDays, dailyDay, HISTORY_MODES, ladderAverage, type DailyPlacement, type GameSummary, type HistoryEntry, type LadderStats, type ReplayedGame, type Stats, type StatsGame } from '../game';
import { computeStats } from '../game/stats';
import { computeAchievements } from '../game/achievements';
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
  games: readonly { entry: HistoryEntry; replayed: ReplayedGame; summary?: GameSummary }[], placements: readonly DailyPlacement[], now: number,
  dayOf: (ms: number) => number,
): SharedSummary {
  const hiddenFrom = addDays(dailyDay(now), -1);
  const shown = games.filter((g) => (g.entry.mode !== 'daily' && g.entry.mode !== 'dailyWord') || g.entry.day < hiddenFrom);
  const statsGames: StatsGame[] = shown.map((g) => ({ id: g.entry.id, replayed: g.replayed, summary: g.summary }));
  const { ladder, ...rest } = computeStats(statsGames, now);
  // Friends see only your current rating, never how far it moved (Dev Plan item 19zd, the 2.3.0 choice).
  const { ratingTrend: _ratingTrend, ...sharedLadder } = ladder ?? {};
  const stats: Stats = ladder ? { ...rest, ladder: sharedLadder as LadderStats } : rest;
  const featuredIds = new Set<string>();
  for (const mode of HISTORY_MODES) {
    const { best, bestRush, fastest } = stats.modes[mode];
    for (const ref of [best, bestRush, fastest]) if (ref) featuredIds.add(ref.id);
  }
  // From every game, today's Daily Word too: it's only read by the queue, never shown to friends.
  const average = ladderAverage(games.map((g) => g.replayed));
  return {
    format: SHARED_FORMAT,
    games: shown.length,
    stats,
    badges: computeAchievements(statsGames, dayOf, placements.filter((p) => p.day < hiddenFrom)),
    featured: shown.filter((g) => featuredIds.has(g.entry.id)).map((g) => withoutRating(g.entry)),
    ...(average === null ? {} : { ladderAverage: average }),
  };
}

