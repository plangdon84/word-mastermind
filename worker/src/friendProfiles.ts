import {
  addDays, computeAchievements, computeStats, dailyDay, headToHead, HISTORY_MODES, parseHistoryEntry, replayEntry,
  summarizeGame, type DailyDay, type HistoryEntry, type StatsGame,
} from '../../src/game';
import type { FriendGamesQuery, FriendSummary } from '../../src/app/friendsApi';
import { RELEASES } from '../../src/app/releases';
import { playerOfAccount, type Player } from './accounts';
import { pastPlacements } from './dailyRoutes';
import type { Env, Later } from './index';
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
const COPY_PLAYED_PAGES = 10;

/**
 * Which app version a summary was worked out by: a release can add a mode,
 * a badge or a stat, so a summary from before it is worked out again.
 */
const SUMMARY_VERSION = RELEASES[0].version;

/** What `profile_summaries.summary` holds: `FriendSummary` without your record against them, and the featured games by ID. */
interface StoredSummary {
  version: string;
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
  retry: string;
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
 * Copies the account's server games after `after`, and asks again about
 * `retry`, games whose room couldn't answer before. A game already copied
 * (looked through again for a newly linked guest ID) isn't asked about
 * again. A game whose room can't answer for now is passed over, to retry
 * next time, so it doesn't hold up the games after it.
 */
async function copyPlayed(env: Env, accountId: string, player: Player, after: number, retry: readonly number[]) {
  let cursor = after;
  let copied = 0;
  const stuck: number[] = [];
  for (let pages = 0; pages < COPY_PLAYED_PAGES; pages++) {
    // The games to retry come first, with the first page.
    const page = await playedPage(env, player, cursor, { accountId, retry: pages === 0 ? retry : [] });
    const inserts = page.games.flatMap((g) => {
      const insert = g.seq === undefined ? null : gameRow(env.DB, accountId, withoutRating(g.entry), g.seq);
      return insert ? [insert] : [];
    });
    if (inserts.length > 0) await env.DB.batch(inserts);
    copied += inserts.length;
    stuck.push(...page.stuck);
    cursor = page.cursor;
    if (page.next === null) return { through: cursor, more: false, copied, stuck };
  }
  return { through: cursor, more: true, copied, stuck };
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
    version: SUMMARY_VERSION, games: games.length, stats, badges: computeAchievements(games, dayNumber, placements),
    featured: [...featured],
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
    'SELECT synced_through, played_through, players, day, summary, retry FROM profile_summaries WHERE account_id = ?1',
  ).bind(accountId).first<SummaryRow>();
  const player = await playerOfAccount(db, accountId);
  const synced = await copySynced(db, accountId, row?.synced_through ?? 0);
  // A newly linked guest ID's games can come before where the copying got to: look through them all again.
  const relinked = row !== null && row.players !== player.aliases.length;
  const retry = row ? (parse(row.retry) as number[] | null) ?? [] : [];
  const played = await copyPlayed(env, accountId, player, relinked ? 0 : row?.played_through ?? 0, retry);
  const more = synced.more || played.more;
  const changed = row === null || relinked || row.day !== today || played.copied > 0
    || synced.through !== row.synced_through || played.through !== row.played_through
    || JSON.stringify(played.stuck) !== JSON.stringify(retry);
  const kept = row?.summary && !changed ? parse(row.summary) as StoredSummary | null : null;
  let summary = kept?.version === SUMMARY_VERSION ? kept : null;
  if (summarize && !more && !summary) summary = await workOut(env, player, today, now);
  if (changed || (summary && summary !== kept)) {
    await db.prepare(
      `INSERT INTO profile_summaries (account_id, synced_through, played_through, players, day, summary, updated_at, retry)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (account_id) DO UPDATE SET synced_through = excluded.synced_through,
         played_through = excluded.played_through, players = excluded.players, day = excluded.day,
         summary = excluded.summary, updated_at = excluded.updated_at, retry = excluded.retry
       WHERE excluded.players != profile_summaries.players
         OR (excluded.synced_through >= profile_summaries.synced_through
           AND excluded.played_through >= profile_summaries.played_through)`,
    ).bind(
      accountId, synced.through, played.through, player.aliases.length, today, summary && JSON.stringify(summary), now,
      JSON.stringify(played.stuck),
    ).run();
  }
  return { summary: more ? null : summary, more };
}

/** Refreshes an account's profile without holding up the answer; a failure waits for the next refresh. */
export function refreshLater(env: Env, accountId: string, now: number, later: Later): void {
  later(() => refreshProfile(env, accountId, now).catch((e: unknown) => console.error('Refreshing a profile failed', e)));
}

/**
 * A friend's summary for you: their stats, badges and featured games, and
 * your record against them (the games in both your histories). Null while
 * they have games left to copy, and the record null while you do: the app
 * asks again.
 */
export async function friendSummary(env: Env, accountId: string, friendId: string, now: number): Promise<FriendSummary | null> {
  // Yours only needs its games copied, for the games you share. The two write different rows.
  const [theirs, yours] = await Promise.all([refreshProfile(env, friendId, now), refreshProfile(env, accountId, now, false)]);
  if (!theirs.summary) return null;
  const { games, stats, badges, featured } = theirs.summary;
  return {
    games, stats, badges, featured: await gamesById(env.DB, friendId, featured),
    versus: yours.more ? null : await versus(env.DB, accountId, friendId),
  };
}

/** Your record against a friend, from the games in both your histories. */
async function versus(db: D1Database, accountId: string, friendId: string) {
  const { results } = await db.prepare(
    `SELECT y.id, y.entry AS yours, t.entry AS theirs FROM profile_games y
     JOIN profile_games t ON t.account_id = ?2 AND t.id = y.id
     WHERE y.account_id = ?1 AND y.mode IN ('friend', 'lobby') AND y.entry IS NOT NULL AND t.entry IS NOT NULL`,
  ).bind(accountId, friendId).all<{ id: string; yours: string; theirs: string }>();
  const shared = (side: 'yours' | 'theirs') => results.flatMap((r): StatsGame[] => {
    const entry = parseHistoryEntry(parse(r[side]));
    const replayed = entry && replayEntry(entry);
    return replayed ? [{ id: r.id, replayed }] : [];
  });
  return headToHead(shared('yours'), shared('theirs'));
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
