import {
  addDays, computeAchievements, computeStats, dailyDay, headToHead, HISTORY_MODES, parseHistoryEntry, replayEntry,
  summarizeGame, type DailyDay, type HistoryEntry, type StatsGame,
} from '../../src/game';
import type { FriendGamesQuery, FriendSummary } from '../../src/app/friendsApi';
import { playerOfAccount, type Player } from './accounts';
import { pastPlacements } from './dailyRoutes';
import type { Env } from './index';
import { playedPage } from './played';

/*
 * Friends' profiles kept ready (Dev Plan item 18cb, README "Friends'
 * profiles"). Each account's games are copied, as a friend sees them, into
 * `profile_games`, and their stats and badges are worked out from those
 * games into `profile_summaries`: after their device sends its last new
 * game or fetches its server games, and again, if anything is new, when a
 * friend opens their profile. So a profile shows from one small read, and a
 * friend game's room is asked about once, not on every visit. Like the
 * stats on your own device, it's all rebuilt from the games, never counted.
 */

/** The most synced games one refresh copies, and server games it looks at: a request never does too much. */
const COPY_SYNCED = 1000;
const COPY_PLAYED_PAGES = 5;

/** What `profile_summaries.summary` holds: `FriendSummary` without your record against them, and the featured games by ID. */
interface StoredSummary {
  games: number;
  stats: FriendSummary['stats'];
  badges: FriendSummary['badges'];
  featured: string[];
}

interface SummaryRow {
  synced_through: number;
  played_through: number;
  players: number;
  day: string;
  summary: string | null;
}

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
const shownBefore = (today: DailyDay) => addDays(today, -1);

/** A day as a number, consecutive days differing by 1: the server doesn't know a player's time zone, so it uses Daily Rush's. */
const dayNumber = (ms: number) => Math.round(Date.parse(`${dailyDay(ms)}T00:00:00Z`) / 86_400_000);

/** The insert for one game, or null if it doesn't replay (it isn't listed, as the app wouldn't show it). */
function gameRow(db: D1Database, accountId: string, entry: HistoryEntry, seq: number | null) {
  const replayed = replayEntry(entry);
  if (!replayed) return null;
  const summary = summarizeGame(replayed);
  return db.prepare(
    `INSERT OR IGNORE INTO profile_games
       (account_id, id, started_at, mode, result, difficulty, words, daily_day, game_seq, entry)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(
    accountId, entry.id, entry.record.startedAt, entry.mode, summary.result, summary.difficulty,
    ` ${[...summary.words].join(' ')} `, entry.mode === 'daily' ? entry.day : null, seq,
    // A synced game's entry stays in history_entries alone.
    seq === null ? null : JSON.stringify(entry),
  );
}

/** Copies the account's synced games after `after`. */
async function copySynced(db: D1Database, accountId: string, after: number) {
  const { results } = await db.prepare(
    `SELECT seq, entry FROM history_entries WHERE account_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ${COPY_SYNCED + 1}`,
  ).bind(accountId, after).all<{ seq: number; entry: string }>();
  const rows = results.slice(0, COPY_SYNCED);
  const inserts = rows.flatMap((row) => {
    const entry = parseHistoryEntry(parse(row.entry));
    const insert = entry && gameRow(db, accountId, entry, null);
    return insert ? [insert] : [];
  });
  if (inserts.length > 0) await db.batch(inserts);
  return { through: rows.length > 0 ? rows[rows.length - 1].seq : after, more: results.length > COPY_SYNCED };
}

/**
 * Copies the account's server games after `after`. A game already copied
 * (looked through again for a newly linked guest ID) isn't asked about
 * again. A room that can't answer for now ends it before that game, for the
 * next refresh to ask again, as `GET /api/played` does.
 */
async function copyPlayed(env: Env, accountId: string, player: Player, after: number) {
  const { results } = await env.DB.prepare(
    'SELECT game_seq FROM profile_games WHERE account_id = ?1 AND game_seq > ?2',
  ).bind(accountId, after).all<{ game_seq: number }>();
  const known = new Set(results.map((r) => r.game_seq));
  let cursor = after;
  for (let pages = 0; pages < COPY_PLAYED_PAGES; pages++) {
    const page = await playedPage(env, player, cursor, known);
    const inserts = page.games.flatMap((g) => {
      const insert = g.seq === undefined ? null : gameRow(env.DB, accountId, withoutRating(g.entry), g.seq);
      return insert ? [insert] : [];
    });
    if (inserts.length > 0) await env.DB.batch(inserts);
    cursor = page.cursor;
    if (page.stopped || page.next === null) return { through: cursor, more: false };
  }
  return { through: cursor, more: true };
}

/** Every game a friend sees on the account's profile today, oldest first. */
async function shownGames(db: D1Database, accountId: string, today: DailyDay): Promise<HistoryEntry[]> {
  const { results } = await db.prepare(
    `SELECT COALESCE(g.entry, h.entry) AS entry FROM profile_games g
     LEFT JOIN history_entries h ON g.entry IS NULL AND h.account_id = g.account_id AND h.id = g.id
     WHERE g.account_id = ?1 AND (g.daily_day IS NULL OR g.daily_day < ?2)
     ORDER BY g.started_at, g.id`,
  ).bind(accountId, shownBefore(today)).all<{ entry: string | null }>();
  return entriesOf(results);
}

/** The account's stats and badges, from every game a friend sees. */
async function workOut(env: Env, player: Player, today: DailyDay, now: number): Promise<StoredSummary> {
  const accountId = player.id;
  const games = (await shownGames(env.DB, accountId, today)).flatMap((entry): StatsGame[] => {
    const replayed = replayEntry(entry);
    return replayed ? [{ id: entry.id, replayed }] : [];
  });
  const placements = await pastPlacements(env.DB, player, today);
  const stats = computeStats(games, now);
  const featured = new Set<string>();
  for (const mode of HISTORY_MODES) {
    const { best, bestRush, fastest } = stats.modes[mode];
    for (const ref of [best, bestRush, fastest]) if (ref) featured.add(ref.id);
  }
  return {
    games: games.length, stats, badges: computeAchievements(games, dayNumber, placements), featured: [...featured],
  };
}

/** What a refresh found: the summary (null while there are games left to copy, `more`). */
interface Refreshed {
  summary: StoredSummary | null;
  more: boolean;
}

/**
 * Brings the account's copied games up to date and, with `summarize`, its
 * stats and badges too, working them out again only if a game was copied,
 * a guest ID linked or the day changed. Two refreshes at once each write
 * what they copied; neither moves the other's progress back.
 */
export async function refreshProfile(env: Env, accountId: string, now: number, summarize = true): Promise<Refreshed> {
  const db = env.DB;
  const today = dailyDay(now);
  const row = await db.prepare(
    'SELECT synced_through, played_through, players, day, summary FROM profile_summaries WHERE account_id = ?1',
  ).bind(accountId).first<SummaryRow>();
  const player = await playerOfAccount(db, accountId);
  const synced = await copySynced(db, accountId, row?.synced_through ?? 0);
  // A newly linked guest ID's games can come before where the copying got to: look through them all again.
  const relinked = row !== null && row.players !== player.aliases.length;
  const played = await copyPlayed(env, accountId, player, relinked ? 0 : row?.played_through ?? 0);
  const more = synced.more || played.more;
  const changed = row === null || relinked || row.day !== today
    || synced.through !== row.synced_through || played.through !== row.played_through;
  let summary = row?.summary && !changed ? parse(row.summary) as StoredSummary : null;
  if (summarize && !more && !summary) summary = await workOut(env, player, today, now);
  if (changed || (summary && !row?.summary)) {
    await db.prepare(
      `INSERT INTO profile_summaries (account_id, synced_through, played_through, players, day, summary, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (account_id) DO UPDATE SET synced_through = excluded.synced_through,
         played_through = excluded.played_through, players = excluded.players, day = excluded.day,
         summary = excluded.summary, updated_at = excluded.updated_at
       WHERE excluded.players != profile_summaries.players
         OR (excluded.synced_through >= profile_summaries.synced_through
           AND excluded.played_through >= profile_summaries.played_through)`,
    ).bind(accountId, synced.through, played.through, player.aliases.length, today, summary && JSON.stringify(summary), now).run();
  }
  return { summary: more ? null : summary, more };
}

/** Refreshes an account's profile without holding up the answer; a failure waits for the next refresh. */
export function refreshLater(env: Env, accountId: string, now: number, later: (work: Promise<unknown>) => void): void {
  later(refreshProfile(env, accountId, now).catch((e: unknown) => console.error('Refreshing a profile failed', e)));
}

/**
 * A friend's summary for you: their stats, badges and featured games, and
 * your record against them (the games in both your histories). Null while
 * either of you has games left to copy: the app asks again.
 */
export async function friendSummary(env: Env, accountId: string, friendId: string, now: number): Promise<FriendSummary | null> {
  const theirs = await refreshProfile(env, friendId, now);
  // Yours only needs its games copied, for the games you share.
  const yours = await refreshProfile(env, accountId, now, false);
  if (!theirs.summary || yours.more) return null;
  const { games, stats, badges, featured } = theirs.summary;
  const { results } = await env.DB.prepare(
    `SELECT y.id, y.entry AS yours, t.entry AS theirs FROM profile_games y
     JOIN profile_games t ON t.account_id = ?2 AND t.id = y.id
     WHERE y.account_id = ?1 AND y.mode IN ('friend', 'lobby') AND y.entry IS NOT NULL AND t.entry IS NOT NULL`,
  ).bind(accountId, friendId).all<{ id: string; yours: string; theirs: string }>();
  const shared = (side: 'yours' | 'theirs') => results.flatMap((r): StatsGame[] => {
    const entry = parseHistoryEntry(parse(r[side]));
    const replayed = entry && replayEntry(entry);
    return replayed ? [{ id: r.id, replayed }] : [];
  });
  const featuredGames = await gamesById(env.DB, friendId, featured);
  return { games, stats, badges, featured: featuredGames, versus: headToHead(shared('yours'), shared('theirs')) };
}

/** The account's games with these IDs. */
async function gamesById(db: D1Database, accountId: string, ids: readonly string[]): Promise<HistoryEntry[]> {
  if (ids.length === 0) return [];
  const { results } = await db.prepare(
    `SELECT COALESCE(g.entry, h.entry) AS entry FROM profile_games g
     LEFT JOIN history_entries h ON g.entry IS NULL AND h.account_id = g.account_id AND h.id = g.id
     WHERE g.account_id = ?1 AND g.id IN (SELECT value FROM json_each(?2))`,
  ).bind(accountId, JSON.stringify(ids)).all<{ entry: string | null }>();
  return entriesOf(results);
}

/**
 * A page of a friend's game history, newest first, matching the history's
 * filters (as `matchesFilter` does), from the games last copied. A Daily Set
 * is left out until the day after it is over.
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
    friendId, shownBefore(dailyDay(now)), filter.mode ?? null, filter.result ?? null, filter.difficulty ?? null,
    filter.search ?? '', limit + 1, offset,
  ).all<{ entry: string | null }>();
  const games = entriesOf(results.slice(0, limit));
  return { games, next: results.length > limit ? offset + limit : null };
}
