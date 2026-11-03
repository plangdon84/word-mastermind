import {
  ageRating, FEATURES, gamesUntilListed, GLICKO_SCALE, IDLE_PERIOD_MS, isProvisional, isRatingPool, NEW_RATING, PROVISIONAL_RD,
  type RatingPool,
} from '../../src/game';
import {
  isCircle, RATING_BOARD_SIZE, type Circle, type RatingBoard, type RatingBoardRow, type YourRatingPlace,
} from '../../src/app/leaderboardsApi';
import { showRating } from '../../src/app/ratingsApi';
import { identify } from './accounts';
import { friendCodeSql } from './friends';
import { errorResponse, json } from './http';
import type { Env } from './index';
import { shownName } from './names';

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
  games: number;
  computer_games: number;
  rank: number;
  total: number;
  name: string | null;
  friend_code: string | null;
}

/**
 * SQL that a `ratings` row (`r`) in pool `?1` is listed as of `?2`, the
 * time: its RD aged by `ageRating` (one empty period per whole idle week)
 * isn't provisional, worked out on the squares so it needs no square root.
 */
const LISTED = `r.pool = ?1 AND r.rd * r.rd
  + MAX(0, CAST((?2 - r.rated_at) / ${IDLE_PERIOD_MS} AS INTEGER)) * r.volatility * r.volatility * ${GLICKO_SCALE * GLICKO_SCALE}
  <= ${PROVISIONAL_RD * PROVISIONAL_RD}`;

/**
 * A pool's board as of `now`: everyone (or you and your friends, `?3`
 * being your account's ID) whose rating isn't provisional, highest first;
 * ties on the rounded rating share a rank. The database ranks and counts
 * them and sends only the top 100 (Dev Plan item 19n), whose names alone
 * are checked. With `accountId`, your place too, from your own row and,
 * if you're listed below the top, a count of those above you.
 */
export async function ratingBoard(
  db: D1Database, pool: RatingPool, circle: Circle, accountId: string | null, now: number,
): Promise<RatingBoard> {
  const only = circle === 'friends' ? `AND ${inCircle('r.account_id', '?3')}` : '';
  const args = [pool, now, ...(circle === 'friends' ? [accountId] : [])];
  const { results } = await db.prepare(
    `WITH top AS (
       SELECT r.account_id, r.rating, r.games, RANK() OVER (ORDER BY ROUND(r.rating) DESC) AS rank, COUNT(*) OVER () AS total
       FROM ratings r WHERE ${LISTED} ${only}
       ORDER BY r.rating DESC, r.account_id LIMIT ${RATING_BOARD_SIZE})
     SELECT t.account_id, t.rating, t.games, t.rank, t.total, COALESCE(p.name, p.guest_name) AS name,
       (SELECT COUNT(*) FROM rated_games g WHERE g.account_id = t.account_id AND g.pool = ?1 AND g.computer_recall IS NOT NULL) AS computer_games,
       ${circle === 'friends' ? friendCodeSql('t.account_id', '?3') : 'NULL'} AS friend_code
     FROM top t LEFT JOIN profiles p ON p.account_id = t.account_id
     ORDER BY t.rating DESC, t.account_id`,
  ).bind(...args).all<BoardRow>();
  const top = results.map((r): RatingBoardRow => ({
    // A name the profanity filter now refuses shows as no name, as on every board (`names.ts`).
    rank: r.rank, name: shownName(r.name), rating: Math.round(r.rating), games: r.games,
    computerGames: r.computer_games, you: r.account_id === accountId, friendCode: r.friend_code,
  }));
  let you: YourRatingPlace | null = null;
  if (accountId) {
    const row = await db.prepare('SELECT rating, rd, volatility, games, rated_at FROM ratings WHERE account_id = ?1 AND pool = ?2')
      .bind(accountId, pool).first<{ rating: number; rd: number; volatility: number; games: number; rated_at: number }>();
    const rating = row ? ageRating({ rating: row.rating, rd: row.rd, volatility: row.volatility }, now - row.rated_at) : NEW_RATING;
    let rank = top.find((r) => r.you)?.rank ?? null;
    if (rank === null && row && !isProvisional(rating)) {
      // Below the top 100: one more than those listed with a higher rounded rating, so ties share your rank.
      const above = await db.prepare(
        `SELECT COUNT(*) AS n FROM ratings r WHERE ${LISTED} ${only} AND ROUND(r.rating) > ROUND(?${args.length + 1})`,
      ).bind(...args, row.rating).first<number>('n');
      rank = (above ?? 0) + 1;
    }
    you = { rating: showRating(rating), games: row?.games ?? 0, rank, gamesToList: rank !== null ? 0 : gamesUntilListed(rating) };
  }
  return { pool, circle, total: results[0]?.total ?? 0, top, you };
}

/** Routes `/api/leaderboards…`, or returns null for any other path. */
export async function routeLeaderboards(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith('/api/leaderboards/')) return null;
  if (pathname !== '/api/leaderboards/ratings') return errorResponse(404, 'not-found');
  if (request.method !== 'GET') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const params = new URL(request.url).searchParams;
  const pool = params.get('pool');
  const circle = params.get('circle') ?? 'everyone';
  if (!isRatingPool(pool) || !isCircle(circle)) return errorResponse(400, 'bad-request');
  // Only the boards switched on (the launch switches, `src/game/features.ts`; Correspondence alone since item 19l).
  if (!FEATURES.ratingBoards.includes(pool)) return errorResponse(404, 'off');
  // Anyone can see a board; only an account has friends, or a place on one.
  const { accountId } = who.player;
  if (circle === 'friends' && !accountId) return errorResponse(401, 'signed-out');
  return json(await ratingBoard(env.DB, pool, circle, accountId, now));
}
