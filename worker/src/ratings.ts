import { ageRating, NEW_RATING, rateGame, rateGroup, rateVsComputer, SHOWN_POOLS, type Rating, type RatingPool, type Seat } from '../../src/game';
import { showRating, type PoolRating } from '../../src/app/ratingsApi';
import type { Player } from './accounts';
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

/**
 * Which write of a player's rating row a change was worked out from (Dev
 * Plan item 19zl): its count of games and when it was last rated, or null
 * if they had no rating yet. Each write adds a game, so a row still at
 * these hasn't been written since.
 */
export interface RatingVersion {
  games: number;
  ratedAt: number;
}

/** A player's rating in a pool as of `now` (a new player's if they have none), with the row it was read from. */
async function readRating(
  db: D1Database, accountId: string, pool: RatingPool, now: number,
): Promise<{ rating: Rating; from: RatingVersion | null }> {
  const row = await db.prepare('SELECT rating, rd, volatility, games, rated_at FROM ratings WHERE account_id = ?1 AND pool = ?2')
    .bind(accountId, pool).first<RatingRow>();
  return row
    ? { rating: ageRating(toRating(row), now - row.rated_at), from: { games: row.games, ratedAt: row.rated_at } }
    : { rating: NEW_RATING, from: null };
}

/** A player's rating in a pool as of `now`: a new player's if they have none. */
export async function currentRating(db: D1Database, accountId: string, pool: RatingPool, now: number): Promise<Rating> {
  return (await readRating(db, accountId, pool, now)).rating;
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

/** One player's change in a game being rated: the statements to keep it are made from these. */
export interface PlayerChange {
  accountId: string;
  before: Rating;
  after: Rating;
  /** Their result (1 a win, ½ a draw, 0 a loss), kept on `rated_games` (item 19zh); none for Competitive Rush. */
  score?: 0 | 0.5 | 1;
  /**
   * The rating row `before` was read from (null: none yet). Given, the
   * game is rated only while every player's row is still at it, so a
   * rating another game wrote meanwhile is never overwritten (item 19zl).
   */
  from?: RatingVersion | null;
}

/**
 * The statements that rate a finished game of two (a rated game against a
 * friend), from the players' current ratings and the host's score, with the
 * ratings it started from. Those can differ from the ratings when the game
 * began, since other rated games may have finished meanwhile (issue #156).
 * Run in the same batch as the game's history, so both are kept or neither.
 */
export async function ratedGameChanges(
  db: D1Database, pool: RatingPool, players: Record<Seat, string>, hostScore: 0 | 0.5 | 1, now: number,
): Promise<PlayerChange[]> {
  const host = await readRating(db, players.host, pool, now);
  const guest = await readRating(db, players.guest, pool, now);
  const [hostAfter, guestAfter] = rateGame(host.rating, guest.rating, hostScore);
  return [
    { accountId: players.host, before: host.rating, after: hostAfter, score: hostScore, from: host.from },
    { accountId: players.guest, before: guest.rating, after: guestAfter, score: (1 - hostScore) as 0 | 0.5 | 1, from: guest.from },
  ];
}

/**
 * The player's change in a ladder game against a computer (Dev Plan item
 * 19p), whose own rating never moves (`rateVsComputer`): the player's
 * current rating going in, as for a game against a person.
 */
export async function computerGameChanges(
  db: D1Database, pool: RatingPool, accountId: string, computer: Rating, score: 0 | 0.5 | 1, now: number,
): Promise<PlayerChange[]> {
  const { rating: before, from } = await readRating(db, accountId, pool, now);
  return [{ accountId, before, after: rateVsComputer(before, computer, score), score, from }];
}

/**
 * Rates a finished game of two and returns each seat's change. A game is
 * rated once: asked again (a retry, or two saves at once), it changes
 * nothing and returns the changes stored the first time.
 */
export async function rateFinishedGame(
  db: D1Database, gameId: string, pool: RatingPool, players: Record<Seat, string>, hostScore: 0 | 0.5 | 1, now: number,
): Promise<Record<Seat, RatingChange>> {
  const { kept } = await batchRated(db, gameId,
    () => ratedGameChanges(db, pool, players, hostScore, now), (changes) => ratingStatements(db, gameId, pool, changes, now));
  return seatChanges(kept, players)!;
}

/** Tries at rating a game while other games keep changing its players' ratings, before its save fails (to be retried). */
const RATING_TRIES = 5;

/**
 * Works out a game's rating changes (`changesOf`) and runs the batch that
 * keeps them (`batchOf`, with `ratingStatements`), working them out again
 * if a player's rating changed in between, as when two of their games end
 * at once (item 19zl). Returns the changes and those the game was rated
 * with (`keptChanges`). Throws if it still can't, so the save is retried.
 */
export async function batchRated(
  db: D1Database, gameId: string, changesOf: () => Promise<PlayerChange[]>,
  batchOf: (changes: PlayerChange[]) => D1PreparedStatement[],
): Promise<{ changes: PlayerChange[]; kept: Record<string, RatingChange> }> {
  for (let tries = 1; ; tries++) {
    const changes = await changesOf();
    await db.batch(batchOf(changes));
    if (changes.length === 0) return { changes, kept: {} };
    const kept = await keptChanges(db, gameId, changes);
    if (Object.keys(kept).length > 0) return { changes, kept };
    if (tries >= RATING_TRIES) throw new Error('rating-changed');
  }
}

/** The changes a game was rated with, by account ID: these, if they're the ones stored, else the stored ones. */
export async function keptChanges(db: D1Database, gameId: string, changes: readonly PlayerChange[]): Promise<Record<string, RatingChange>> {
  const stored = await storedChanges(db, gameId);
  // These carry each rating's volatility, which the stored rows don't keep.
  const ours = changes.every((c) => stored[c.accountId]?.after.rating === c.after.rating && stored[c.accountId]?.after.rd === c.after.rd);
  return ours ? Object.fromEntries(changes.map((c) => [c.accountId, { before: c.before, after: c.after }])) : stored;
}

/** Changes by account ID as each seat's, or null if a seat has none. */
export function seatChanges(changes: Record<string, RatingChange>, players: Record<Seat, string>): Record<Seat, RatingChange> | null {
  const host = changes[players.host];
  const guest = changes[players.guest];
  return host && guest ? { host, guest } : null;
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
  const stored = await storedChanges(db, gameId);
  if (Object.keys(stored).length > 0) return stored;
  const { kept } = await batchRated(db, gameId, async () => {
    const before = await Promise.all(players.map((p) => readRating(db, p.accountId, pool, now)));
    const after = rateGroup(players.map((p, i) => ({ rating: before[i].rating, place: p.place })));
    return players.map(({ accountId }, i) => ({ accountId, before: before[i].rating, after: after[i], from: before[i].from }));
  }, (changes) => ratingStatements(db, gameId, pool, changes, now));
  return kept;
}

/** A rated game's stored changes, by account ID: none if it hasn't been rated. */
async function storedChanges(db: D1Database, gameId: string): Promise<Record<string, RatingChange>> {
  const { results: rated } = await db.prepare(
    'SELECT account_id, rating_before, rd_before, rating_after, rd_after FROM rated_games WHERE game_id = ?1',
  ).bind(gameId).all<RatedGameRow>();
  const { volatility } = NEW_RATING;
  return Object.fromEntries(rated.map((r) => [r.account_id, {
    before: { rating: r.rating_before, rd: r.rd_before ?? NEW_RATING.rd, volatility },
    after: { rating: r.rating_after, rd: r.rd_after, volatility },
  }]));
}

/**
 * Keeping the players' new ratings and the game's changes to them, for one
 * batch (D1 runs a batch as one transaction). A game is rated once: if it
 * has changes kept already (`rated_games`), as when two saves of it
 * overlap, the second changes nothing. Changes worked out from rating rows
 * (`from`, as the game rooms and lobbies give) are kept only while every
 * player's row is still at the one read: the first statement keeps the
 * changes only then, and each rating changes only if its change was kept
 * just now and its row hasn't moved. So a rating another game wrote
 * meanwhile is never overwritten (item 19zl): nothing is kept, and
 * `batchRated` works the changes out again. Each row keeps the player's
 * result (`score`). `computerRecall` marks a ladder game against a
 * computer (Dev Plan item 19p), also counted on the player's rating row for
 * the boards (`computer_games`, item 19x).
 */
export function ratingStatements(
  db: D1Database, gameId: string, pool: RatingPool, changes: readonly PlayerChange[], now: number, computerRecall?: number,
): D1PreparedStatement[] {
  if (changes.length === 0) return [];
  const recall = computerRecall ?? null;
  const computerGame = computerRecall === undefined ? 0 : 1;
  const update = `ON CONFLICT (account_id, pool) DO UPDATE SET
         rating = ?3, rd = ?4, volatility = ?5, games = games + 1, rated_at = ?6, computer_games = computer_games + ?8`;
  if (changes.some((c) => c.from === undefined)) {
    // Unchecked (tests, and re-rating the whole history): rated whatever the ratings now.
    return [
      ...changes.map(({ accountId, after: { rating, rd, volatility } }) => db.prepare(
        `INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at, computer_games)
         SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6, ?8 WHERE NOT EXISTS (SELECT 1 FROM rated_games WHERE game_id = ?7)
         ${update}`,
      ).bind(accountId, pool, rating, rd, volatility, now, gameId, computerGame)),
      ...changes.map(({ accountId, before, after, score }) => db.prepare(
        `INSERT OR IGNORE INTO rated_games (game_id, account_id, pool, rating_before, rd_before, rating_after, rd_after, rated_at, computer_recall, score)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      ).bind(gameId, accountId, pool, before.rating, before.rd, after.rating, after.rd, now, recall, score ?? null)),
    ];
  }
  // ?1 game, ?2 pool, ?3 time, ?4 recall; then six values a player and three for their row.
  const values: unknown[] = [gameId, pool, now, recall];
  const param = (value: unknown) => `?${values.push(value)}`;
  const rows = changes.map(({ accountId, before, after, score }) => `(?1, ${param(accountId)}, ?2, ${param(before.rating)}, ${
    param(before.rd)}, ${param(after.rating)}, ${param(after.rd)}, ?3, ?4, ${param(score ?? null)})`);
  const unmoved = changes.map(({ accountId, from }) => {
    const id = param(accountId);
    const column = (name: string) => `(SELECT ${name} FROM ratings WHERE account_id = ${id} AND pool = ?2)`;
    return ` AND ${column('games')} IS ${param(from?.games ?? null)} AND ${column('rated_at')} IS ${param(from?.ratedAt ?? null)}`;
  });
  return [
    db.prepare(
      `INSERT OR IGNORE INTO rated_games (game_id, account_id, pool, rating_before, rd_before, rating_after, rd_after, rated_at, computer_recall, score)
       SELECT * FROM (VALUES ${rows.join(', ')})
       WHERE NOT EXISTS (SELECT 1 FROM rated_games WHERE game_id = ?1)${unmoved.join('')}`,
    ).bind(...values),
    ...changes.map(({ accountId, after: { rating, rd, volatility }, from }) => db.prepare(
      `INSERT INTO ratings (account_id, pool, rating, rd, volatility, games, rated_at, computer_games)
       SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6, ?8
       WHERE EXISTS (SELECT 1 FROM rated_games WHERE game_id = ?7 AND account_id = ?1 AND rated_at = ?6 AND rating_after = ?3 AND rd_after = ?4)
         AND (SELECT games FROM ratings WHERE account_id = ?1 AND pool = ?2) IS ?9
         AND (SELECT rated_at FROM ratings WHERE account_id = ?1 AND pool = ?2) IS ?10
       ${update}`,
    ).bind(accountId, pool, rating, rd, volatility, now, gameId, computerGame, from?.games ?? null, from?.ratedAt ?? null)),
  ];
}

/**
 * An account's ratings, in every pool it has played a rated game in that's
 * still shown (`SHOWN_POOLS`): never the retired clock pools, frozen since
 * Dev Plan item 19p.
 */
export async function listRatings(db: D1Database, accountId: string, now: number): Promise<PoolRating[]> {
  const { results } = await db.prepare(
    'SELECT pool, rating, rd, volatility, games, rated_at FROM ratings WHERE account_id = ?1 AND pool IN (SELECT value FROM json_each(?2))',
  ).bind(accountId, JSON.stringify(SHOWN_POOLS)).all<RatingRow & { pool: RatingPool }>();
  return results.map((row) => ({ pool: row.pool, ...showRating(ageRating(toRating(row), now - row.rated_at)), games: row.games }));
}

/** Forgetting an account's ratings, when it's deleted: statements for its batch. */
export const deleteRatings = (db: D1Database, accountId: string): D1PreparedStatement[] => [
  db.prepare('DELETE FROM ratings WHERE account_id = ?1').bind(accountId),
  db.prepare('DELETE FROM rated_games WHERE account_id = ?1').bind(accountId),
];

/** `GET /api/ratings`: your ratings, signed in. */
export async function routeRatings(env: Env, now: number, player: Player): Promise<Response> {
  if (!player.accountId) return errorResponse(401, 'signed-out');
  return json({ ratings: await listRatings(env.DB, player.accountId, now) });
}
