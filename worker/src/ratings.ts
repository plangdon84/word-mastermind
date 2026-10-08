import { ageRating, NEW_RATING, rateGame, rateGroup, type Rating, type RatingPool, type Seat } from '../../src/game';
import { showRating, type PoolRating } from '../../src/app/ratingsApi';
import { identify } from './accounts';
import { errorResponse, json } from './http';
import type { Env } from './index';

/*
 * Ratings in D1 (`ratings`, `rated_games`; README "Rating"): Glicko-2 from
 * `src/game/rating.ts`, applied to rated games the server refereed. Each
 * game is its own rating period, and a rating read now has widened for
 * each week since its last game.
 */

interface RatingRow {
  rating: number;
  rd: number;
  volatility: number;
  games: number;
  rated_at: number;
}

const toRating = (row: RatingRow): Rating => ({ rating: row.rating, rd: row.rd, volatility: row.volatility });

/** A player's rating in a pool as of `now`: a new player's if they have none. */
export async function currentRating(db: D1Database, accountId: string, pool: RatingPool, now: number): Promise<Rating> {
  const row = await db.prepare('SELECT rating, rd, volatility, games, rated_at FROM ratings WHERE account_id = ?1 AND pool = ?2')
    .bind(accountId, pool).first<RatingRow>();
  return row ? ageRating(toRating(row), now - row.rated_at) : NEW_RATING;
}

/** Both players' ratings in a pool as of `now`. */
export async function ratingsOf(db: D1Database, players: Record<Seat, string>, pool: RatingPool, now: number): Promise<Record<Seat, Rating>> {
  return { host: await currentRating(db, players.host, pool, now), guest: await currentRating(db, players.guest, pool, now) };
}

/** One player's rating before and after a game. */
export interface RatingChange {
  before: Rating;
  after: Rating;
}

/**
 * Rates a finished game: both players' new ratings from their current ones
 * and the host's score, with the ratings it started from. Those can differ
 * from the ratings when the game began, since other rated games may have
 * finished meanwhile (issue #156). The caller makes sure each game is rated
 * once.
 */
export async function rateFinishedGame(
  db: D1Database, gameId: string, pool: RatingPool, players: Record<Seat, string>, hostScore: 0 | 0.5 | 1, now: number,
): Promise<Record<Seat, RatingChange>> {
  const before = await ratingsOf(db, players, pool, now);
  const [host, guest] = rateGame(before.host, before.guest, hostScore);
  const after: Record<Seat, Rating> = { host, guest };
  await db.batch((['host', 'guest'] as const)
    .flatMap((seat) => ratingStatements(db, gameId, pool, players[seat], before[seat], after[seat], now)));
  return { host: { before: before.host, after: host }, guest: { before: before.guest, after: guest } };
}

interface RatedGameRow {
  account_id: string;
  rating_before: number;
  rd_before: number | null;
  rating_after: number;
  rd_after: number;
}

/**
 * Rates a finished game of several players (Competitive Rush): each pair by
 * their places (`rateGroup`). Returns each account's change, by account ID.
 * A game is rated once: asked again, it returns the changes it stored. The
 * writes are one batch, so a failure leaves the game unrated, to rate again.
 */
export async function rateGroupGame(
  db: D1Database, gameId: string, pool: RatingPool, players: readonly { accountId: string; place: number }[], now: number,
): Promise<Record<string, RatingChange>> {
  const { results: rated } = await db.prepare(
    'SELECT account_id, rating_before, rd_before, rating_after, rd_after FROM rated_games WHERE game_id = ?1',
  ).bind(gameId).all<RatedGameRow>();
  if (rated.length > 0) {
    const { volatility } = NEW_RATING;
    return Object.fromEntries(rated.map((r) => [r.account_id, {
      before: { rating: r.rating_before, rd: r.rd_before ?? NEW_RATING.rd, volatility },
      after: { rating: r.rating_after, rd: r.rd_after, volatility },
    }]));
  }
  const before = await Promise.all(players.map((p) => currentRating(db, p.accountId, pool, now)));
  const after = rateGroup(players.map((p, i) => ({ rating: before[i], place: p.place })));
  await db.batch(players.flatMap(({ accountId }, i) => ratingStatements(db, gameId, pool, accountId, before[i], after[i], now)));
  return Object.fromEntries(players.map(({ accountId }, i) => [accountId, { before: before[i], after: after[i] }]));
}

/** Keeping a player's new rating, and the game's change to it: to run in one batch with the other players'. */
function ratingStatements(
  db: D1Database, gameId: string, pool: RatingPool, accountId: string, before: Rating, after: Rating, now: number,
): D1PreparedStatement[] {
  const { rating, rd, volatility } = after;
  return [
    db.prepare(
      `INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)
       ON CONFLICT (account_id, pool) DO UPDATE SET rating = ?3, rd = ?4, volatility = ?5, games = games + 1, rated_at = ?6`,
    ).bind(accountId, pool, rating, rd, volatility, now),
    db.prepare(
      `INSERT OR IGNORE INTO rated_games (game_id, account_id, pool, rating_before, rd_before, rating_after, rd_after, rated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(gameId, accountId, pool, before.rating, before.rd, rating, rd, now),
  ];
}

/** An account's ratings, in every pool it has played a rated game in. */
export async function listRatings(db: D1Database, accountId: string, now: number): Promise<PoolRating[]> {
  const { results } = await db.prepare('SELECT pool, rating, rd, volatility, games, rated_at FROM ratings WHERE account_id = ?1')
    .bind(accountId).all<RatingRow & { pool: RatingPool }>();
  return results.map((row) => ({ pool: row.pool, ...showRating(ageRating(toRating(row), now - row.rated_at)), games: row.games }));
}

/** Forgets an account's ratings, when it's deleted. */
export async function deleteRatings(db: D1Database, accountId: string): Promise<void> {
  await db.prepare('DELETE FROM ratings WHERE account_id = ?1').bind(accountId).run();
  await db.prepare('DELETE FROM rated_games WHERE account_id = ?1').bind(accountId).run();
}

/** `GET /api/ratings`: your ratings, signed in. Returns null for any other path. */
export async function routeRatings(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/ratings') return null;
  if (request.method !== 'GET') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  if (!who.player.accountId) return errorResponse(401, 'signed-out');
  return json({ ratings: await listRatings(env.DB, who.player.accountId, now) });
}
