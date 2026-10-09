import { ageRating, FEATURES, gamesUntilListed, isProvisional, isRatingPool, NEW_RATING, PROVISIONAL_RD, type RatingPool } from '../../src/game';
import {
  isCircle, RATING_BOARD_SIZE, type Circle, type RatingBoard, type RatingBoardRow, type YourRatingPlace,
} from '../../src/app/leaderboardsApi';
import { showRating } from '../../src/app/ratingsApi';
import { identify } from './accounts';
import { friendCodeSql, NO_NAME } from './friends';
import { errorResponse, json } from './http';
import type { Env } from './index';
import { currentRating } from './ratings';

/*
 * The Leaderboards page (README "Leaderboards"): a board per rating pool,
 * read from D1 when asked for. The Daily Rush board is in `dailyRoutes.ts`.
 * Rows never carry a player's ID, only whether a row is yours.
 */

/**
 * SQL that `column` is you or one of your friends, `param` being your
 * account's ID: the accounts, and the guest IDs linked to them (for Daily
 * Rush results played before signing in). Only one bound parameter, since
 * D1 allows 100 at most and a list can have 200 friends.
 */
export function inCircle(column: string, param: string): string {
  const friends = `SELECT friend_id FROM friends WHERE account_id = ${param} AND state = 'friends'`;
  return `${column} IN (SELECT ${param} UNION ${friends}
    UNION SELECT id FROM guests WHERE account_id = ${param} OR account_id IN (${friends}))`;
}

interface BoardRow {
  account_id: string;
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  rated_at: number;
  name: string | null;
  friend_code: string | null;
}

/**
 * A pool's board as of `now`: everyone (or you and your friends) whose
 * rating isn't provisional, highest first; ties on the rounded rating share
 * a rank. With `accountId`, your place too.
 */
export async function ratingBoard(
  db: D1Database, pool: RatingPool, circle: Circle, accountId: string | null, now: number,
): Promise<RatingBoard> {
  // RD only widens with time, so a rating provisional when stored still is.
  const { results } = await db.prepare(
    `SELECT r.account_id, r.rating, r.rd, r.volatility, r.games, r.rated_at, COALESCE(p.name, p.guest_name) AS name,
       ${circle === 'friends' ? friendCodeSql('r.account_id', '?2') : 'NULL'} AS friend_code
     FROM ratings r LEFT JOIN profiles p ON p.account_id = r.account_id
     WHERE r.pool = ?1 AND r.rd <= ${PROVISIONAL_RD} ${circle === 'friends' ? `AND ${inCircle('r.account_id', '?2')}` : ''}
     ORDER BY r.rating DESC`,
  ).bind(pool, ...(circle === 'friends' ? [accountId] : [])).all<BoardRow>();
  const listed = results.filter((r) => !isProvisional(ageRating(r, now - r.rated_at)));
  const ranked: RatingBoardRow[] = [];
  listed.forEach((r, i) => {
    const rating = Math.round(r.rating);
    const rank = i > 0 && ranked[i - 1].rating === rating ? ranked[i - 1].rank : i + 1;
    ranked.push({
      rank, name: r.name ?? NO_NAME, rating, games: r.games, you: r.account_id === accountId, friendCode: r.friend_code,
    });
  });
  let you: YourRatingPlace | null = null;
  if (accountId) {
    const mine = ranked.find((r) => r.you);
    const row = await db.prepare('SELECT games FROM ratings WHERE account_id = ?1 AND pool = ?2')
      .bind(accountId, pool).first<{ games: number }>();
    const rating = row ? await currentRating(db, accountId, pool, now) : NEW_RATING;
    you = { rating: showRating(rating), games: row?.games ?? 0, rank: mine?.rank ?? null, gamesToList: mine ? 0 : gamesUntilListed(rating) };
  }
  return { pool, circle, total: ranked.length, top: ranked.slice(0, RATING_BOARD_SIZE), you };
}

/** Routes `/api/leaderboards…`, or returns null for any other path. */
export async function routeLeaderboards(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith('/api/leaderboards/')) return null;
  if (pathname !== '/api/leaderboards/ratings') return errorResponse(404, 'not-found');
  // Off for the 1.0 launch (the launch switches, `src/game/features.ts`).
  if (!FEATURES.ratingBoards) return errorResponse(404, 'off');
  if (request.method !== 'GET') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const params = new URL(request.url).searchParams;
  const pool = params.get('pool');
  const circle = params.get('circle') ?? 'everyone';
  if (!isRatingPool(pool) || !isCircle(circle)) return errorResponse(400, 'bad-request');
  // Anyone can see a board; only an account has friends, or a place on one.
  const { accountId } = who.player;
  if (circle === 'friends' && !accountId) return errorResponse(401, 'signed-out');
  return json(await ratingBoard(env.DB, pool, circle, accountId, now));
}
