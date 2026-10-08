import { isCount, isObject, isRatingPool, type RatingPool } from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';
import { isShownRating, type ShownRating } from './ratingsApi';

/*
 * The Leaderboards page (README "Leaderboards"): a board per rating pool,
 * read from the server when opened, and the Daily Rush board (`dailyApi`).
 * The worker imports these shapes too.
 */

/** Who a board lists: everyone, or (signed in) you and your friends. */
export type Circle = 'everyone' | 'friends';

export const isCircle = (value: unknown): value is Circle => value === 'everyone' || value === 'friends';

/** A rating board lists the top 100. */
export const RATING_BOARD_SIZE = 100;

/** One row of a rating board: never the player's ID, only whether it's yours. */
export interface RatingBoardRow {
  /** Ties (the same rounded rating) share a rank. */
  rank: number;
  name: string;
  /** Rounded to a whole number; never provisional, since provisional players aren't listed. */
  rating: number;
  /** Rated games played in this pool. */
  games: number;
  you: boolean;
}

/** Your rating in the board's pool. */
export interface YourRatingPlace {
  rating: ShownRating;
  games: number;
  /** Your place, or null while your rating is provisional. */
  rank: number | null;
  /** About how many more rated games until you're listed: 0 once you are. */
  gamesToList: number;
}

export interface RatingBoard {
  pool: RatingPool;
  circle: Circle;
  /** How many players are listed (not provisional) in all. */
  total: number;
  /** The top 100 by rating. */
  top: RatingBoardRow[];
  /** Your place, signed in; null for a guest. */
  you: YourRatingPlace | null;
}


export function parseRatingBoard(value: unknown): RatingBoard | null {
  if (!isObject(value)) return null;
  const { pool, circle, total } = value;
  if (!isRatingPool(pool) || !isCircle(circle) || !isCount(total) || !Array.isArray(value.top)) return null;
  const top: RatingBoardRow[] = [];
  for (const row of value.top) {
    if (!isObject(row) || !isCount(row.rank) || typeof row.name !== 'string' || typeof row.rating !== 'number') return null;
    if (!isCount(row.games) || typeof row.you !== 'boolean') return null;
    top.push({ rank: row.rank, name: row.name, rating: row.rating, games: row.games, you: row.you });
  }
  let you: YourRatingPlace | null = null;
  if (value.you !== null) {
    const v = value.you;
    if (!isObject(v) || !isShownRating(v.rating) || !isCount(v.games) || !(v.rank === null || isCount(v.rank))) return null;
    if (!isCount(v.gamesToList)) return null;
    you = {
      rating: { rating: v.rating.rating, provisional: v.rating.provisional }, games: v.games, rank: v.rank,
      gamesToList: v.gamesToList,
    };
  }
  return { pool, circle, total, top, you };
}

/** A request the server refused, with its reason, or `unreachable`. */
export class LeaderboardError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

/** A pool's rating board. Rejects with a `LeaderboardError`. */
export async function fetchRatingBoard(
  apiUrl: string, identity: ApiIdentity, pool: RatingPool, circle: Circle, fetchFn: typeof fetch = fetch,
): Promise<RatingBoard> {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new LeaderboardError(code, status));
  const board = parseRatingBoard(await request('GET', `/api/leaderboards/ratings?pool=${pool}&circle=${circle}`));
  if (!board) throw new LeaderboardError('bad-request', 200);
  return board;
}
