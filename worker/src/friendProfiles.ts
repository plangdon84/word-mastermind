import {
  addDays, dailyDay, parseHistoryEntry, replayEntry, summarizeGame, type HeadToHead, type HistoryEntry,
} from '../../src/game';
import {
  MAX_SHARED_CHARS, parseSharedSummary, type FriendGamesQuery, type SharedSummary,
} from '../../src/app/friendsApi';
import { identify, playerOfAccount } from './accounts';
import { errorResponse, json } from './http';
import type { Env } from './index';
import { playedPage } from './played';

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

/** A friend's game without their rating change: their profile never shows their rating. */
const withoutRating = (entry: HistoryEntry): HistoryEntry =>
  entry.mode === 'friend' || entry.mode === 'lobby' ? { ...entry, rating: null } : entry;

/** The entries of `profile_games` rows (a synced game's from history_entries), as a friend sees them. */
const entriesOf = (rows: readonly { entry: string | null }[]): HistoryEntry[] => rows.flatMap((r) => {
  const entry = r.entry === null ? null : parseHistoryEntry(parse(r.entry));
  return entry ? [withoutRating(entry)] : [];
});

/** A friend sees a Daily Set from the day after it is over (a run started before midnight can be finished the next day). */
const shownBefore = (now: number) => addDays(dailyDay(now), -1);

/** One game as a `profile_games` row, or null if it doesn't replay (the app wouldn't show it). */
function indexRow(entry: HistoryEntry, gameSeq: number | null) {
  const replayed = replayEntry(entry);
  if (!replayed) return null;
  const summary = summarizeGame(replayed);
  const you = replayed.mode === 'lobby' ? replayed.places.find((p) => p.you) : undefined;
  return {
    id: entry.id, startedAt: entry.record.startedAt, mode: entry.mode, result: summary.result, difficulty: summary.difficulty,
    words: ` ${[...summary.words].join(' ')} `, dailyDay: entry.mode === 'daily' ? entry.day : null,
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
  played_through: number;
  players: number;
  retry: string;
}

/**
 * Indexes a few more of the account's games for friends: its synced games
 * first (`INDEX_SYNCED` a request), then its server games (`INDEX_PLAYED`
 * room lookups a request). A server game whose room can't answer for now
 * is passed over and retried next time; a newly linked guest ID's games
 * (which can come before where indexing got to) are looked through again,
 * leaving out games already indexed. `done` once nothing is left for now.
 */
export async function indexStep(env: Env, accountId: string): Promise<{ done: boolean }> {
  const db = env.DB;
  const row = await db.prepare('SELECT synced_through, played_through, players, retry FROM shared_profiles WHERE account_id = ?1')
    .bind(accountId).first<IndexRow>();
  const save = (fields: Partial<Record<keyof IndexRow, number | string>>) => {
    const names = Object.keys(fields);
    return db.prepare(
      `INSERT INTO shared_profiles (account_id, ${names.join(', ')}) VALUES (?1, ${names.map((_, i) => `?${i + 2}`).join(', ')})
       ON CONFLICT (account_id) DO UPDATE SET ${names.map((n) => `${n} = excluded.${n}`).join(', ')}`,
    ).bind(accountId, ...Object.values(fields)).run();
  };

  const syncedFrom = row?.synced_through ?? 0;
  const { results } = await db.prepare(
    `SELECT seq, entry FROM history_entries WHERE account_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ${INDEX_SYNCED + 1}`,
  ).bind(accountId, syncedFrom).all<{ seq: number; entry: string }>();
  if (results.length > 0) {
    const page = results.slice(0, INDEX_SYNCED);
    await insertRows(db, accountId, page.map((r) => {
      const entry = parseHistoryEntry(parse(r.entry));
      return entry && indexRow(entry, null);
    }));
    await save({ synced_through: page[page.length - 1].seq });
    if (results.length > INDEX_SYNCED) return { done: false };
  }

  const player = await playerOfAccount(db, accountId);
  const relinked = row !== null && row.players !== player.aliases.length;
  const retry = row ? (parse(row.retry) as number[] | null) ?? [] : [];
  const page = await playedPage(env, player, relinked ? 0 : row?.played_through ?? 0, { accountId, retry: [], limit: INDEX_PLAYED });
  await insertRows(db, accountId, page.games.map((g) => g.seq === undefined ? null : indexRow(g.entry, g.seq)));
  let left = retry;
  let done = page.next === null;
  if (done && retry.length > 0) {
    // New games all looked at: a request's worth of the games to retry, oldest first, which games after every row skip.
    const tried = retry.slice(0, INDEX_PLAYED);
    const again = await playedPage(env, player, Number.MAX_SAFE_INTEGER, { accountId, retry: tried, limit: INDEX_PLAYED });
    await insertRows(db, accountId, again.games.map((g) => g.seq === undefined ? null : indexRow(g.entry, g.seq)));
    // One tried and not returned is indexed already or gone; one stuck again goes to the back.
    left = [...retry.slice(INDEX_PLAYED), ...again.stuck];
    // Done once the retries run out or stop getting anywhere: the next round tries again.
    done = left.length === again.stuck.length || again.stuck.length >= tried.length;
  }
  await save({ played_through: page.cursor, players: player.aliases.length, retry: JSON.stringify([...left, ...page.stuck]) });
  return { done };
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

/** What a friend shares, or null until a device of theirs on this version has sent it. */
export async function sharedSummaryOf(db: D1Database, friendId: string): Promise<SharedSummary | null> {
  const row = await db.prepare('SELECT summary FROM shared_profiles WHERE account_id = ?1').bind(friendId)
    .first<{ summary: string | null }>();
  return row?.summary ? parseSharedSummary(parse(row.summary)) : null;
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
 * filters (as `matchesFilter` does). A Daily Set is left out until the day
 * after it is over.
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
