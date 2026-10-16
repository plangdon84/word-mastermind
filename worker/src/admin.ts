import type { DailyCounts, ModeCount, PeriodCount, PeriodKind, Periods, Usage } from '../../src/admin/usage';
import { addDays, DAY_MS, dailyDay, dayStart } from '../../src/game';
import { ACCESS_HEADER, verifyAccessToken } from './access';
import { errorResponse, json } from './http';
import type { Env } from './index';

/*
 * The usage dashboard's figures (Dev Plan item 18m, `GET
 * /api/admin/figures`), for the owner's page at wordmastermind.app/admin.
 * Only for a request carrying a valid Cloudflare Access token (`access.ts`):
 * without the settings (ACCESS_TEAM_DOMAIN and ACCESS_AUD), the route is
 * off. It counts only what the server already keeps, and answers totals
 * only: never a player's ID, name or email.
 *
 * A player is an account, or a guest ID that never signed in. Days, weeks
 * (from Monday) and months are New York's, like the daily games', at
 * today's offset from UTC (so a day across a daylight saving change is an
 * hour out).
 */

const DAYS = 30;
const WEEKS = 12;
const MONTHS = 12;

const PERIOD_KEY: Record<PeriodKind, string> = {
  day: `date((at - ?1) / 1000, 'unixepoch')`,
  week: `date((at - ?1) / 1000, 'unixepoch', '-6 days', 'weekday 1')`,
  month: `strftime('%Y-%m-01', (at - ?1) / 1000, 'unixepoch')`,
};

const utcMidnight = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Each kind's periods up to `today`, oldest first. */
export function periodsTo(today: string): Record<PeriodKind, string[]> {
  const monday = addDays(today, -((new Date(utcMidnight(today)).getUTCDay() + 6) % 7));
  const [year, month] = today.split('-').map(Number);
  const back = (n: number, at: (i: number) => string) => Array.from({ length: n }, (_, i) => at(n - 1 - i));
  return {
    day: back(DAYS, (i) => addDays(today, -i)),
    week: back(WEEKS, (i) => addDays(monday, -7 * i)),
    month: back(MONTHS, (i) => new Date(Date.UTC(year, month - 1 - i, 1)).toISOString().slice(0, 10)),
  };
}

/** Players first seen: an account's devices count once, from its first. */
const NEW_PLAYERS = `SELECT MIN(created_at) AS at FROM guests GROUP BY COALESCE(account_id, id) HAVING at >= ?2`;
const NEW_ACCOUNTS = `SELECT created_at AS at FROM accounts WHERE created_at >= ?2`;
/** Who played when: online games and their moves, daily games started, and synced games (guests' offline games never reach the server). */
const PLAYING = `
  SELECT COALESCE(g.account_id, gp.guest_id) AS player, COALESCE(gm.finished_at, gm.started_at) AS at
    FROM game_players gp JOIN games gm ON gm.id = gp.game_id LEFT JOIN guests g ON g.id = gp.guest_id
    WHERE COALESCE(gm.finished_at, gm.started_at) >= ?2
  UNION ALL SELECT COALESCE(g.account_id, f.guest_id), f.added_at
    FROM friend_game_players f LEFT JOIN guests g ON g.id = f.guest_id WHERE f.added_at >= ?2
  UNION ALL SELECT COALESCE(g.account_id, d.player_id), d.played_at
    FROM daily_played d LEFT JOIN guests g ON g.id = d.player_id WHERE d.played_at >= ?2
  UNION ALL SELECT COALESCE(g.account_id, a.player_id), a.played_at
    FROM player_activity a LEFT JOIN guests g ON g.id = a.player_id WHERE a.played_at >= ?2
  UNION ALL SELECT account_id, started_at FROM history_entries WHERE started_at >= ?2`;

const perPeriod = (source: string, kind: PeriodKind, count: string) =>
  `SELECT ${PERIOD_KEY[kind]} AS period, ${count} AS count FROM (${source}) GROUP BY period`;

const DIFFICULTY_TABLES = { daily: 'daily_results', dailyWord: 'daily_word_results' } as const;

/** Counts the figures at `now`. */
export async function usageAt(db: D1Database, now: number): Promise<Usage> {
  const today = dailyDay(now);
  const offset = dayStart(today) - utcMidnight(today);
  const periods = periodsTo(today);
  const since = (kind: PeriodKind) => utcMidnight(periods[kind][0]) + offset;
  const series = (source: string, count: string) => (['day', 'week', 'month'] as const)
    .map((kind) => db.prepare(perPeriod(source, kind, count)).bind(offset, since(kind)));
  const firstDay = periods.day[0];
  const recent = now - DAYS * DAY_MS;

  const results = await db.batch([
    db.prepare(
      `SELECT (SELECT COUNT(*) FROM guests WHERE account_id IS NULL) AS guests,
         (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM guests) AS devices,
         (SELECT COUNT(DISTINCT COALESCE(account_id, id)) FROM guests WHERE last_seen_at >= ?1) AS day,
         (SELECT COUNT(DISTINCT COALESCE(account_id, id)) FROM guests WHERE last_seen_at >= ?2) AS week,
         (SELECT COUNT(DISTINCT COALESCE(account_id, id)) FROM guests WHERE last_seen_at >= ?3) AS month,
         (SELECT COUNT(*) FROM profiles WHERE country IS NULL) AS no_country`,
    ).bind(now - DAY_MS, now - 7 * DAY_MS, recent),
    ...series(NEW_PLAYERS, 'COUNT(*)'),
    ...series(NEW_ACCOUNTS, 'COUNT(*)'),
    ...series(PLAYING, 'COUNT(DISTINCT player)'),
    db.prepare(
      `SELECT CASE WHEN mode = 'lobby' AND json_extract(record, '$.kind') = 'competitive' THEN 'competitive' ELSE mode END AS mode,
         COUNT(*) AS total, SUM(started_at >= ?1) AS recent
       FROM games GROUP BY 1 ORDER BY total DESC`,
    ).bind(recent),
    db.prepare(`SELECT mode, COUNT(*) AS total, SUM(started_at >= ?1) AS recent FROM history_entries GROUP BY mode ORDER BY total DESC`)
      .bind(recent),
    db.prepare(`SELECT day, mode, COUNT(*) AS n FROM daily_played WHERE day >= ?1 GROUP BY day, mode`).bind(firstDay),
    ...(['daily', 'dailyWord'] as const).map((mode) => db.prepare(
      `SELECT day, difficulty, COUNT(*) AS n FROM ${DIFFICULTY_TABLES[mode]} WHERE day >= ?1 GROUP BY day, difficulty`,
    ).bind(firstDay)),
    db.prepare(`SELECT country, COUNT(*) AS count FROM profiles WHERE country IS NOT NULL GROUP BY country ORDER BY count DESC, country`),
  ]);
  const rows = <T>(i: number) => results[i].results as T[];
  const totals = rows<{
    guests: number; accounts: number; devices: number; day: number; week: number; month: number; no_country: number;
  }>(0)[0];
  const toPeriods = (first: number): Periods => {
    const out = {} as Periods;
    (['day', 'week', 'month'] as const).forEach((kind, k) => {
      const counts = new Map(rows<PeriodCount>(first + k).map((r) => [r.period, r.count]));
      out[kind] = periods[kind].map((period) => ({ period, count: counts.get(period) ?? 0 }));
    });
    return out;
  };
  const modeCounts = (i: number): ModeCount[] =>
    rows<ModeCount>(i).map((r) => ({ mode: r.mode, total: r.total, recent: r.recent ?? 0 }));
  const started = rows<{ day: string; mode: string; n: number }>(12);
  const dailyCounts = (mode: 'daily' | 'dailyWord', i: number): DailyCounts[] => periods.day.map((day) => {
    const finished: Record<string, number> = {};
    for (const r of rows<{ day: string; difficulty: string; n: number }>(i)) if (r.day === day) finished[r.difficulty] = r.n;
    return { day, started: started.find((r) => r.day === day && r.mode === mode)?.n ?? 0, finished };
  });
  return {
    at: now,
    players: { total: totals.guests + totals.accounts, guests: totals.guests, accounts: totals.accounts, devices: totals.devices },
    active: { day: totals.day, week: totals.week, month: totals.month },
    newPlayers: toPeriods(1),
    newAccounts: toPeriods(4),
    playing: toPeriods(7),
    games: { online: modeCounts(10), synced: modeCounts(11) },
    daily: dailyCounts('daily', 13),
    dailyWord: dailyCounts('dailyWord', 14),
    countries: rows<{ country: string; count: number }>(15),
    noCountry: totals.no_country,
  };
}

/** `GET /api/admin/figures`, for a request through Cloudflare Access; null for any other path. */
export async function routeAdmin(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch,
): Promise<Response | null> {
  if (pathname !== '/api/admin/figures') return null;
  if (request.method !== 'GET') return errorResponse(405, 'method-not-allowed');
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!teamDomain || !aud) return errorResponse(404, 'off');
  const token = request.headers.get(ACCESS_HEADER);
  let allowed = false;
  try {
    allowed = token !== null && await verifyAccessToken(token, { teamDomain, aud }, now, fetchFn);
  } catch (error) {
    console.error('Checking an Access token failed', error);
    return errorResponse(503, 'access-unavailable');
  }
  if (!allowed) return errorResponse(403, 'forbidden');
  return json(await usageAt(env.DB, now), 200, { 'cache-control': 'no-store' });
}
