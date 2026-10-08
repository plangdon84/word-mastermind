import { FEATURES, isDifficulty, isObject, isStrength, newLobbyCode, validateName } from '../../src/game';
import { isFriendCode } from '../../src/app/friendsApi';
import { parseLobbyAnswer } from '../../src/app/lobbyApi';
import { identify } from './accounts';
import { friendByCode, sendNotices } from './friends';
import { registerGuest } from './guests';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import type { LobbyRequest } from './lobbyRoom';
import { lobbyInviteNotice } from './notices';

/*
 * Rush with Friends and Competitive Rush: the worker checks who is asking and what they sent,
 * then hands the request to the lobby's Durable Object (`RushLobby`, named
 * by the join code), which referees it.
 */

const LOBBY_PATH = /^\/api\/lobbies\/([^/]+)(?:\/(join|leave|close|settings|start|guess|suggest|give-up-word|give-up|invite|word))?$/;

/** Tries this many codes before giving up on opening a lobby (a clash is about one in a billion). */
const CODE_TRIES = 5;

/** A random number in [0, 1) that nobody can predict, for join codes. */
const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

export async function toLobby(env: Env, code: string, request: LobbyRequest): Promise<Response> {
  const response = await env.LOBBIES.get(env.LOBBIES.idFromName(code)).fetch('https://lobby/', {
    method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
  });
  // A fresh response, so the worker can add its CORS headers.
  return new Response(response.body, response);
}

/** A word as sent: checked properly by the lobby, which says what's wrong with it. */
const isWord = (value: unknown): value is string => typeof value === 'string' && value.length <= 64;

/** A display name, shown to the other players: it must pass the profile's rules, profanity filter included. */
function nameOf(value: unknown): { name: string } | { error: string } {
  if (typeof value !== 'string' || value.length > 64) return { error: 'bad-request' };
  const name = validateName(value);
  if (name.ok) return { name: name.name };
  return { error: name.error === 'offensive' ? 'offensive-name' : 'bad-request' };
}

/** Routes `/api/lobbies…`, or returns null for any other path. */
export async function routeLobbies(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch = fetch,
): Promise<Response | null> {
  const isRoot = pathname === '/api/lobbies';
  const match = isRoot ? null : LOBBY_PATH.exec(pathname);
  if (!isRoot && !match) return null;
  const method = request.method;
  // A signed-in player plays as their account; a guest as their device.
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const asker = { playerId: who.player.id, aliases: who.player.aliases, signedIn: who.player.accountId !== null };

  if (isRoot) {
    if (method !== 'POST') return errorResponse(405, 'bad-request');
    const body = await readJson(request);
    if (!isObject(body) || !isDifficulty(body.difficulty)) return errorResponse(400, 'bad-request');
    const competitive = body.kind === 'competitive';
    if ((body.kind !== undefined && !competitive) || (competitive && !isWord(body.word))) return errorResponse(400, 'bad-request');
    // Off for the 1.0 launch (the launch switches, `src/game/features.ts`).
    if (competitive && !FEATURES.competitiveRush) return errorResponse(404, 'off');
    const name = nameOf(body.name);
    if ('error' in name) return errorResponse(400, name.error);
    await registerGuest(env.DB, asker.playerId, now);
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = newLobbyCode(secureRandom);
      const response = await toLobby(env, code, {
        ...asker, action: 'create', code, name: name.name, difficulty: body.difficulty,
        ...(competitive ? { kind: 'competitive' as const, word: body.word as string } : {}),
      });
      if (response.status !== 409) return response;
    }
    return errorResponse(503, 'unreachable');
  }

  const [, code, action] = match!;
  if (!/^[A-Z0-9]{6}$/.test(code)) return errorResponse(404, 'not-found');
  if (!action) return method === 'GET' ? toLobby(env, code, { ...asker, action: 'get' }) : errorResponse(405, 'bad-request');
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  // Easy's Suggest is behind a launch switch (`features.ts`).
  if (action === 'suggest' && !FEATURES.suggest) return errorResponse(404, 'off');
  const body = await readJson(request) ?? {};
  if (!isObject(body)) return errorResponse(400, 'bad-request');

  // The host invites a friend (both signed in): it's on the friend's title screen, and they're notified.
  if (action === 'invite') {
    const accountId = who.player.accountId;
    if (!accountId) return errorResponse(401, 'signed-out');
    if (!isFriendCode(body.friend)) return errorResponse(400, 'bad-request');
    const friend = await friendByCode(env.DB, accountId, body.friend);
    if (!friend) return errorResponse(403, 'not-a-friend');
    const response = await toLobby(env, code, { ...asker, action: 'get' });
    if (!response.ok) return response;
    const answer = parseLobbyAnswer(await response.json());
    if (!answer) return errorResponse(502, 'bad-request');
    if (!answer.lobby.host) return errorResponse(403, 'not-host');
    if (answer.lobby.state !== 'open') return errorResponse(409, answer.lobby.state === 'closed' ? 'lobby-closed' : 'already-started');
    await env.DB.prepare(
      `INSERT INTO lobby_invites (account_id, code, from_name, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (account_id, code) DO UPDATE SET from_name = excluded.from_name, created_at = excluded.created_at`,
    ).bind(friend.id, code, answer.lobby.hostName, now).run();
    await sendNotices(env, [lobbyInviteNotice(friend.id, answer.lobby.hostName, code, answer.lobby.kind)], now, fetchFn);
    return json(answer);
  }

  let lobbyRequest: LobbyRequest;
  switch (action) {
    case 'join': {
      const name = nameOf(body.name);
      if ('error' in name) return errorResponse(400, name.error);
      if (body.word !== undefined && !isWord(body.word)) return errorResponse(400, 'bad-request');
      await registerGuest(env.DB, asker.playerId, now);
      lobbyRequest = { ...asker, action, name: name.name, ...(body.word !== undefined ? { word: body.word as string } : {}) };
      break;
    }
    case 'word':
      if (!isWord(body.word)) return errorResponse(400, 'bad-request');
      lobbyRequest = { ...asker, action, word: body.word };
      break;
    case 'settings': {
      const { difficulty, minutes, computers, strength } = body;
      if (!isDifficulty(difficulty) || typeof minutes !== 'number' || typeof computers !== 'number' || !isStrength(strength)) {
        return errorResponse(400, 'bad-request');
      }
      lobbyRequest = { ...asker, action, settings: { difficulty, minutes, computers, strength } };
      break;
    }
    case 'guess':
    case 'suggest':
      if (!isWord(body.word)) return errorResponse(400, 'bad-request');
      lobbyRequest = { ...asker, action, word: body.word };
      break;
    default:
      lobbyRequest = { ...asker, action: action as 'leave' | 'close' | 'start' | 'give-up-word' | 'give-up' };
  }
  return toLobby(env, code, lobbyRequest);
}
