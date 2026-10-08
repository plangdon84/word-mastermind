import {
  FEATURES, isDifficulty, isObject, isTimeControl, parseMarks, isTurnDays, validateName, validateSecretWord, type Difficulty, type TimeControl,
} from '../../src/game';
import type { FriendGame } from '../../src/app/friendApi';
import { isFriendCode } from '../../src/app/friendsApi';
import { identify, isPlayers, type Player } from './accounts';
import { friendByCode, sendNotices } from './friends';
import { registerGuest } from './guests';
import { corsHeaders, errorResponse, json, readJson } from './http';
import type { Env } from './index';
import { challengeNotice, rematchNotice } from './notices';
import type { Seeker } from './queue';
import type { RematchPlan, Player as RoomPlayer, RoomRequest } from './room';

/*
 * Games against a friend: the worker checks who is asking and what they
 * sent, then hands the request to the game's Durable Object (`GameRoom`),
 * which referees it.
 */

/** A Durable Object ID as `newUniqueId` makes them: 64 hex digits, long enough that nobody guesses an invite. */
const GAME_ID = /^[0-9a-f]{64}$/;

const GAME_PATH = /^\/api\/games\/([^/]+)(?:\/(join|guess|concede|decline|difficulty|suggest|rematch))?$/;

// Longer than any word or name by far; not worth normalizing.
export const isShortString = (value: unknown, max = 64): value is string => typeof value === 'string' && value.length <= max;

/** A display name as the profile allows it, normalized. */
export function nameOf(value: unknown): string | null {
  if (!isShortString(value)) return null;
  const name = validateName(value);
  return name.ok ? name.name : null;
}

/** The time control a new game asks for; apps from before live games send `turnDays`. */
function timeControlOf(body: Record<string, unknown>): TimeControl | null {
  if (isTimeControl(body.timeControl)) return body.timeControl;
  return body.timeControl === undefined && isTurnDays(body.turnDays) ? `${body.turnDays}d` : null;
}

/** Reads the body each action needs, or null if it's missing or malformed. */
function parseAction(action: string, body: unknown, player: Player): RoomRequest | null {
  if (!isObject(body)) return null;
  const { id: guestId, aliases } = player;
  switch (action) {
    case 'join': {
      const name = nameOf(body.name);
      if (!name || !isShortString(body.secret) || !isDifficulty(body.difficulty)) return null;
      return { action: 'join', guestId, aliases, name, secret: body.secret, difficulty: body.difficulty };
    }
    case 'guess': {
      // The guesser's Medium marks, shared with their opponent: only letters a–z marked in or out are kept.
      if (!isShortString(body.word) || (body.marks !== undefined && !isObject(body.marks))) return null;
      return { action, guestId, aliases, word: body.word, ...(body.marks ? { marks: parseMarks(body.marks) } : {}) };
    }
    case 'suggest':
      return isShortString(body.word) ? { action, guestId, aliases, word: body.word } : null;
    case 'concede':
    case 'decline':
      return { action, guestId, aliases };
    case 'difficulty':
      return isDifficulty(body.difficulty) ? { action: 'difficulty', guestId, aliases, difficulty: body.difficulty } : null;
    default:
      return null;
  }
}

async function toRoom(env: Env, id: DurableObjectId, request: RoomRequest): Promise<Response> {
  const response = await env.GAMES.get(id).fetch('https://room/', {
    method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
  });
  // A fresh response, so the worker can add its CORS headers.
  return new Response(response.body, response);
}

/** Most games `GET /api/games` lists, newest first. */
export const LISTED_GAMES = 50;

/** Notes that a player is in a game, for `GET /api/games`. */
async function addPlayer(db: D1Database, gameId: string, guestId: string, now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO friend_game_players (game_id, guest_id, added_at) VALUES (?1, ?2, ?3)')
    .bind(gameId, guestId, now).run();
}

/** The games a player (under any of their IDs) sent or accepted, newest first. */
async function listGames(db: D1Database, player: Player): Promise<{ id: string; addedAt: number }[]> {
  const { results } = await db.prepare(
    `SELECT game_id, MIN(added_at) AS added_at FROM friend_game_players
     WHERE ${isPlayers('guest_id', '?1')}
     GROUP BY game_id ORDER BY added_at DESC LIMIT ${LISTED_GAMES}`,
  ).bind(player.id).all<{ game_id: string; added_at: number }>();
  return results.map((r) => ({ id: r.game_id, addedAt: r.added_at }));
}

const LIVE_PATH = /^\/api\/games\/([0-9a-f]{64})\/live$/;

/**
 * An open game page's WebSocket (`/api/games/ID/live`), handed to the game's
 * Durable Object, which says "changed" down it after every move so the page
 * looks again at once; or null for any other request. It carries nothing
 * else, so it needs no identity: the page fetches the game as usual. It's
 * answered before CORS, which doesn't apply to WebSockets, so the origin is
 * checked here.
 */
export async function routeLiveSocket(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const match = LIVE_PATH.exec(pathname);
  if (!match || request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return null;
  const origin = request.headers.get('origin');
  if (origin !== null && Object.keys(corsHeaders(origin, env.ALLOWED_ORIGINS)).length === 0) {
    return errorResponse(403, 'bad-request');
  }
  let id: DurableObjectId;
  try {
    id = env.GAMES.idFromString(match[1]);
  } catch {
    return errorResponse(404, 'not-found');
  }
  return env.GAMES.get(id).fetch(request);
}

/**
 * Starts a rated game between two players the matchmaking queue paired
 * (`queue.ts`): `host` waited longer and `guest` made the match. It's a
 * challenge only the guest may accept, accepted at once, and it's listed as
 * theirs like any game against a friend.
 */
export async function startMatchedGame(
  env: Env, host: Seeker, guest: Seeker, timeControl: TimeControl, difficulty: Difficulty, now: number,
): Promise<string> {
  const id = env.GAMES.newUniqueId();
  const created = await toRoom(env, id, {
    action: 'create', id: id.toString(), guestId: host.accountId, name: host.name, secret: host.secret, difficulty, timeControl,
    invitee: { guestId: guest.accountId, name: guest.name }, rated: true, matched: true,
  });
  if (!created.ok) throw new Error(`Couldn't create a matched game: ${created.status}`);
  const joined = await toRoom(env, id, {
    action: 'join', guestId: guest.accountId, name: guest.name, secret: guest.secret, difficulty,
  });
  if (!joined.ok) throw new Error(`Couldn't start a matched game: ${joined.status}`);
  await addPlayer(env.DB, id.toString(), host.accountId, now);
  await addPlayer(env.DB, id.toString(), guest.accountId, now);
  return id.toString();
}

/**
 * A rematch of a finished game (README "Rematch"): a challenge to the other
 * player only, with the same clock, each side's difficulty from the end of
 * the game, and rated if it was. The old game's room keeps one rematch: if
 * the other player asked first, this accepts theirs with your word instead.
 */
async function rematch(
  env: Env, oldId: DurableObjectId, player: Player, body: unknown, now: number, fetchFn: typeof fetch,
): Promise<Response> {
  if (!isObject(body)) return errorResponse(400, 'bad-request');
  const name = nameOf(body.name);
  if (!name || !isShortString(body.secret)) return errorResponse(400, 'bad-request');
  // Checked before the old room notes the rematch, so creating it can't fail on the word.
  const secret = validateSecretWord(body.secret);
  if (!secret.ok) return errorResponse(400, secret.error);
  const first = await askForRematch(env, oldId, player, name, secret.word, now, fetchFn);
  if (first.status !== 409) return first;
  // The rematch it found closed (declined or expired) after it looked: that one gives way now (issue #119).
  const { error } = await first.clone().json<{ error?: string }>().catch(() => ({ error: undefined }));
  return error === 'invite-closed' || error === 'invite-expired'
    ? askForRematch(env, oldId, player, name, secret.word, now, fetchFn) : first;
}

/** One go at a rematch: a new one, the one you sent, or theirs accepted with your word. */
async function askForRematch(
  env: Env, oldId: DurableObjectId, player: Player, name: string, word: string, now: number, fetchFn: typeof fetch,
): Promise<Response> {
  const { id: guestId, aliases } = player;
  const newId = env.GAMES.newUniqueId();
  let replacing: string | undefined;
  const ask = async (record: boolean): Promise<Response | RematchPlan> => {
    const asked = await toRoom(env, oldId, { action: 'rematch', guestId, aliases, newId: newId.toString(), record, replacing });
    return asked.ok ? asked.json<RematchPlan>() : asked;
  };
  /** Accepts the rematch the other player asked for, with your word; or shows yours. */
  const answer = async (existing: Extract<RematchPlan, { kind: 'existing' }>): Promise<Response> => {
    const id = env.GAMES.idFromString(existing.id);
    if (existing.byYou) return toRoom(env, id, { action: 'get', guestId, aliases });
    await registerGuest(env.DB, guestId, now);
    // Joining keeps your seat's difficulty from the last game, which the room holds.
    const joined = await toRoom(env, id, { action: 'join', guestId, aliases, name, secret: word, difficulty: 'medium' });
    if (joined.ok) await addPlayer(env.DB, existing.id, guestId, now);
    return joined;
  };

  let plan = await ask(false);
  if (plan instanceof Response) return plan;
  if (plan.kind === 'existing') {
    // A rematch that was declined or expired gives way to a new one; one its sender cancelled doesn't,
    // so cancelling and sending again can't be used to send notification after notification.
    const earlier = await toRoom(env, env.GAMES.idFromString(plan.id), { action: 'get', guestId, aliases });
    const state = earlier.ok ? (await earlier.json<FriendGame>()).state : null;
    if (state !== 'declined' && state !== 'expired') return answer(plan);
    replacing = plan.id;
    plan = await ask(false);
    if (plan instanceof Response) return plan;
    if (plan.kind === 'existing') return answer(plan);
  }
  // The new game is made first and only then recorded on the old one, so a
  // rematch that failed to start never blocks another.
  await registerGuest(env.DB, guestId, now);
  const response = await toRoom(env, newId, {
    action: 'create', id: plan.id, guestId, name, secret: word, difficulty: plan.difficulty, timeControl: plan.timeControl,
    invitee: plan.invitee, rated: plan.rated, rematchOf: oldId.toString(), inviteeDifficulty: plan.inviteeDifficulty,
  });
  if (!response.ok) return response;
  const recorded = await ask(true);
  if (recorded instanceof Response || recorded.kind === 'existing') {
    // The other player's rematch was recorded in between: withdraw this one and accept theirs.
    await toRoom(env, newId, { action: 'concede', guestId, aliases });
    return recorded instanceof Response ? recorded : answer(recorded);
  }
  await Promise.all([addPlayer(env.DB, plan.id, guestId, now), addPlayer(env.DB, plan.id, plan.invitee.guestId, now)]);
  await sendNotices(env, [rematchNotice(plan.invitee.guestId, name, plan.timeControl, plan.id, plan.rated)], now, fetchFn);
  return response;
}

/** Routes `/api/games…`, or returns null for any other path. */
export async function routeGames(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch = fetch,
): Promise<Response | null> {
  const method = request.method;
  const isRoot = pathname === '/api/games';
  const match = isRoot ? null : GAME_PATH.exec(pathname);
  if (!isRoot && !match) return null;

  // A signed-in player plays as their account; a guest as their device.
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const { player } = who;

  if (isRoot && method === 'GET') return json({ games: await listGames(env.DB, player) });
  if (isRoot) {
    if (method !== 'POST') return errorResponse(405, 'bad-request');
    const body = await readJson(request);
    if (!isObject(body)) return errorResponse(400, 'bad-request');
    const name = nameOf(body.name);
    const timeControl = timeControlOf(body);
    if (!name || !isShortString(body.secret) || !isDifficulty(body.difficulty) || !timeControl) {
      return errorResponse(400, 'bad-request');
    }
    // A challenge to a friend (signed in): only they can accept it, and it's in their list at once.
    let invitee: RoomPlayer | null = null;
    // Only a challenge to a friend can be rated: both are accounts.
    if (body.rated !== undefined && (typeof body.rated !== 'boolean' || (body.rated && body.friend === undefined))) {
      return errorResponse(400, 'bad-request');
    }
    if (body.friend !== undefined) {
      if (!isFriendCode(body.friend)) return errorResponse(400, 'bad-request');
      if (!player.accountId) return errorResponse(401, 'signed-out');
      const friend = await friendByCode(env.DB, player.accountId, body.friend);
      if (!friend) return errorResponse(403, 'not-a-friend');
      invitee = { guestId: friend.id, name: friend.name };
    }
    await registerGuest(env.DB, player.id, now);
    const id = env.GAMES.newUniqueId();
    const response = await toRoom(env, id, {
      action: 'create', id: id.toString(), guestId: player.id, name, secret: body.secret, difficulty: body.difficulty,
      timeControl, invitee, rated: body.rated === true,
    });
    if (response.ok) {
      await addPlayer(env.DB, id.toString(), player.id, now);
      if (invitee) {
        await addPlayer(env.DB, id.toString(), invitee.guestId, now);
        await sendNotices(env, [challengeNotice(invitee.guestId, name, timeControl, id.toString(), body.rated === true)], now, fetchFn);
      }
    }
    return response;
  }

  const [, gameId, action] = match!;
  if (!GAME_ID.test(gameId)) return errorResponse(404, 'not-found');
  const id = env.GAMES.idFromString(gameId);
  if (!action) {
    return method === 'GET'
      ? toRoom(env, id, { action: 'get', guestId: player.id, aliases: player.aliases })
      : errorResponse(405, 'bad-request');
  }
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  // Easy's Suggest is behind a launch switch (`features.ts`).
  if (action === 'suggest' && !FEATURES.suggest) return errorResponse(404, 'off');
  if (action === 'rematch') return rematch(env, id, player, await readJson(request), now, fetchFn);
  const roomRequest = parseAction(action, await readJson(request), player);
  if (!roomRequest) return errorResponse(400, 'bad-request');
  if (roomRequest.action !== 'join') return toRoom(env, id, roomRequest);
  await registerGuest(env.DB, player.id, now);
  const response = await toRoom(env, id, roomRequest);
  if (response.ok) await addPlayer(env.DB, gameId, player.id, now);
  return response;
}
