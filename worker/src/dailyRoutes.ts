import {
  dailyDay, FEATURES, dayEnd, isDailyDay, isDifficulty, isObject, validateName, type DailyDay, type DailyPlacement, type Difficulty,
} from '../../src/game';
import type { DailyBoard, DailyBoardRow, DailyToday } from '../../src/app/dailyApi';
import { isCircle, type Circle } from '../../src/app/leaderboardsApi';
import { identify, isPlayers, type Player } from './accounts';
import type { DailyRequest, DailyResponse } from './dailyRoom';
import { themeFor } from './dailyThemes';
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
 * A result's place on its day's leaderboard, as `rank`, `total` and `behind`
 * columns (fewer guesses, then less time), among the results `filter` (on
 * `o`) keeps.
 */
const placeColumns = (filter = '') => `
  1 + (SELECT COUNT(*) FROM daily_results o WHERE o.day = r.day AND o.difficulty = r.difficulty ${filter}
    AND (o.guesses < r.guesses OR (o.guesses = r.guesses AND o.ms < r.ms))) AS rank,
  (SELECT COUNT(*) FROM daily_results o WHERE o.day = r.day AND o.difficulty = r.difficulty ${filter}) AS total,
  (SELECT COUNT(*) FROM daily_results o WHERE o.day = r.day AND o.difficulty = r.difficulty ${filter}
    AND (o.guesses > r.guesses OR (o.guesses = r.guesses AND o.ms > r.ms))) AS behind`;

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

const toPlacement = (r: PlaceRow): DailyPlacement =>
  ({ day: r.day, difficulty: r.difficulty, rank: r.rank, total: r.total, behind: r.behind, finishedAt: r.finished_at });

/** Your places on days that are over, which are final: for the top 10 and top 10% badges. */
async function pastPlacements(db: D1Database, player: Player, today: DailyDay): Promise<DailyPlacement[]> {
  const { results } = await db.prepare(
    `SELECT r.day, r.difficulty, r.guesses, r.ms, r.finished_at, ${placeColumns()}
     FROM daily_results r WHERE r.day < ?1 AND ${isPlayers('r.player_id', '?2')} ORDER BY r.day`,
  ).bind(today, player.id).all<PlaceRow>();
  return results.map(toPlacement);
}

async function today(env: Env, player: Player, now: number, run: DailyResponse | null = null): Promise<Response> {
  const day = dailyDay(now);
  const answer = run ?? await toDay(env, { action: 'get', day, playerId: player.id, aliases: player.aliases });
  if ('error' in answer.body) return json(answer.body, answer.status);
  const body: DailyToday = {
    day,
    theme: (await themeFor(env.DB, day))?.theme ?? null,
    nextAt: dayEnd(day),
    now,
    run: answer.body.run,
    placements: await pastPlacements(env.DB, player, day),
  };
  return json(body);
}

async function board(
  env: Env, player: Player, day: DailyDay, difficulty: Difficulty, circle: Circle, now: number,
): Promise<Response> {
  const theme = await themeFor(env.DB, day);
  // No peeking at a day to come.
  if (!theme || day > dailyDay(now)) return errorResponse(404, 'not-found');
  const ids = [player.id, ...player.aliases];
  // Narrowed to you and your friends by your account's ID, the parameter numbered `param`.
  const only = (column: string, param: number) => (circle === 'friends' ? `AND ${inCircle(column, `?${param}`)}` : '');
  const circleArgs = circle === 'friends' ? [player.accountId] : [];
  const { results: top } = await env.DB.prepare(
    `SELECT name, guesses, ms, player_id, RANK() OVER (ORDER BY guesses, ms) AS rank
     FROM daily_results WHERE day = ?1 AND difficulty = ?2 ${only('player_id', 3)}
     ORDER BY guesses, ms, finished_at LIMIT ${BOARD_SIZE}`,
  ).bind(day, difficulty, ...circleArgs)
    .all<{ name: string; guesses: number; ms: number; player_id: string; rank: number }>();
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM daily_results WHERE day = ?1 AND difficulty = ?2 ${only('player_id', 3)}`,
  ).bind(day, difficulty, ...circleArgs).first<number>('n');
  const mine = await env.DB.prepare(
    `SELECT r.day, r.difficulty, r.guesses, r.ms, r.finished_at, ${placeColumns(only('o.player_id', 4))}
     FROM daily_results r WHERE r.day = ?1 AND r.difficulty = ?2 AND ${isPlayers('r.player_id', '?3')}`,
  ).bind(day, difficulty, player.id, ...circleArgs).first<PlaceRow>();
  const body: DailyBoard = {
    day,
    theme: theme.theme,
    difficulty,
    // The words stay secret until the day is over.
    words: now >= dayEnd(day) ? [...theme.words] : null,
    total: total ?? 0,
    // Player IDs are credentials, so rows only say which one is yours.
    top: top.map((r): DailyBoardRow => ({ rank: r.rank, name: r.name, guesses: r.guesses, ms: r.ms, you: ids.includes(r.player_id) })),
    you: mine ? { ...toPlacement(mine), guesses: mine.guesses, ms: mine.ms } : null,
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
    if (!isDailyDay(day) || !isDifficulty(difficulty) || !isCircle(circle)) return errorResponse(400, 'bad-request');
    // Only an account has friends.
    if (circle === 'friends' && !player.accountId) return errorResponse(401, 'signed-out');
    return board(env, player, day, difficulty, circle, now);
  }

  const action = /^\/api\/daily\/(start|guess|suggest|give-up)$/.exec(pathname)?.[1];
  if (!action) return errorResponse(404, 'not-found');
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  // Easy's Suggest is behind a launch switch (`features.ts`).
  if (action === 'suggest' && !FEATURES.suggest) return errorResponse(404, 'off');
  const body = await readJson(request);
  if (!isObject(body) || !isDailyDay(body.day)) return errorResponse(400, 'bad-request');
  // Moves are for today only: a run not finished when the day changes has no entry.
  const day = dailyDay(now);
  if (body.day !== day) return errorResponse(body.day < day ? 409 : 400, body.day < day ? 'day-over' : 'bad-request');
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
    dailyRequest = { ...asker, action: 'give-up' };
  }
  return today(env, player, now, await toDay(env, dailyRequest));
}
