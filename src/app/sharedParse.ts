import { HEAD_TO_HEAD_MODES, HISTORY_MODES, isObject, isTime, type EarnedBadge, type HeadToHead, type HistoryMode, type Stats } from '../game';
import { computeStats } from '../game/stats';
import { BADGE_BY_ID } from '../game/achievements';
import {
  isTally, MAX_BADGES, MAX_FEATURED, parseEntries, parseFriendProfile, SHARED_FORMAT, type FriendProfileAnswer, type SharedSummary,
} from './friendsApi';
import { parseRatings } from './ratingsApi';

/*
 * Reading a friend's shared summary (README "Friends' profiles"). Apart from
 * `friendsApi.ts` because it checks badges and stats against the game's own
 * lists, which load after the page has (Dev Plan item 19zq): the app reads an
 * answer from here only when a friend's profile is asked for.
 */

/** Modes added since summaries were first shared, which an older app's summary leaves out. */
const LATER_MODES: readonly HistoryMode[] = ['dailyWord'];

/** The Rated ladder's stats, with every number its card shows: each win % from 0 to 100, or none (Dev Plan item 19za). */
const isLadderStats = (value: unknown) =>
  isObject(value) && Number.isSafeInteger(value.played)
  && [value.record, value.people, value.computers].every((r) => isTally(r) && isObject(r) && isWinPct(r.winPct))
  // Win %'s trend (Dev Plan item 19zd): none from an older app.
  && (value.winPctTrend === undefined || value.winPctTrend === null || isWinPctTrend(value.winPctTrend));

const isWinPctTrend = (value: unknown) =>
  isObject(value) && [value.current, value.previous].every((n) => n !== null && isWinPct(n))
  && typeof value.change === 'number' && Math.abs(value.change) <= 100;

/** The ladder's stats as a friend sees them: never how far their rating moved (Dev Plan item 19zd). */
function sharedLadder(value: Record<string, unknown>) {
  const { ratingTrend: _ratingTrend, ...ladder } = value;
  return ladder;
}

const isWinPct = (value: unknown) => value === null || (typeof value === 'number' && value >= 0 && value <= 100);

/**
 * A shared summary, checked as far as the app relies on it (the server
 * checks what a device sends with it too), or null if it isn't one.
 */
export function parseSharedSummary(value: unknown): SharedSummary | null {
  if (!isObject(value) || value.format !== SHARED_FORMAT || !Number.isSafeInteger(value.games)
    || (value.games as number) < 0 || !Array.isArray(value.badges) || value.badges.length > MAX_BADGES
    || !Array.isArray(value.featured) || value.featured.length > MAX_FEATURED) {
    return null;
  }
  const { stats } = value;
  if (!isObject(stats) || !isObject(stats.modes)) return null;
  // A summary shared before the Daily Word (Dev Plan item 7b) has no stats for it: none played.
  const modes: Record<string, unknown> = { ...stats.modes };
  for (const m of LATER_MODES) modes[m] ??= computeStats([], 0).modes[m];
  if (typeof stats.played !== 'number' || !isObject(stats.byDifficulty) || !Array.isArray(stats.topGuesses)
    || !HISTORY_MODES.every((m) => isObject(modes[m]))) {
    return null;
  }
  // The Rated ladder's stats (Dev Plan item 19t), kept only whole: a summary from an older app has none.
  const { ladder: _ladder, ...statsWithoutLadder } = stats;
  // Only badges this version knows, each once.
  const badges = new Map<string, EarnedBadge>();
  for (const b of value.badges) {
    if (isObject(b) && typeof b.id === 'string' && BADGE_BY_ID.has(b.id) && !badges.has(b.id) && isTime(b.at)
      && typeof b.gameId === 'string') {
      badges.set(b.id, { id: b.id, at: b.at, gameId: b.gameId });
    }
  }
  return {
    format: SHARED_FORMAT, games: value.games as number, stats: { ...statsWithoutLadder, modes, ...(isLadderStats(stats.ladder) ? { ladder: sharedLadder(stats.ladder as Record<string, unknown>) } : {}) } as unknown as Stats,
    badges: [...badges.values()],
    featured: parseEntries(value.featured),
    ...(typeof value.ladderAverage === 'number' && value.ladderAverage >= 1 && value.ladderAverage <= 1000
      ? { ladderAverage: value.ladderAverage } : {}),
  };
}

export function parseFriendProfileAnswer(value: unknown): FriendProfileAnswer | null {
  if (!isObject(value)) return null;
  const profile = parseFriendProfile(value.profile);
  // A summary this version can't read (from a newer app) shows as not shared yet.
  const summary = value.summary === null ? null : parseSharedSummary(value.summary);
  const { versus } = value;
  if (!profile || !isObject(versus) || !HEAD_TO_HEAD_MODES.every((m) => isTally(versus[m]))) return null;
  return { profile, summary, versus: versus as unknown as HeadToHead, ratings: parseRatings({ ratings: value.ratings ?? [] }) ?? [] };
}
