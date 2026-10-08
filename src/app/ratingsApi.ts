import { isObject, isProvisional, isRatingPool, RATING_POOLS, type Rating, type RatingPool } from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';

/*
 * Ratings (README "Rating"), as the server shows them: rounded, and marked
 * provisional while RD is high. The worker imports these shapes too.
 */

/** A rating as shown: 1512, or 1512? while provisional. */
export interface ShownRating {
  rating: number;
  provisional: boolean;
}

export const showRating = (rating: Rating): ShownRating => ({ rating: Math.round(rating.rating), provisional: isProvisional(rating) });

export const ratingText = (shown: ShownRating) => `${shown.rating}${shown.provisional ? '?' : ''}`;

/** One of your ratings: its pool and how many rated games are in it. */
export interface PoolRating extends ShownRating {
  pool: RatingPool;
  games: number;
}

export const POOL_LABEL: Record<RatingPool, string> = {
  '15m': '15 min', '10m': '10 min', '5m': '5 min', correspondence: 'Correspondence', rush: 'Competitive Rush',
};

/** The same, short enough for the stats headline's Rating tile on a 320px phone (issue 182). */
export const POOL_SHORT_LABEL: Record<RatingPool, string> = {
  ...POOL_LABEL, correspondence: 'Corresp.', rush: 'Rush',
};

export const isShownRating = (value: unknown): value is ShownRating =>
  isObject(value) && typeof value.rating === 'number' && typeof value.provisional === 'boolean';

/** Reads `GET /api/ratings` defensively, in pool order; unknown pools are dropped. */
export function parseRatings(value: unknown): PoolRating[] | null {
  if (!isObject(value) || !Array.isArray(value.ratings)) return null;
  const ratings = value.ratings.filter((r: unknown): r is PoolRating =>
    isShownRating(r) && isObject(r) && isRatingPool(r.pool) && typeof r.games === 'number');
  return RATING_POOLS.flatMap((pool) => ratings.filter((r) => r.pool === pool)
    .map(({ rating, provisional, games }) => ({ pool, rating, provisional, games })));
}

/** Your ratings, signed in; null if the server can't be reached or you're signed out. */
export async function fetchRatings(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): Promise<PoolRating[] | null> {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new Error(`The server answered ${status}: ${code}`));
  return request('GET', '/api/ratings').then(parseRatings, () => null);
}
