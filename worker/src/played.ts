import {
  HISTORY_VERSION, isDailyDay, isObject, lobbyKind, lobbyStandings, parsePvpRecord, parseRunRecord, seatRun,
  toRunRecord, type HistoryEntry, type LobbyRecord, type RatingChange,
} from '../../src/game';
import { opponentName, type FriendGame } from '../../src/app/friendApi';
import { PLAYED_PAGE, PLAYED_RETRIES, type PlayedGame } from '../../src/app/playedApi';
import { identify, isPlayers, type Player } from './accounts';
import { errorResponse, json } from './http';
import type { Env } from './index';

/*
 * `GET /api/played`: the games the server refereed that you played (README
 * "Game history"), each as a history entry from your side, for the app to
 * add to your history. Guests get theirs too, by their guest ID; an account
 * gets every one of its guest IDs' games. The server builds each entry from
 * what it kept, so nothing here can be made up by the app.
 */

/** A `games` row. `seq` is its rowid: rows are added as games finish, so it only grows. */
export interface GameRow {
  seq: number;
  id: string;
  mode: string;
  record: string;
  /** When it ended; for a lobby, when the last run ended or the time ran out (`lobbyEndedAt`). */
  finished_at: number;
}

const GAME_ID = /^[0-9a-f]{64}$/;

/** A history entry's ID for a server game: its hash, so a friend game's ID (a credential) never reaches a backup file. */
async function entryId(mode: string, gameId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(gameId));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${mode}-${hex.slice(0, 40)}`;
}

/**
 * A lookup that failed for now (a busy room, the database), not a game that
 * can't be read: the page passes over its game for the app to ask for again
 * (`skip`), or stops before it, so the app asks again.
 */
export class TryAgain extends Error {}

/** Runs a lookup, turning any failure into `TryAgain`. */
async function lookup<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw new TryAgain();
  }
}

/**
 * Your rating before and after each of these games that was rated for you,
 * as shown (rounded), in one query: a request may make only so many calls.
 */
async function ratingChanges(db: D1Database, rows: readonly GameRow[], player: Player): Promise<Map<string, RatingChange>> {
  const ids = rows.filter((r) => r.mode === 'friend' || r.mode === 'lobby').map((r) => r.id);
  if (!player.accountId || ids.length === 0) return new Map();
  const { results } = await db.prepare(
    'SELECT game_id, rating_before, rating_after FROM rated_games WHERE account_id = ?1 AND game_id IN (SELECT value FROM json_each(?2))',
  ).bind(player.accountId, JSON.stringify(ids)).all<{ game_id: string; rating_before: number; rating_after: number }>();
  return new Map(results.map((r) => [r.game_id, { before: Math.round(r.rating_before), after: Math.round(r.rating_after) }]));
}

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * One game as your history entry, or null if it can't be (a room that's gone, a record that doesn't read).
 * `ratings` are your rating changes by game ID (`ratingChanges`); without them (a friend's profile, which
 * never shows a rating), every game's rating is null.
 */
export async function toPlayed(
  env: Env, row: GameRow, player: Player, ids: readonly string[], ratings: ReadonlyMap<string, RatingChange> | null,
): Promise<PlayedGame | null> {
  const rating = ratings ? ratings.get(row.id) ?? null : null;
  const base = { id: await entryId(row.mode, row.id), version: HISTORY_VERSION };
  const data = parse(row.record);
  if (row.mode === 'friend') {
    const record = parsePvpRecord(data);
    if (!record || !GAME_ID.test(row.id)) return null;
    // Which seat is yours, and the names, are the room's.
    const room = await lookup(async () => {
      const response = await env.GAMES.get(env.GAMES.idFromString(row.id)).fetch('https://room/', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'get', guestId: player.id, aliases: player.aliases }),
      });
      // A room that isn't there has nothing to give; any other failure is worth another try.
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`The room answered ${response.status}`);
      return await response.json() as FriendGame;
    });
    const opponent = room && opponentName(room);
    if (!room?.seat || !opponent) return null;
    const entry: HistoryEntry = { ...base, mode: 'friend', record, seat: room.seat, opponent, rating, marks: {} };
    return { entry, ref: row.id };
  }
  if (row.mode === 'daily' || row.mode === 'dailyWord') {
    const day = row.id.split(':')[1];
    const record = parseRunRecord(data);
    if (!record || !isDailyDay(day) || (row.mode === 'dailyWord' && record.words.length !== 1)) return null;
    return { entry: { ...base, mode: row.mode, day, record, marks: record.words.map(() => ({})) }, ref: day };
  }
  if (row.mode === 'lobby') {
    if (!isObject(data) || !isObject(data.game)) return null;
    const lobby = data as unknown as LobbyRecord;
    const game = lobby.game!;
    const index = game.seats.findIndex((s) => ids.includes(s.id));
    if (index < 0) return null;
    // The runs and places as they stood when it ended, as the server scored them then.
    const at = row.finished_at;
    const record = toRunRecord(seatRun(game, index, at));
    const places = lobbyStandings(game, at, ids).map((s) => ({
      name: s.name, strength: s.strength, you: s.you, rank: s.rank, score: s.score, seconds: s.seconds,
    }));
    const entry: HistoryEntry = {
      ...base, mode: 'lobby', kind: lobbyKind(lobby), record, places, rating,
      marks: record.words.map(() => ({})),
    };
    return { entry, ref: lobby.code };
  }
  return null;
}

/**
 * A page of a player's games; `stopped` when a lookup failed for now, the
 * page ending before that game. `retried` are the games asked for again that
 * came this time, and `retry` those passed over that failed for now.
 */
export interface PlayedGamesPage {
  games: PlayedGame[];
  retried: PlayedGame[];
  retry: number[];
  next: number | null;
  cursor: number;
  stopped: boolean;
}

/**
 * Games to ask for again (`retry`, their `seq`s) and how many games that
 * fail for now the page may pass over (`skip`). Both are at most
 * `PLAYED_RETRIES`, so a request makes only a few more room lookups and an
 * outage still stops the page; without them (an older app), a game that
 * fails for now stops it, as before.
 */
export interface PlayedRetries {
  retry?: readonly number[];
  skip?: number;
}

const AGAIN = Symbol('again');

/** One row as your game, null if it can't be one, or `AGAIN` if a lookup failed for now. */
async function tryPlayed(
  env: Env, row: GameRow, player: Player, ids: readonly string[], ratings: ReadonlyMap<string, RatingChange>,
): Promise<PlayedGame | null | typeof AGAIN> {
  try {
    return await toPlayed(env, row, player, ids, ratings);
  } catch (e) {
    if (e instanceof TryAgain) return AGAIN;
    // A game that can't be read never holds up the rest.
    return null;
  }
}

/**
 * The next page of games after `?1` (a `games` rowid) for the player `?2`
 * and every guest ID of their account, and one more to say there are more.
 * Each ID's next few are read in order through `game_players_by_guest_seq`
 * from the cursor and stop at the page's size (Issue 209), so a long
 * history costs no more than a short one; the earliest of them all are the
 * page, as none of any ID's comes between.
 */
export const NEXT_PLAYED_SQL = `SELECT g.rowid AS seq, g.id, g.mode, g.record, g.finished_at FROM games g
  WHERE g.finished_at IS NOT NULL AND g.rowid IN (
    SELECT next.value FROM (SELECT ?2 AS id UNION SELECT id FROM guests WHERE account_id = ?2) ids,
      json_each((SELECT json_group_array(game_seq) FROM (
        SELECT gp.game_seq FROM game_players gp WHERE gp.guest_id = ids.id AND gp.game_seq > ?1
        ORDER BY gp.game_seq LIMIT ${PLAYED_PAGE + 1}))) next)
    -- And by the game's own ID, so a renumbered table could never hand over someone else's game.
    AND EXISTS (SELECT 1 FROM game_players p WHERE p.game_id = g.id AND p.game_seq = g.rowid AND ${isPlayers('p.guest_id', '?2')})
  ORDER BY g.rowid LIMIT ${PLAYED_PAGE + 1}`;

/** The player's finished server games after `after`, a page at a time, in the order they finished. */
export async function playedPage(
  env: Env, player: Player, after: number, { retry = [], skip = 0 }: PlayedRetries = {},
): Promise<PlayedGamesPage> {
  const ids = [player.id, ...player.aliases];
  // The games asked for again: only the player's own, and only ever a few.
  const asked = retry.length === 0 ? [] : (await env.DB.prepare(
    `SELECT rowid AS seq, id, mode, record, finished_at FROM games
     WHERE finished_at IS NOT NULL AND rowid IN (SELECT value FROM json_each(?1))
       AND id IN (SELECT game_id FROM game_players WHERE ${isPlayers('guest_id', '?2')})
     ORDER BY rowid LIMIT ${PLAYED_RETRIES}`,
  ).bind(JSON.stringify(retry), player.id).all<GameRow>()).results;
  const { results } = await env.DB.prepare(NEXT_PLAYED_SQL).bind(after, player.id).all<GameRow>();
  const page = results.slice(0, PLAYED_PAGE);
  // A room lookup each for the rest, at most PLAYED_PAGE + PLAYED_RETRIES: within a request's calls. If the
  // database fails here, the request does, and the app asks again with its place unchanged.
  const ratings = await ratingChanges(env.DB, [...asked, ...page], player);
  const retried: PlayedGame[] = [];
  const failing: number[] = [];
  for (const row of asked) {
    const played = await tryPlayed(env, row, player, ids, ratings);
    if (played === AGAIN) failing.push(row.seq);
    else if (played) retried.push({ ...played, seq: row.seq });
  }
  const games: PlayedGame[] = [];
  let cursor = after;
  let skips = skip;
  for (const row of page) {
    const played = await tryPlayed(env, row, player, ids, ratings);
    if (played === AGAIN) {
      // A lookup failed for now: pass over this game for the app to ask for again, or once it may pass
      // over no more, stop before it, so the next pull asks for it again.
      if (skips === 0) return { games, retried, retry: failing, next: null, cursor, stopped: true };
      skips -= 1;
      failing.push(row.seq);
    } else if (played) {
      games.push({ ...played, seq: row.seq });
    }
    cursor = row.seq;
  }
  return { games, retried, retry: failing, next: results.length > PLAYED_PAGE ? cursor : null, cursor, stopped: false };
}

/** A query's `retry` (comma-separated `seq`s) and `skip`, or null if they don't read. */
function parseRetries(params: URLSearchParams): PlayedRetries | null {
  const listed = params.get('retry');
  const retry = listed ? listed.split(',').map(Number) : [];
  const skip = Number(params.get('skip') ?? 0);
  if (retry.length > PLAYED_RETRIES || !retry.every((seq) => Number.isSafeInteger(seq) && seq > 0)) return null;
  if (!Number.isSafeInteger(skip) || skip < 0 || skip > PLAYED_RETRIES) return null;
  return { retry, skip };
}

/** Routes `/api/played`, or returns null for any other path. */
export async function routePlayed(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/played') return null;
  if (request.method !== 'GET') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const params = new URL(request.url).searchParams;
  const after = Number(params.get('after') ?? 0);
  const retries = parseRetries(params);
  if (!Number.isSafeInteger(after) || after < 0 || !retries) return errorResponse(400, 'bad-request');
  const { games, retried, retry, next, cursor } = await playedPage(env, who.player, after, retries);
  return json({ games, retried, retry, next, cursor });
}
