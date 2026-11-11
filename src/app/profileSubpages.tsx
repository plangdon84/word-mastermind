import { useEffect, useMemo, useState } from 'preact/hooks';
import { type EarnedBadge, type StatsGame } from '../game';
import { computeStats } from '../game/stats';
import type { ApiIdentity } from './apiIdentity';
import { Analytics, type RatingsState } from './Analytics';
import { Achievements } from './Badge';
import { loadBadgeNotices, markBadgesSeen } from './badges';
import { API_URL } from './config';
import type { HistoryGame } from './historyDb';
import { fetchRatings, type PoolRating } from './ratingsApi';

/*
 * The profile's Stats and Achievements subpages. Their own module so the
 * stats and badges they work out load after the page has (Dev Plan item
 * 19zq); import them from `screens.ts`.
 */

/** The profile's stats subpage, from every saved game. */
export function StatsPage({ games, replayed, identity, signedIn, onOpen }: {
  games: HistoryGame[] | null;
  /** The same games as stats read them (`statsGame`). */
  replayed: StatsGame[] | null;
  identity: ApiIdentity;
  signedIn: boolean;
  onOpen: (game: HistoryGame) => void;
}) {
  const [ratingList, setRatingList] = useState<PoolRating[] | null>(null);
  useEffect(() => {
    let live = true;
    if (API_URL && signedIn) void fetchRatings(API_URL, identity).then((list) => live && setRatingList(list));
    return () => {
      live = false;
    };
  }, [identity, signedIn]);
  const ratings: RatingsState | undefined = API_URL ? { signedIn, list: signedIn ? ratingList : null } : undefined;
  const stats = useMemo(() => replayed && computeStats(replayed, Date.now()), [replayed]);
  return <Analytics stats={stats} games={games ?? []} onOpen={onOpen} ratings={ratings} />;
}

/** The profile's achievements subpage: every badge, earned or not, from every saved game. */
export function AchievementsPage({ earned }: { earned: EarnedBadge[] | null }) {
  // Badges new since you last looked are marked as such here, and the profile dot goes.
  const [fresh] = useState(() => new Set(loadBadgeNotices().unseen));
  useEffect(markBadgesSeen, []);
  return <Achievements earned={earned} fresh={fresh} />;
}
