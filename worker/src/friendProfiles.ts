import {
  addDays, dailyDay, isServerMode, parseHistoryEntry, replayEntry, summarizeGame, type HeadToHead, type HistoryEntry,
} from '../../src/game';
import {
  MAX_SHARED_CHARS, parseSharedSummary, type FriendGamesQuery, type SharedSummary,
} from '../../src/app/friendsApi';
import { withoutRating } from '../../src/app/sharedSummary';
import { identify, isPlayers, playerOfAccount, type Player } from './accounts';
import { errorResponse, json } from './http';
import type { Env } from './index';
import { toPlayed, TryAgain, type GameRow } from './played';

/*
 * Friends' profiles kept ready (Dev Plan item 18cb, README "Friends'
 * profiles"), within the Workers Free plan's limits: about 10 ms and 50
 * calls a request. Working out stats and badges takes far longer for a
 * long history, so each player's own device works them out and shares them
 * (`/api/profile/shared`), kept as sent. Its games are indexed for friends
 * in `profile_games` a few at a time (`/api/profile/index`, which the
 * device asks for until it's done): synced games from history_entries, and
 * server games built by the server from what it refereed, so those can't
 * be made up. Opening a friend's profile then reads their shared summary
 * and counts your record against them in SQL, and their history pages are
 * one query each.
 */

/** The most synced games one index request copies, and server games it looks up. */
export const INDEX_SYNCED = 50;
export const INDEX_PLAYED = 10;
/** A Word Set with friends you weren't placed in, as its `rank`: after every place. */
const NOT_PLACED = 1_000_000;

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};


/** The entries of `profile_games` rows (a synced game's from history_entries), as a friend sees them. */
const entriesOf = (rows: readonly { entry: string | null }[]): HistoryEntry[] => rows.flatMap((r) => {
  const entry = r.entry === null ? null : parseHistoryEntry(parse(r.entry));
  return entry ? [withoutRating(entry)] : [];
});

/**
 * A friend sees a Daily Set or Daily Word from the day after it is over (a
 * run started before midnight can be finished the next day).
 */
const shownBefore = (now: number) => addDays(dailyDay(now), -1);

/** One game as a `profile_games` row, or null if it doesn't replay (the app wouldn't show it). */
function indexRow(entry: HistoryEntry, gameSeq: number | null) {
  const replayed = replayEntry(entry);
  if (!replayed) return null;
  const summary = summarizeGame(replayed);
  const you = replayed.mode === 'lobby' ? replayed.places.find((p) => p.you) : undefined;
  return {
    id: entry.id, startedAt: entry.record.startedAt, mode: entry.mode, result: summary.result, difficulty: summary.difficulty,
    words: ` ${[...summary.words].join(' ')} `, dailyDay: entry.mode === 'daily' || entry.mode === 'dailyWord' ? entry.day : null,
    rank: you ? you.rank ?? NOT_PLACED : null,
    gameSeq,
    // A synced game's entry stays in history_entries alone.
    entry: gameSeq === null ? null : JSON.stringify(withoutRating(entry)),
  };
}

/** Adds these rows to the account's index in one statement: a request may make only a few. */
async function insertRows(db: D1Database, accountId: string, rows: readonly (ReturnType<typeof indexRow>)[]) {
  const kept = rows.filter((r) => r !== null);
  if (kept.length === 0) return;
  const field = (name: string) => `json_extract(value, '$.${name}')`;
  await db.prepare(
    `INSERT OR IGNORE INTO profile_games
       (account_id, id, started_at, mode, result, difficulty, words, daily_day, rank, game_seq, entry)
     SELECT ?1, ${['id', 'startedAt', 'mode', 'result', 'difficulty', 'words', 'dailyDay', 'rank', 'gameSeq', 'entry']
    .map(field).join(', ')} FROM json_each(?2)`,
  ).bind(accountId, JSON.stringify(kept)).run();
}

interface IndexRow {
  synced_through: number;
  bookmarks: string;
  retry: string;
}

/** The longest stretch of synced games one request indexes, as JSON: parsing and replaying them takes time. */
const INDEX_SYNCED_CHARS = 200_000;
/** A server game's history ID: never a synced game's (sync refuses server modes), so one that looks like it is left out. */
const SERVER_ENTRY_ID = /^(?:friend|daily|dailyWord|lobby)-[0-9a-f]{40}$/;

/** Whether the account (`param`) has indexed game `g` already: one lookup in `profile_games_by_game`. */
const notIndexed = (param: string) => `NOT EXISTS (SELECT 1 FROM profile_games p WHERE p.account_id = ${param} AND p.game_seq = g.rowid)`;

/**
 * Each of a player's IDs (?1 the player's ID) with its next server games
 * past its own bookmark (?2, JSON: ID to `game_players` rowid; none is 0),
 * up to a request's worth, as a JSON array of `game_players` rowids. Each
 * ID's are read in order through `game_players_by_guest` from its bookmark
 * and stop at the limit, so only rows after the bookmarks are read, however
 * long the history; a newly linked guest ID starts from the beginning on
 * its own.
 */
export const NEXT_LINKS_SQL = `SELECT ids.id AS id, (SELECT json_group_array(link) FROM (
    SELECT gp.rowid AS link FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.guest_id = ids.id AND gp.rowid > COALESCE(json_extract(?2, '$."' || ids.id || '"'), 0)
      AND g.finished_at IS NOT NULL
    ORDER BY gp.rowid LIMIT ${INDEX_PLAYED + 1})) AS links
  FROM (SELECT ?1 AS id UNION SELECT id FROM guests WHERE account_id = ?1) ids`;

/** The games these `game_players` rowids (?1, JSON) are for, leaving out those the account (?2) has indexed already. */
export const LINKED_GAMES_SQL = `SELECT gp.rowid AS link, g.rowid AS seq, g.id, g.mode, g.record, g.finished_at
  FROM game_players gp JOIN games g ON g.id = gp.game_id
  WHERE gp.rowid IN (SELECT value FROM json_each(?1)) AND ${notIndexed('?2')} ORDER BY gp.rowid`;

/** The games to retry (?1, JSON games rowids) not yet indexed (?2 the account). */
export const RETRY_PLAYED_SQL = `SELECT 0 AS link, g.rowid AS seq, g.id, g.mode, g.record, g.finished_at FROM games g
  WHERE g.rowid IN (SELECT value FROM json_each(?1)) AND ${notIndexed('?2')} ORDER BY g.rowid`;

/** A server game row for `toPlayed`, with its `game_players` row (`link`), which indexing goes through in order. */
type LinkedRow = GameRow & { link: number };

/**
 * Indexes a few more of the account's games for friends: its synced games
 * first (`INDEX_SYNCED` a request), then its server games (`INDEX_PLAYED`
 * room lookups a request, and as many again for games to retry). Each
 * request reads only past its bookmarks, so a long history costs no more
 * than a short one. Server games go in the order the players were added to
 * them (as each game finished), each of the account's IDs from its own
 * bookmark, so a newly linked guest ID's are looked through from the start
 * while the others carry on; a game indexed already is passed over at the
 * cost of one lookup. A game whose room can't answer
 * for now is passed over and retried later. `done` once nothing is left
 * for now.
 */
export async function indexStep(env: Env, accountId: string): Promise<{ done: boolean }> {
  const db = env.DB;
  await db.prepare('INSERT OR IGNORE INTO shared_profiles (account_id) VALUES (?1)').bind(accountId).run();
  const row = await db.prepare('SELECT synced_through, bookmarks, retry FROM shared_profiles WHERE account_id = ?1')
    .bind(accountId).first<IndexRow>();
  if (!row) return { done: true };

  const { results } = await db.prepare(
    `SELECT seq, entry FROM history_entries WHERE account_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ${INDEX_SYNCED}`,
  ).bind(accountId, row.synced_through).all<{ seq: number; entry: string }>();
  if (results.length > 0) {
    let chars = 0;
    const page = results.filter((r) => (chars += r.entry.length) <= INDEX_SYNCED_CHARS || r === results[0]);
    await insertRows(db, accountId, page.map((r) => {
      const entry = parseHistoryEntry(parse(r.entry));
      // Sync refuses the server's games, so an entry that is one, or looks like one, isn't the device's to add.
      if (!entry || isServerMode(entry.mode) || SERVER_ENTRY_ID.test(entry.id)) return null;
      return indexRow(entry, null);
    }));
    await db.prepare('UPDATE shared_profiles SET synced_through = MAX(synced_through, ?2) WHERE account_id = ?1')
      .bind(accountId, page[page.length - 1].seq).run();
    // One kind of work a request: the server games come next time.
    return { done: false };
  }

  const player = await playerOfAccount(db, accountId);
  const ids = [player.id, ...player.aliases];
  // Every ID's next few, the earliest of them all next: none of any ID's comes between.
  const bookmarks = (parse(row.bookmarks) as Record<string, number> | null) ?? {};
  const { results: next } = await db.prepare(NEXT_LINKS_SQL).bind(player.id, JSON.stringify(bookmarks))
    .all<{ id: string; links: string }>();
  const links = next.flatMap((r) => ((parse(r.links) as number[] | null) ?? []).map((link) => ({ id: r.id, link })))
    .sort((a, b) => a.link - b.link);
  const taken = links.slice(0, INDEX_PLAYED);
  const page = taken.length === 0 ? [] : (await db.prepare(LINKED_GAMES_SQL)
    .bind(JSON.stringify(taken.map((t) => t.link)), accountId).all<LinkedRow>()).results;
  const built = await buildGames(env, page, player, ids);
  // Each ID taken from moves its bookmark on, over games indexed already too.
  const moved = new Map<string, number>();
  for (const { id, link } of taken) moved.set(id, Math.max(moved.get(id) ?? 0, link));
  const more = links.length > INDEX_PLAYED;

  // New games all looked at: a request's worth of the games to retry, oldest first.
  const retry = (parse(row.retry) as number[] | null) ?? [];
  const tried = more ? [] : retry.slice(0, INDEX_PLAYED);
  let again: Built = { rows: [], stuck: [] };
  if (tried.length > 0) {
    const { results: retried } = await db.prepare(RETRY_PLAYED_SQL).bind(JSON.stringify(tried), accountId).all<LinkedRow>();
    again = await buildGames(env, retried, player, ids);
  }
  await insertRows(db, accountId, [...built.rows, ...again.rows]);
  // In one statement, so two devices indexing at once can't undo each other: each bookmark moved on (never
  // back), and the games to retry, those tried dropped and those stuck added at the back.
  const marks = [...moved];
  const setMarks = marks.length === 0 ? 'bookmarks' : `json_set(bookmarks, ${marks.map((_, i) => {
    const [path, value] = [`'$."' || ?${4 + 2 * i} || '"'`, `?${5 + 2 * i}`];
    return `${path}, MAX(COALESCE(json_extract(bookmarks, ${path}), 0), ${value})`;
  }).join(', ')})`;
  await db.prepare(
    `UPDATE shared_profiles SET
       bookmarks = ${setMarks},
       retry = (SELECT COALESCE(json_group_array(value), '[]') FROM (
         SELECT value, MIN(k) AS k FROM (
           SELECT value, CAST(key AS INTEGER) AS k FROM json_each(shared_profiles.retry)
             WHERE value NOT IN (SELECT value FROM json_each(?2))
           UNION ALL SELECT value, 1000000 + CAST(key AS INTEGER) FROM json_each(?3)
         ) GROUP BY value ORDER BY k))
     WHERE account_id = ?1`,
  ).bind(accountId, JSON.stringify(tried), JSON.stringify([...again.stuck, ...built.stuck]), ...marks.flat()).run();
  // Done once no new game is left and the retries run out or stop getting anywhere: the next round tries again.
  const left = retry.length - tried.length + again.stuck.length;
  return { done: !more && (left === again.stuck.length || again.stuck.length >= tried.length) };
}

interface Built {
  rows: ReturnType<typeof indexRow>[];
  stuck: number[];
}

/** Builds these server games' entries from the account's side, one room at a time; a room that can't answer is `stuck`. */
async function buildGames(env: Env, rows: readonly LinkedRow[], player: Player, ids: readonly string[]): Promise<Built> {
  const built: Built = { rows: [], stuck: [] };
  for (const row of rows) {
    try {
      const played = await toPlayed(env, row, player, ids, false);
      if (played) built.rows.push(indexRow(played.entry, row.seq));
    } catch (e) {
      // A game that can't be read is left out for good; one whose room can't answer for now, retried.
      if (e instanceof TryAgain) built.stuck.push(row.seq);
    }
  }
  return built;
}

/** Keeps what the account's device shares with friends, as sent: only its shape is checked. */
async function saveShared(db: D1Database, accountId: string, text: string, now: number): Promise<boolean> {
  if (text.length > MAX_SHARED_CHARS) return false;
  const summary = parseSharedSummary(parse(text));
  if (!summary) return false;
  const kept: SharedSummary = { ...summary, featured: summary.featured.map(withoutRating) };
  await db.prepare(
    `INSERT INTO shared_profiles (account_id, summary, summary_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (account_id) DO UPDATE SET summary = excluded.summary, summary_at = excluded.summary_at`,
  ).bind(accountId, JSON.stringify(kept), now).run();
  return true;
}

/**
 * What a friend shares, or null until a device of theirs has sent it. A
 * featured game the server refereed is the server's own copy from their
 * index (left out until it's indexed), so a device can't show friends a
 * game against them that never happened.
 */
export async function sharedSummaryOf(db: D1Database, friendId: string): Promise<SharedSummary | null> {
  const row = await db.prepare('SELECT summary FROM shared_profiles WHERE account_id = ?1').bind(friendId)
    .first<{ summary: string | null }>();
  const summary = row?.summary ? parseSharedSummary(parse(row.summary)) : null;
  if (!summary) return null;
  const serverIds = summary.featured.filter((e) => isServerMode(e.mode)).map((e) => e.id);
  if (serverIds.length === 0) return summary;
  const { results } = await db.prepare(
    `SELECT entry FROM profile_games WHERE account_id = ?1 AND id IN (SELECT value FROM json_each(?2)) AND entry IS NOT NULL`,
  ).bind(friendId, JSON.stringify(serverIds)).all<{ entry: string | null }>();
  const indexed = new Map(entriesOf(results).map((e) => [e.id, e]));
  const featured = summary.featured.flatMap((e) => !isServerMode(e.mode) ? [e] : indexed.has(e.id) ? [indexed.get(e.id)!] : []);
  return { ...summary, featured };
}

/**
 * Your record against a friend, counted in SQL from the games in both your
 * indexes (as `headToHead` counts them, without replaying any): a game
 * against them by your result, and a Word Set you both played by your
 * places, a higher one a win, the same one a draw, and not counted if
 * neither of you was placed.
 */
export async function versusOf(db: D1Database, accountId: string, friendId: string): Promise<HeadToHead> {
  const row = await db.prepare(
    `SELECT
       COUNT(CASE WHEN y.mode = 'friend' AND y.result = 'won' THEN 1 END) AS friend_wins,
       COUNT(CASE WHEN y.mode = 'friend' AND y.result = 'drawn' THEN 1 END) AS friend_draws,
       COUNT(CASE WHEN y.mode = 'friend' AND y.result = 'lost' THEN 1 END) AS friend_losses,
       COUNT(CASE WHEN y.mode = 'lobby' AND y.rank < t.rank THEN 1 END) AS lobby_wins,
       COUNT(CASE WHEN y.mode = 'lobby' AND y.rank = t.rank AND y.rank < ${NOT_PLACED} THEN 1 END) AS lobby_draws,
       COUNT(CASE WHEN y.mode = 'lobby' AND y.rank > t.rank THEN 1 END) AS lobby_losses
     FROM profile_games y JOIN profile_games t ON t.account_id = ?2 AND t.id = y.id AND t.mode = y.mode
     WHERE y.account_id = ?1 AND y.mode IN ('friend', 'lobby')`,
  ).bind(accountId, friendId).first<Record<string, number>>();
  const n = (key: string) => row?.[key] ?? 0;
  return {
    friend: { wins: n('friend_wins'), draws: n('friend_draws'), losses: n('friend_losses') },
    lobby: { wins: n('lobby_wins'), draws: n('lobby_draws'), losses: n('lobby_losses') },
  };
}

/**
 * A page of a friend's game history, newest first, matching the history's
 * filters (as `matchesFilter` does). A Daily Set or Daily Word is left out
 * until the day after it is over.
 */
export async function friendGamesPage(
  db: D1Database, friendId: string, query: FriendGamesQuery, now: number,
): Promise<{ games: HistoryEntry[]; next: number | null }> {
  const { filter, offset, limit } = query;
  // Words are letters only, so a search with anything else matches nothing, as on your own history.
  if (filter.search !== undefined && !/^[a-z]+$/.test(filter.search)) return { games: [], next: null };
  const { results } = await db.prepare(
    `SELECT COALESCE(g.entry, h.entry) AS entry FROM profile_games g
     LEFT JOIN history_entries h ON g.entry IS NULL AND h.account_id = g.account_id AND h.id = g.id
     WHERE g.account_id = ?1 AND (g.daily_day IS NULL OR g.daily_day < ?2)
       AND (?3 IS NULL OR g.mode = ?3) AND (?4 IS NULL OR g.result = ?4) AND (?5 IS NULL OR g.difficulty = ?5)
       AND instr(g.words, ' ' || ?6) > 0
     ORDER BY g.started_at DESC, g.id LIMIT ?7 OFFSET ?8`,
  ).bind(
    friendId, shownBefore(now), filter.mode ?? null, filter.result ?? null, filter.difficulty ?? null,
    filter.search ?? '', limit + 1, offset,
  ).all<{ entry: string | null }>();
  return { games: entriesOf(results.slice(0, limit)), next: results.length > limit ? offset + limit : null };
}

/** Routes `/api/profile/shared` and `/api/profile/index` (an account's own), or returns null for any other path. */
export async function routeProfileShare(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/profile/shared' && pathname !== '/api/profile/index') return null;
  if (request.method !== 'POST') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const accountId = who.player.accountId;
  if (!accountId) return errorResponse(401, 'signed-out');
  if (pathname === '/api/profile/index') return json(await indexStep(env, accountId));
  const ok = await saveShared(env.DB, accountId, await request.text(), now);
  return ok ? json({ ok: true }) : errorResponse(400, 'bad-request');
}
