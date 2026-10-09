import { GUESS_WORDS, isObject, SECRET_WORDS } from '../../src/game';
import { routeAuth } from './authRoutes';
import { routeDaily } from './dailyRoutes';
import { routeFriends } from './friends';
import { routeGames, routeLiveSocket } from './games';
import { routeLeaderboards } from './leaderboards';
import { routeLobbies } from './lobbyRoutes';
import { routePlayed } from './played';
import { routePush } from './pushRoutes';
import { routeQueue } from './queueRoutes';
import { routeRatings } from './ratings';
import { routeReports } from './reports';
import { routeSync } from './sync';
import { isGuestId, registerGuest } from './guests';
import { corsHeaders, errorResponse, json, readJson } from './http';
import { overLimit } from './limits';
import { checkWord, parseWordCheck } from './words';

/** The bindings and vars wrangler.toml gives the worker. */
export interface Env {
  DB: D1Database;
  /** One Durable Object per game against a friend (`GameRoom`). */
  GAMES: DurableObjectNamespace;
  /** One Durable Object per day's Daily Rush (`DailyRush`), named by the day. */
  DAILY: DurableObjectNamespace;
  /** One Durable Object per Rush with Friends lobby (`RushLobby`), named by its join code. */
  LOBBIES: DurableObjectNamespace;
  /** One Durable Object per matchmaking queue (`Matchmaker`), named by its time control and difficulty. */
  QUEUES: DurableObjectNamespace;
  /** Origins the app is served from, comma-separated. */
  ALLOWED_ORIGINS: string;
  /** Turn notifications (`push.ts`): the server's VAPID public key. Without it and the private key, they're off. */
  VAPID_PUBLIC_KEY?: string;
  /** A secret (`wrangler secret put`, or `.dev.vars` locally). */
  VAPID_PRIVATE_KEY?: string;
  /** Who runs the server, for the push services: a `mailto:` or `https:` URL. */
  VAPID_SUBJECT?: string;
  /** Sign-in emails (`mail.ts`): a Resend API key (a secret) and the address they come from. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  /** "true" prints sign-in emails in the console instead of sending them (local development). */
  LOG_LOGIN_LINKS?: string;
  /** Google sign-in (`google.ts`): the OAuth client's ID and secret (a secret). Without both, it's off. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * Report an issue (`reports.ts`): the repository issues are filed in
   * ("owner/name") and a fine-grained token (a secret) with Issues: read and
   * write on it. Without both, reports are kept and printed, not filed.
   */
  GITHUB_REPO?: string;
  GITHUB_TOKEN?: string;
  /** Rate limits by address (`limits.ts`): 30 a minute, and 3 a minute for reports and sign-in emails. Without them, nothing is limited. */
  RATE_LIMIT?: RateLimit;
  RATE_LIMIT_STRICT?: RateLimit;
  /** 60 a minute for opening a friend's profile, which the app asks for again while the server catches up (item 18cb). */
  RATE_LIMIT_PROFILE?: RateLimit;
}

/**
 * Work that goes on after the answer is sent (`ExecutionContext.waitUntil`),
 * started only when there is one: without it (tests) it isn't started.
 */
export type Later = (work: () => Promise<unknown>) => void;

/**
 * Handles one API request. `now` is the server's clock, passed in (as game
 * logic expects) so tests can fix it, as they can `fetchFn`, for calls the
 * worker makes to other services (email, Google, GitHub), and `later`.
 */
export async function handle(
  request: Request, env: Env, now: number, fetchFn: typeof fetch = fetch, later: Later = () => undefined,
): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'), env.ALLOWED_ORIGINS);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const { pathname } = new URL(request.url);
  const socket = await routeLiveSocket(request, env, pathname);
  if (socket) return socket;
  const response = await overLimit(request, env, pathname) ?? await route(request, env, now, fetchFn, later);
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

async function route(request: Request, env: Env, now: number, fetchFn: typeof fetch, later: Later): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, secretWords: SECRET_WORDS.length, guessWords: GUESS_WORDS.length });
  }
  // A device introduces its guest ID (created on the device) before using
  // anything that needs one; repeating it just updates when it was last seen.
  if (pathname === '/api/guests' && method === 'POST') {
    const body = await readJson(request);
    const id = isObject(body) ? body.id : undefined;
    if (!isGuestId(id)) return errorResponse(400, 'bad-guest-id');
    return json(await registerGuest(env.DB, id, now));
  }
  // The same word checks as the app, for games the server referees.
  if (pathname === '/api/words/check' && method === 'POST') {
    const check = parseWordCheck(await readJson(request));
    if (!check) return errorResponse(400, 'bad-request');
    return json(checkWord(check));
  }
  const auth = await routeAuth(request, env, now, pathname, fetchFn);
  if (auth) return auth;
  const games = await routeGames(request, env, now, pathname, fetchFn);
  if (games) return games;
  const daily = await routeDaily(request, env, now, pathname);
  if (daily) return daily;
  const queue = await routeQueue(request, env, now, pathname);
  if (queue) return queue;
  const lobbies = await routeLobbies(request, env, now, pathname, fetchFn);
  if (lobbies) return lobbies;
  const friends = await routeFriends(request, env, now, pathname, fetchFn);
  if (friends) return friends;
  const sync = await routeSync(request, env, now, pathname, later);
  if (sync) return sync;
  const played = await routePlayed(request, env, now, pathname, later);
  if (played) return played;
  const ratings = await routeRatings(request, env, now, pathname);
  if (ratings) return ratings;
  const leaderboards = await routeLeaderboards(request, env, now, pathname);
  if (leaderboards) return leaderboards;
  const push = await routePush(request, env, now, pathname);
  if (push) return push;
  const reports = await routeReports(request, env, now, pathname, fetchFn);
  if (reports) return reports;
  return errorResponse(404, 'not-found');
}

export { DailyRush } from './dailyRush';
export { GameRoom } from './gameRoom';
export { Matchmaker } from './matchmaker';
export { RushLobby } from './rushLobby';

export default {
  fetch: (request, env, ctx) => handle(request, env, Date.now(), fetch, (work) => ctx.waitUntil(work())),
} satisfies ExportedHandler<Env>;
