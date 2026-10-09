import {
  addDays, dailyDay, FEATURES, dayEnd, isDailyDay, isDifficulty, isObject, isRankBy, RANK_BYS, validateName, type DailyDay,
  type DailyPlacement, type Difficulty, type RankBy,
} from '../../src/game';
import type { DailyBoard, DailyBoardRow, DailyToday } from '../../src/app/dailyApi';
import { isCircle, type Circle } from '../../src/app/leaderboardsApi';
import { identify, isPlayers, type Player } from './accounts';
import type { DailyRequest, DailyResponse } from './dailyRoom';
import { themeFor } from './dailyThemes';
import { friendCodeSql } from './friends';
import { registerGuest } from './guests';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import { inCircle } from './leaderboards';

/*
 * Daily Rush: the worker checks who is asking and what they sent, then hands
 * the request to the day's Durable Object (`DailyRush`), which referees it.
 * The leaderboards are read from D1 here.
 */

/** Longest leaderboard shown: the top 10. */
export const BOARD_SIZE = 10;


async function toDay(env: Env, request: DailyRequest): Promise<DailyResponse> {
  const response = await env.DAILY.get(env.DAILY.idFromName(request.day)).fetch('https://daily/', {
    method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
  });
  return { status: response.status, body: await response.json() };
}

/**
 * The columns a board ranks by, in order: Crush, fewer guesses then less
 * time; Rush, less time then fewer guesses (README "Daily Rush").
 */
const RANKED: Readonly<Record<RankBy, readonly [string, string]>> = { crush: ['guesses', 'ms'], rush: ['ms', 'guesses'] };

/**
 * A result's place on its day's leaderboard, as `rank`, `total` and `behind`
 * columns (by `rankBy`), among the results `filter` (on `o`) keeps.
 */
const placeColumns = (rankBy: RankBy, filter = '') => {
  const [first, then] = RANKED[rankBy];
  return `
  1 + (SELECT COUNT(*) FROM daily_results o WHERE o.day = r.day AND o.difficulty = r.difficulty ${filter}
    AND (o.${first} < r.${first} OR (o.${first} = r.${first} AND o.${then} < r.${then}))) AS rank,
  (SELECT COUNT(*) FROM daily_results o WHERE o.day = r.day AND o.difficulty = r.difficulty ${filter}) AS total,
  (SELECT COUNT(*) FROM daily_results o WHERE o.day = r.day AND o.difficulty = r.difficulty ${filter}
    AND (o.${first} > r.${first} OR (o.${first} = r.${first} AND o.${then} > r.${then}))) AS behind`;
};

interface PlaceRow {
  day: string;
  difficulty: Difficulty;
  guesses: number;
  ms: number;
  finished_at: number;
  rank: number;
  total: number;
  behind: number;
}

/** A place on the Crush board leaves `rankBy` out, as every place did before the Rush board. */
const toPlacement = (r: PlaceRow, rankBy: RankBy): DailyPlacement => ({
  day: r.day, difficulty: r.difficulty, rank: r.rank, total: r.total, behind: r.behind, finishedAt: r.finished_at,
  ...(rankBy === 'rush' ? { rankBy } : {}),
});

/**
 * Your places on days that are over, which are final: for the top 10 and top
 * 10% badges. A day's Crush place comes before its Rush place, so an older
 * app, which takes a day's first, shows the Crush one.
 */
export async function pastPlacements(db: D1Database, player: Player, today: DailyDay): Promise<DailyPlacement[]> {
  const boards = await Promise.all(RANK_BYS.map(async (rankBy) => {
    const { results } = await db.prepare(
      `SELECT r.day, r.difficulty, r.guesses, r.ms, r.finished_at, ${placeColumns(rankBy)}
       FROM daily_results r WHERE r.day < ?1 AND ${isPlayers('r.player_id', '?2')} ORDER BY r.day`,
    ).bind(today, player.id).all<PlaceRow>();
    return results.map((r) => toPlacement(r, rankBy));
  }));
  const [rush, crush] = boards;
  return [...crush, ...rush].sort((a, b) => a.day.localeCompare(b.day) || (a.rankBy ? 1 : 0) - (b.rankBy ? 1 : 0));
}

/**
 * Your run to show: today's, or, if you haven't started today's, yesterday's
 * while it's still going, which you can finish off the board.
 */
async function currentRun(env: Env, player: Player, day: DailyDay): Promise<DailyResponse> {
  const asker = { playerId: player.id, aliases: player.aliases };
  const todays = await toDay(env, { ...asker, action: 'get', day });
  if ('error' in todays.body || todays.body.run) return todays;
  const yesterdays = await toDay(env, { ...asker, action: 'get', day: addDays(day, -1) });
  return 'run' in yesterdays.body && yesterdays.body.run?.status === 'playing' ? yesterdays : todays;
}

async function today(env: Env, player: Player, now: number, run: DailyResponse | null = null): Promise<Response> {
  const day = dailyDay(now);
  const answer = run ?? await currentRun(env, player, day);
  if ('error' in answer.body) return json(answer.body, answer.status);
  const theme = (await themeFor(env.DB, day))?.theme ?? null;
  const runDay = answer.body.run?.day;
  const body: DailyToday = {
    day,
    theme,
    runTheme: runDay && runDay !== day ? (await themeFor(env.DB, runDay))?.theme ?? null : theme,
    nextAt: dayEnd(day),
    now,
    run: answer.body.run,
    placements: await pastPlacements(env.DB, player, day),
  };
  return json(body);
}

async function board(
  env: Env, player: Player, day: DailyDay, difficulty: Difficulty, circle: Circle, rankBy: RankBy, now: number,
): Promise<Response> {
  const theme = await themeFor(env.DB, day);
  // No peeking at a day to come.
  if (!theme || day > dailyDay(now)) return errorResponse(404, 'not-found');
  const ids = [player.id, ...player.aliases];
  // Narrowed to you and your friends by your account's ID, the parameter numbered `param`.
  const only = (column: string, param: number) => (circle === 'friends' ? `AND ${inCircle(column, `?${param}`)}` : '');
  const circleArgs = circle === 'friends' ? [player.accountId] : [];
  const order = RANKED[rankBy].join(', ');
  const { results: top } = await env.DB.prepare(
    `SELECT name, guesses, ms, player_id, RANK() OVER (ORDER BY ${order}) AS rank,
       ${circle === 'friends' ? friendCodeSql('player_id', '?3') : 'NULL'} AS friend_code
     FROM daily_results WHERE day = ?1 AND difficulty = ?2 ${only('player_id', 3)}
     ORDER BY ${order}, finished_at LIMIT ${BOARD_SIZE}`,
  ).bind(day, difficulty, ...circleArgs)
    .all<{ name: string; guesses: number; ms: number; player_id: string; rank: number; friend_code: string | null }>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM daily_results WHERE day = ?1 AND difficulty = ?2 ${only('player_id', 3)}`,
  ).bind(day, difficulty, ...circleArgs).first<number>('n');
  const mine = await env.DB.prepare(
    `SELECT r.day, r.difficulty, r.guesses, r.ms, r.finished_at, ${placeColumns(rankBy, only('o.player_id', 4))}
     FROM daily_results r WHERE r.day = ?1 AND r.difficulty = ?2 AND ${isPlayers('r.player_id', '?3')}`,
  ).bind(day, difficulty, player.id, ...circleArgs).first<PlaceRow>();
  // The words stay secret until the day is over, and from you while you finish that day's run late.
  let shown = now >= dayEnd(day);
  if (shown && now < dayEnd(addDays(day, 1))) {
    const yours = await toDay(env, { action: 'get', day, playerId: player.id, aliases: player.aliases });
    shown = !('run' in yours.body && yours.body.run?.status === 'playing');
  }
  const body: DailyBoard = {
    day,
    theme: theme.theme,
    difficulty,
    rankBy,
    words: shown ? [...theme.words] : null,
    total: total ?? 0,
    // Player IDs are credentials, so rows only say which one is yours, and (Friends) a friend's friend code.
    top: top.map((r): DailyBoardRow => ({
      rank: r.rank, name: r.name, guesses: r.guesses, ms: r.ms, you: ids.includes(r.player_id), friendCode: r.friend_code,
    })),
    you: mine ? { ...toPlacement(mine, rankBy), guesses: mine.guesses, ms: mine.ms } : null,
  };
  return json(body);
}

/** Routes `/api/daily…`, or returns null for any other path. */
export async function routeDaily(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/daily' && !pathname.startsWith('/api/daily/')) return null;
  const method = request.method;
  // A signed-in player plays as their account; a guest as their device.
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const { player } = who;

  if (pathname === '/api/daily') return method === 'GET' ? today(env, player, now) : errorResponse(405, 'bad-request');
  if (pathname === '/api/daily/board') {
    if (method !== 'GET') return errorResponse(405, 'bad-request');
    const params = new URL(request.url).searchParams;
    const day = params.get('day');
    const difficulty = params.get('difficulty');
    const circle = params.get('circle') ?? 'everyone';
    // Crush, fewest guesses, unless asked for Rush, fastest: as every board was before Rush and Crush.
    const rankBy = params.get('by') ?? 'crush';
    if (!isDailyDay(day) || !isDifficulty(difficulty) || !isCircle(circle) || !isRankBy(rankBy)) return errorResponse(400, 'bad-request');
    // Only an account has friends.
    if (circle === 'friends' && !player.accountId) return errorResponse(401, 'signed-out');
    return board(env, player, day, difficulty, circle, rankBy, now);
  }

  const action = /^\/api\/daily\/(start|guess|suggest|give-up|pause|resume)$/.exec(pathname)?.[1];
  if (!action) return errorResponse(404, 'not-found');
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  // Easy's Suggest is behind a launch switch (`features.ts`).
  if (action === 'suggest' && !FEATURES.suggest) return errorResponse(404, 'off');
  const body = await readJson(request);
  if (!isObject(body) || !isDailyDay(body.day)) return errorResponse(400, 'bad-request');
  // Starting is for today only. A run still going when the day changes can be finished during the next day, off the board.
  const thisDay = dailyDay(now);
  const late = action !== 'start' && body.day === addDays(thisDay, -1);
  if (body.day !== thisDay && !late) {
    return errorResponse(body.day < thisDay ? 409 : 400, body.day < thisDay ? 'day-over' : 'bad-request');
  }
  const day: DailyDay = body.day;
  const asker = { day, playerId: player.id, aliases: player.aliases };

  let dailyRequest: DailyRequest;
  if (action === 'start') {
    const name = typeof body.name === 'string' && body.name.length <= 64 ? validateName(body.name) : null;
    if (name && !name.ok && name.error === 'offensive') return errorResponse(400, 'offensive-name');
    if (!name?.ok || !isDifficulty(body.difficulty)) return errorResponse(400, 'bad-request');
    await registerGuest(env.DB, player.id, now);
    dailyRequest = { ...asker, action, name: name.name, difficulty: body.difficulty };
  } else if (action === 'guess' || action === 'suggest') {
    if (typeof body.word !== 'string' || body.word.length > 64) return errorResponse(400, 'bad-request');
    dailyRequest = { ...asker, action, word: body.word };
  } else {
    dailyRequest = { ...asker, action: action as 'give-up' | 'pause' | 'resume' };
  }
  return today(env, player, now, await toDay(env, dailyRequest));
}
