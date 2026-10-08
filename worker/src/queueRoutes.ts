import { FEATURES, isDifficulty, isLive, isObject, isRatedDifficulty, isTimeControl, ratingPool } from '../../src/game';
import type { QueueChoice } from '../../src/app/queueApi';
import { identify } from './accounts';
import { isShortString, nameOf } from './games';
import { registerGuest } from './guests';
import { errorResponse, readJson } from './http';
import type { Env } from './index';
import { queueName, type MatchmakerRequest } from './matchmaker';
import { currentRating } from './ratings';

/*
 * The matchmaking queue (README "Random opponent"): the worker checks who
 * is asking (signed in: matched games are rated) and what they sent, then
 * hands the request to the queue's Durable Object (`Matchmaker`).
 */

const QUEUE_PATH = /^\/api\/queue(?:\/(poll|leave))?$/;

/**
 * The queue's time control and difficulty. Live clocks only: a matched
 * correspondence game would need the queue to work without an open page.
 * Matched games are rated, so not Easy.
 */
function choiceOf(body: Record<string, unknown>): QueueChoice | null {
  return isTimeControl(body.timeControl) && isLive(body.timeControl) && isDifficulty(body.difficulty)
    && isRatedDifficulty(body.difficulty)
    ? { timeControl: body.timeControl, difficulty: body.difficulty } : null;
}

async function toQueue(env: Env, request: MatchmakerRequest): Promise<Response> {
  const response = await env.QUEUES.get(env.QUEUES.idFromName(queueName(request))).fetch('https://queue/', {
    method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
  });
  // A fresh response, so the worker can add its CORS headers.
  return new Response(response.body, response);
}

/** Routes `/api/queue…`, or returns null for any other path. */
export async function routeQueue(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  const match = QUEUE_PATH.exec(pathname);
  if (!match) return null;
  // Off for the 1.0 launch (the launch switches, `src/game/features.ts`).
  if (!FEATURES.randomOpponent) return errorResponse(404, 'off');
  if (request.method !== 'POST') return errorResponse(405, 'bad-request');
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const accountId = who.player.accountId;
  if (!accountId) return errorResponse(401, 'signed-out');
  const body = await readJson(request);
  const choice = isObject(body) ? choiceOf(body) : null;
  if (!isObject(body) || !choice) return errorResponse(400, 'bad-request');

  const action = match[1];
  if (action === 'poll' || action === 'leave') return toQueue(env, { ...choice, action, accountId });
  const name = nameOf(body.name);
  if (!name || !isShortString(body.secret)) return errorResponse(400, 'bad-request');
  await registerGuest(env.DB, accountId, now);
  const rating = await currentRating(env.DB, accountId, ratingPool(choice.timeControl), now);
  return toQueue(env, { ...choice, action: 'join', accountId, name, secret: body.secret, rating });
}
