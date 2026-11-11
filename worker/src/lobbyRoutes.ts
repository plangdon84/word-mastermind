import { FEATURES, isDifficulty, isObject, isRankBy, isStrength, lobbyRankBy, newLobbyCode } from '../../src/game';
import { isSentWord, sentName } from './requestChecks';
import { isFriendCode } from '../../src/app/friendsApi';
import { parseLobbyAnswer } from '../../src/app/lobbyApi';
import type { Player } from './accounts';
import { friendByCode, sendNotices } from './friends';
import { registerGuest } from './guests';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import type { LobbyRequest } from './lobbyRoom';
import { lobbyInviteNotice } from './notices';
import { secureRandom } from './secure';

/*
 * Rush with Friends and Competitive Rush: the worker checks who is asking and what they sent,
 * then hands the request to the lobby's Durable Object (`RushLobby`, named
 * by the join code), which referees it.
 */

const LOBBY_PATH = /^\/api\/lobbies\/([^/]+)(?:\/(join|leave|close|settings|start|guess|suggest|give-up-word|give-up|invite|word))?$/;

/** Tries this many codes before giving up on opening a lobby (a clash is about one in a billion). */
const CODE_TRIES = 5;


export async function toLobby(env: Env, code: string, request: LobbyRequest): Promise<Response> {
  const response = await env.LOBBIES.get(env.LOBBIES.idFromName(code)).fetch('https://lobby/', {
    method: 'POST', body: JSON.stringify(request), headers: { 'content-type': 'application/json' },
  });
  // A fresh response, so the worker can add its CORS headers.
  return new Response(response.body, response);
}

/** The paths `routeLobbies` answers. */
export const isLobbyPath = (pathname: string) => pathname === '/api/lobbies' || LOBBY_PATH.test(pathname);

/** Routes `/api/lobbies…` for `player` (a signed-in player plays as their account; a guest as their device). */
export async function routeLobbies(
  request: Request, env: Env, now: number, pathname: string, player: Player, fetchFn: typeof fetch = fetch,
): Promise<Response | null> {
  const isRoot = pathname === '/api/lobbies';
  const match = isRoot ? null : LOBBY_PATH.exec(pathname);
  if (!isRoot && !match) return null;
  const method = request.method;
  const asker = { playerId: player.id, aliases: player.aliases, signedIn: player.accountId !== null };

  if (isRoot) {
    if (method !== 'POST') return errorResponse(405, 'bad-request');
    const body = await readJson(request);
    if (!isObject(body) || !isDifficulty(body.difficulty)) return errorResponse(400, 'bad-request');
    if (body.rankBy !== undefined && !isRankBy(body.rankBy)) return errorResponse(400, 'bad-request');
    const competitive = body.kind === 'competitive';
    if ((body.kind !== undefined && !competitive) || (competitive && !isSentWord(body.word))) return errorResponse(400, 'bad-request');
    // Off for the 1.0 launch (the launch switches, `src/game/features.ts`).
    if (competitive && !FEATURES.competitiveRush) return errorResponse(404, 'off');
    const name = sentName(body.name);
    if (!name.ok) return errorResponse(400, name.error);
    await registerGuest(env.DB, asker.playerId, now);
    for (let i = 0; i < CODE_TRIES; i++) {
      const code = newLobbyCode(secureRandom);
      const response = await toLobby(env, code, {
        ...asker, action: 'create', code, name: name.name, difficulty: body.difficulty,
        ...(body.rankBy === 'rush' ? { rankBy: 'rush' as const } : {}),
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
    const accountId = player.accountId;
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
    await sendNotices(env, [lobbyInviteNotice(friend.id, answer.lobby.hostName, code, answer.lobby.kind, lobbyRankBy(answer.lobby.settings))], now, fetchFn);
    return json(answer);
  }

  let lobbyRequest: LobbyRequest;
  switch (action) {
    case 'join': {
      const name = sentName(body.name);
      if (!name.ok) return errorResponse(400, name.error);
      if (body.word !== undefined && !isSentWord(body.word)) return errorResponse(400, 'bad-request');
      await registerGuest(env.DB, asker.playerId, now);
      lobbyRequest = { ...asker, action, name: name.name, ...(body.word !== undefined ? { word: body.word as string } : {}) };
      break;
    }
    case 'word':
      if (!isSentWord(body.word)) return errorResponse(400, 'bad-request');
      lobbyRequest = { ...asker, action, word: body.word };
      break;
    case 'settings': {
      const { difficulty, minutes, computers, strength, rankBy } = body;
      if (!isDifficulty(difficulty) || typeof minutes !== 'number' || typeof computers !== 'number' || !isStrength(strength)
        || (rankBy !== undefined && !isRankBy(rankBy))) {
        return errorResponse(400, 'bad-request');
      }
      lobbyRequest = { ...asker, action, settings: { difficulty, minutes, computers, strength, ...(rankBy === 'rush' ? { rankBy } : {}) } };
      break;
    }
    case 'guess':
    case 'suggest':
      if (!isSentWord(body.word)) return errorResponse(400, 'bad-request');
      lobbyRequest = { ...asker, action, word: body.word };
      break;
    default:
      lobbyRequest = { ...asker, action: action as 'leave' | 'close' | 'start' | 'give-up-word' | 'give-up' };
  }
  return toLobby(env, code, lobbyRequest);
}
