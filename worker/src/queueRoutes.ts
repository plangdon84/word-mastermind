import { FEATURES, isObject, isProvisional, LADDER_CHOICE, ladderComputer, type QueueChoice, TWO_PLAYER_POOL } from '../../src/game';
import type { Player } from './accounts';
import { isSentWord, sentName } from './requestChecks';
import { registerGuest } from './guests';
import { errorResponse, readJson } from './http';
import type { Env } from './index';
import { queueName, type MatchmakerRequest } from './matchmaker';
import { ladderAverageOf } from './friendProfiles';
import { currentRating } from './ratings';

/*
 * The matchmaking queue (README "Random opponent"): the worker checks who
 * is asking (signed in: matched games are rated) and what they sent, then
 * hands the request to the queue's Durable Object (`Matchmaker`).
 */

const QUEUE_PATH = /^\/api\/queue(?:\/(poll|leave|busy))?$/;

/**
 * The queue's time control and difficulty: Live 10 at Medium alone since
 * Dev Plan item 19p (`LADDER_CHOICE`), with queues per difficulty once
 * there are enough players.
 */
function choiceOf(body: Record<string, unknown>): QueueChoice | null {
  return body.timeControl === LADDER_CHOICE.timeControl && body.difficulty === LADDER_CHOICE.difficulty ? LADDER_CHOICE : null;
}

async function toQueue(env: Env, request: MatchmakerRequest): Promise<Response> {
  const response = await env.QUEUES.get(env.QUEUES.idFromName(queueName(request))).fetch('https://queue/', {
    method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
  });
  // A fresh response, so the worker can add its CORS headers.
  return new Response(response.body, response);
}

/** The paths `routeQueue` answers: POST only, while the launch switch is on. */
export const isQueuePath = (pathname: string) => QUEUE_PATH.test(pathname);

/** Routes `POST /api/queue…` for `player`. */
export async function routeQueue(request: Request, env: Env, now: number, pathname: string, player: Player): Promise<Response | null> {
  const match = QUEUE_PATH.exec(pathname);
  if (!match) return null;
  const accountId = player.accountId;
  if (!accountId) return errorResponse(401, 'signed-out');
  const body = await readJson(request);
  const choice = isObject(body) ? choiceOf(body) : null;
  if (!isObject(body) || !choice) return errorResponse(400, 'bad-request');

  const action = match[1];
  if (action === 'busy') return toQueue(env, { ...choice, action });
  if (action === 'poll' || action === 'leave') return toQueue(env, { ...choice, action, accountId });
  const sent = sentName(body.name);
  if (!sent.ok) return errorResponse(400, sent.error);
  const { name } = sent;
  if (!isSentWord(body.secret)) return errorResponse(400, 'bad-request');
  await registerGuest(env.DB, accountId, now);
  const rating = await currentRating(env.DB, accountId, TWO_PLAYER_POOL, now);
  // The computer they'd play if nobody is free: by rating once it's settled, else by their shared average.
  // The average is read only while it's used: a settled rating picks the computer alone.
  const computer = ladderComputer(rating, isProvisional(rating) ? await ladderAverageOf(env.DB, accountId) : null).recall;
  return toQueue(env, { ...choice, action: 'join', accountId, name, secret: body.secret, rating, computer });
}
