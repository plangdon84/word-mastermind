// Copyright (c) 2026 Paul Langdon.
// All rights reserved.
// Proprietary software. See the repository README for terms.

import { FEATURES, GUESS_WORDS, isObject, SECRET_WORDS } from '../../src/game';
import { identify, type Player } from './accounts';
import { routeAdmin } from './admin';
import { authMe, deleteOwnAccount, routeAuth } from './authRoutes';
import { isDailyPath, routeDaily } from './dailyRoutes';
import { PROFILE_SHARE_PATHS, routeProfileShare } from './friendProfiles';
import { forgetOldDeclines, isFriendsPath, routeFriends } from './friends';
import { isGamesPath, routeGames, routeLiveSocket } from './games';
import { routeLeaderboards } from './leaderboards';
import { isLobbyPath, routeLobbies } from './lobbyRoutes';
import { routePlayed } from './played';
import { pushKey, routePush, vapidKeysOf } from './pushRoutes';
import { isQueuePath, routeQueue } from './queueRoutes';
import { routeRatings } from './ratings';
import { isScreenshotPath, routeReports } from './reports';
import { routeSync, SYNC_PATHS } from './sync';
import { isGuestId, registerGuest } from './guests';
import { corsHeaders, errorResponse, json, readJson } from './http';
import { overLimit } from './limits';
import { runReminders } from './reminders';
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
  /** 60 a minute for opening friends' profiles (Dev Plan item 18cb). */
  RATE_LIMIT_PROFILE?: RateLimit;
  /** 60 a minute for indexing your games for friends, apart from opening their profiles (Issue 211). */
  RATE_LIMIT_INDEX?: RateLimit;
  /**
   * The usage dashboard (`admin.ts`, Dev Plan item 18m): the Cloudflare
   * Access team's domain (`TEAM.cloudflareaccess.com`) and the dashboard
   * application's AUD tag, which the figures route checks Access's token
   * against. Set as secrets in the dashboard, so deploys keep them; without
   * both, the route is off.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

/**
 * Handles one API request. `now` is the server's clock, passed in (as game
 * logic expects) so tests can fix it, as they can `fetchFn`, for calls the
 * worker makes to other services (email, Google, GitHub).
 */
export async function handle(
  request: Request, env: Env, now: number, fetchFn: typeof fetch = fetch,
  /** Runs work after the answer is sent (the worker's `waitUntil`); tests leave it out, and the work is awaited. */
  defer?: (work: Promise<unknown>) => void,
): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'), env.ALLOWED_ORIGINS);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const { pathname } = new URL(request.url);
  const socket = await routeLiveSocket(request, env, pathname);
  if (socket) return socket;
  const response = await overLimit(request, env, pathname) ?? await route(request, env, now, fetchFn, defer);
  for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  return response;
}

/** What every route is called with: the request and its path, and the worker's clock, bindings and helpers. */
interface Call {
  request: Request;
  env: Env;
  now: number;
  pathname: string;
  fetchFn: typeof fetch;
  defer: ((work: Promise<unknown>) => void) | undefined;
}

/**
 * One entry of the route table: the paths (and method) it owns, and its
 * answer, null for a path it doesn't know (404). An `open` route answers
 * without knowing who's asking; every other route answers only once
 * `identify` has said who the player is, after `before`'s checks (a method
 * or launch switch it refuses), which come first so a refused request costs
 * no lookup and answers the same with or without a guest ID.
 */
type Route = { owns: (pathname: string, method: string) => boolean } & (
  | { open: true; answer: (call: Call) => Promise<Response | null> | Response }
  | { open?: false; before?: (call: Call) => Response | null; answer: (call: Call, player: Player) => Promise<Response | null> }
);

const exactly = (path: string, method?: string) => (pathname: string, m: string) => pathname === path && (!method || m === method);
const oneOf = (paths: readonly string[]) => (pathname: string) => paths.includes(pathname);
const onlyMethod = (method: string, status = 405, error = 'bad-request') => ({ request }: Call) =>
  request.method === method ? null : errorResponse(status, error);

/**
 * Every API route, the first that owns a path answering it (Dev Plan item
 * 19zp). A new route is identified unless it's marked `open`, so none
 * forgets to check who's asking. The open ones are deliberate: health,
 * guests and word checks need no player; sign-in links, Google and signing
 * out happen before or without a session; reports are filed by anyone; the
 * usage dashboard checks Cloudflare Access's token itself; and the push key
 * is public.
 */
const ROUTES: readonly Route[] = [
  {
    owns: exactly('/api/health', 'GET'), open: true,
    answer: () => json({ ok: true, secretWords: SECRET_WORDS.length, guessWords: GUESS_WORDS.length }),
  },
  // A device introduces its guest ID (created on the device) before using
  // anything that needs one; repeating it just updates when it was last seen.
  {
    owns: exactly('/api/guests', 'POST'), open: true,
    answer: async ({ request, env, now }) => {
      const body = await readJson(request);
      const id = isObject(body) ? body.id : undefined;
      if (!isGuestId(id)) return errorResponse(400, 'bad-guest-id');
      return json(await registerGuest(env.DB, id, now));
    },
  },
  // The same word checks as the app, for games the server referees.
  {
    owns: exactly('/api/words/check', 'POST'), open: true,
    answer: async ({ request }) => {
      const check = parseWordCheck(await readJson(request));
      if (!check) return errorResponse(400, 'bad-request');
      return json(checkWord(check));
    },
  },
  { owns: exactly('/api/auth/me', 'GET'), answer: ({ env, fetchFn }, player) => authMe(env, player, fetchFn) },
  { owns: exactly('/api/auth/delete', 'POST'), answer: ({ env }, player) => deleteOwnAccount(env, player) },
  {
    owns: (pathname) => pathname.startsWith('/api/auth/'), open: true,
    answer: ({ request, env, now, pathname, fetchFn }) => routeAuth(request, env, now, pathname, fetchFn),
  },
  { owns: isGamesPath, answer: ({ request, env, now, pathname, fetchFn }, player) => routeGames(request, env, now, pathname, player, fetchFn) },
  { owns: isDailyPath, answer: ({ request, env, now, pathname }, player) => routeDaily(request, env, now, pathname, player) },
  {
    owns: isQueuePath,
    // Off for the 1.0 launch (the launch switches, `src/game/features.ts`).
    before: (call) => (FEATURES.randomOpponent ? onlyMethod('POST')(call) : errorResponse(404, 'off')),
    answer: ({ request, env, now, pathname }, player) => routeQueue(request, env, now, pathname, player),
  },
  { owns: isLobbyPath, answer: ({ request, env, now, pathname, fetchFn }, player) => routeLobbies(request, env, now, pathname, player, fetchFn) },
  {
    owns: isFriendsPath,
    answer: ({ request, env, now, pathname, fetchFn, defer }, player) => routeFriends(request, env, now, pathname, player, fetchFn, defer),
  },
  {
    owns: oneOf(PROFILE_SHARE_PATHS), before: onlyMethod('POST'),
    answer: ({ request, env, now, pathname }, player) => routeProfileShare(request, env, now, pathname, player),
  },
  { owns: oneOf(SYNC_PATHS), answer: ({ request, env, now, pathname }, player) => routeSync(request, env, now, pathname, player) },
  { owns: exactly('/api/played'), before: onlyMethod('GET'), answer: ({ request, env }, player) => routePlayed(request, env, player) },
  { owns: exactly('/api/ratings'), before: onlyMethod('GET'), answer: ({ env, now }, player) => routeRatings(env, now, player) },
  {
    owns: (pathname) => pathname.startsWith('/api/leaderboards/'),
    before: (call) => (call.pathname === '/api/leaderboards/ratings' ? onlyMethod('GET')(call) : errorResponse(404, 'not-found')),
    answer: ({ request, env, now }, player) => routeLeaderboards(request, env, now, player),
  },
  { owns: exactly('/api/push/key', 'GET'), open: true, answer: ({ env }) => pushKey(env) },
  {
    owns: (pathname) => pathname.startsWith('/api/push/'), before: onlyMethod('POST', 404, 'not-found'),
    answer: ({ request, env, now, pathname }, player) => routePush(request, env, now, pathname, player),
  },
  {
    owns: (pathname, method) => (pathname === '/api/reports' && method === 'POST') || (isScreenshotPath(pathname) && method === 'GET'),
    open: true, answer: ({ request, env, now, pathname, fetchFn }) => routeReports(request, env, now, pathname, fetchFn),
  },
  {
    owns: exactly('/api/admin/figures'), open: true,
    answer: ({ request, env, now, pathname, fetchFn }) => routeAdmin(request, env, now, pathname, fetchFn),
  },
];

async function route(
  request: Request, env: Env, now: number, fetchFn: typeof fetch, defer: ((work: Promise<unknown>) => void) | undefined,
): Promise<Response> {
  const call: Call = { request, env, now, pathname: new URL(request.url).pathname, fetchFn, defer };
  const found = ROUTES.find((r) => r.owns(call.pathname, request.method));
  let answer: Response | null = null;
  if (found?.open) answer = await found.answer(call);
  else if (found) {
    answer = found.before?.(call) ?? null;
    if (!answer) {
      // A signed-in player plays as their account; a guest as their device.
      const who = await identify(request, env.DB, now);
      answer = who.ok ? await found.answer(call, who.player) : errorResponse(who.status, who.error);
    }
  }
  return answer ?? errorResponse(404, 'not-found');
}

export { DailyRush } from './dailyRush';
export { GameRoom } from './gameRoom';
export { Matchmaker } from './matchmaker';
export { RushLobby } from './rushLobby';

/**
 * The scheduled job's tidying (Dev Plan item 19n): declined requests (by
 * email, and any, for the ladder's Add friend, item 19e) are deleted once
 * their week is over. It runs on the job's runs at minute 0
 * only, four times a day with today's crons, so the crons in `wrangler.toml`
 * must keep minute 0.
 */
export async function cleanUp(db: D1Database, now: number): Promise<void> {
  if (new Date(now).getUTCMinutes() !== 0) return;
  await db.batch(forgetOldDeclines(db, now));
}

export default {
  fetch: (request, env, ctx) => handle(request, env, Date.now(), fetch, (work) => ctx.waitUntil(work)),
  // The Cron Trigger (wrangler.toml): the dailies and come-back reminders (`reminders.ts`), and tidying (`cleanUp`).
  scheduled: (controller, env, ctx) => {
    ctx.waitUntil(runReminders(env.DB, vapidKeysOf(env), controller.scheduledTime));
    ctx.waitUntil(cleanUp(env.DB, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
