import {
  HISTORY_VERSION, isDailyDay, isObject, lobbyKind, lobbyStandings, parsePvpRecord, parseRunRecord, seatRun,
  toRunRecord, type HistoryEntry, type LobbyRecord, type RatingChange,
} from '../../src/game';
import { opponentName, type FriendGame } from '../../src/app/friendApi';
import { PLAYED_PAGE, type PlayedGame } from '../../src/app/playedApi';
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
 * can't be read: the page stops before its game, so the app asks again.
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

/** Your rating before and after a rated game, as shown (rounded); null if it wasn't rated for you. */
async function ratingChange(db: D1Database, gameId: string, player: Player): Promise<RatingChange | null> {
  if (!player.accountId) return null;
  const row = await db.prepare('SELECT rating_before, rating_after FROM rated_games WHERE game_id = ?1 AND account_id = ?2')
    .bind(gameId, player.accountId).first<{ rating_before: number; rating_after: number }>();
  return row ? { before: Math.round(row.rating_before), after: Math.round(row.rating_after) } : null;
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
 * Without `rated` (a friend's profile, which never shows a rating), no rating is looked up.
 */
export async function toPlayed(
  env: Env, row: GameRow, player: Player, ids: readonly string[], rated = true,
): Promise<PlayedGame | null> {
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
    const rating = rated ? await lookup(() => ratingChange(env.DB, row.id, player)) : null;
    const entry: HistoryEntry = { ...base, mode: 'friend', record, seat: room.seat, opponent, rating, marks: {} };
    return { entry, ref: row.id };
  }
  if (row.mode === 'daily') {
    const day = row.id.split(':')[1];
    const record = parseRunRecord(data);
    if (!record || !isDailyDay(day)) return null;
    return { entry: { ...base, mode: 'daily', day, record, marks: record.words.map(() => ({})) }, ref: day };
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
      ...base, mode: 'lobby', kind: lobbyKind(lobby), record, places, rating: rated ? await lookup(() => ratingChange(env.DB, row.id, player)) : null,
      marks: record.words.map(() => ({})),
    };
    return { entry, ref: lobby.code };
  }
  return null;
}

/** A page of a player's games; `stopped` when a lookup failed for now, the page ending before that game. */
export interface PlayedGamesPage {
  games: PlayedGame[];
  next: number | null;
  cursor: number;
  stopped: boolean;
}

/** The player's finished server games after `after`, a page at a time, in the order they finished. */
export async function playedPage(env: Env, player: Player, after: number): Promise<PlayedGamesPage> {
  const ids = [player.id, ...player.aliases];
  const { results } = await env.DB.prepare(
    `SELECT rowid AS seq, id, mode, record, finished_at FROM games
     WHERE finished_at IS NOT NULL AND rowid > ?1
       AND id IN (SELECT game_id FROM game_players WHERE ${isPlayers('guest_id', '?2')})
     ORDER BY rowid LIMIT ${PLAYED_PAGE + 1}`,
  ).bind(after, player.id).all<GameRow>();
  const page = results.slice(0, PLAYED_PAGE);
  const games: PlayedGame[] = [];
  let cursor = after;
  for (const row of page) {
    let played: PlayedGame | null;
    try {
      played = await toPlayed(env, row, player, ids);
    } catch (e) {
      // A lookup failed for now: stop before this game, so the next pull asks for it again.
      if (e instanceof TryAgain) return { games, next: null, cursor, stopped: true };
      // A game that can't be read never holds up the rest.
      played = null;
    }
    if (played) games.push({ ...played, seq: row.seq });
    cursor = row.seq;
  }
  return { games, next: results.length > PLAYED_PAGE ? cursor : null, cursor, stopped: false };
}

/** Routes `/api/played`, or returns null for any other path. */
export async function routePlayed(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/played') return null;
  if (request.method !== 'GET') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const after = Number(new URL(request.url).searchParams.get('after') ?? 0);
  if (!Number.isSafeInteger(after) || after < 0) return errorResponse(400, 'bad-request');
  const { games, next, cursor } = await playedPage(env, who.player, after);
  return json({ games, next, cursor });
}
