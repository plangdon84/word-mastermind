import { isObject, LOBBY_CODE_ALPHABET, OPEN_LOBBY_MS } from '../../src/game';
import {
  FRIEND_CODE_LENGTH, INVITE_KEY_LENGTH, isFriendCode, isInviteKey, MAX_FRIENDS, type Friend, type FriendsList, type LobbyInvite,
} from '../../src/app/friendsApi';
import { parseLobbyAnswer } from '../../src/app/lobbyApi';
import { identify } from './accounts';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import { toLobby } from './lobbyRoutes';
import { friendAcceptedNotice, friendRequestNotice, type Notice } from './notices';
import { notifyGuest } from './push';
import { vapidKeysOf } from './pushRoutes';
import { syncedName } from './sync';

/*
 * Friends (README "Friends"): signed-in players add each other by friend
 * code. A request becomes a friendship once the other player adds you back
 * (accepts). A private invite link (its key) makes friends at once. Friends can challenge each other to a game (`games.ts`) and
 * invite each other to a Rush with Friends lobby (`lobbyRoutes.ts`).
 */

/** Shown for a player whose device hasn't sent a profile yet. */
export const NO_NAME = 'A player';

/** A random number in [0, 1) that nobody can predict, for friend codes. */
const secureRandom = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

/** `length` letters and digits from the join codes' alphabet. */
const randomCode = (length: number, random: () => number) =>
  Array.from({ length }, () => LOBBY_CODE_ALPHABET[Math.floor(random() * LOBBY_CODE_ALPHABET.length)]).join('');

export const newFriendCode = (random: () => number): string => randomCode(FRIEND_CODE_LENGTH, random);

/** The account's friend code, made the first time it's asked for. */
export async function friendCodeOf(db: D1Database, accountId: string, random = secureRandom): Promise<string> {
  for (let tries = 0; tries < 5; tries++) {
    const row = await db.prepare('SELECT friend_code FROM accounts WHERE id = ?1').bind(accountId)
      .first<{ friend_code: string | null }>();
    if (!row) throw new Error(`No account ${accountId}`);
    if (row.friend_code) return row.friend_code;
    const code = newFriendCode(random);
    const taken = await db.prepare('SELECT 1 FROM accounts WHERE friend_code = ?1').bind(code).first();
    if (!taken) await db.prepare('UPDATE accounts SET friend_code = ?2 WHERE id = ?1 AND friend_code IS NULL').bind(accountId, code).run();
  }
  throw new Error('Could not make a friend code');
}

export const newInviteKey = (random: () => number): string => randomCode(INVITE_KEY_LENGTH, random);

/**
 * The account's private invite key, made the first time it's asked for, or
 * a new one with `reset`. A first key is only written where there's none
 * yet, then read back, so two requests at once agree on one key; once made,
 * it's only read.
 */
export async function inviteKeyOf(db: D1Database, accountId: string, reset = false, random = secureRandom): Promise<string> {
  if (!reset) {
    const row = await db.prepare('SELECT invite_key FROM accounts WHERE id = ?1').bind(accountId)
      .first<{ invite_key: string | null }>();
    if (!row) throw new Error(`No account ${accountId}`);
    if (row.invite_key) return row.invite_key;
  }
  // 80 random bits: two accounts drawing the same key is all but impossible, and the unique index would refuse it.
  const key = newInviteKey(random);
  if (reset) {
    await db.prepare('UPDATE accounts SET invite_key = ?2 WHERE id = ?1').bind(accountId, key).run();
    return key;
  }
  await db.prepare('UPDATE accounts SET invite_key = ?2 WHERE id = ?1 AND invite_key IS NULL').bind(accountId, key).run();
  const row = await db.prepare('SELECT invite_key FROM accounts WHERE id = ?1').bind(accountId)
    .first<{ invite_key: string | null }>();
  if (!row?.invite_key) throw new Error(`No account ${accountId}`);
  return row.invite_key;
}

export const nameOrDefault = async (db: D1Database, accountId: string) => (await syncedName(db, accountId)) ?? NO_NAME;

/** The account with this friend code, if any. */
async function accountByCode(db: D1Database, code: string): Promise<string | null> {
  const row = await db.prepare('SELECT id FROM accounts WHERE friend_code = ?1').bind(code).first<{ id: string }>();
  return row?.id ?? null;
}

/** A friend of `accountId`'s, by their friend code: their account's ID and name, or null if they aren't one. */
export async function friendByCode(db: D1Database, accountId: string, code: string): Promise<{ id: string; name: string } | null> {
  const row = await db.prepare(
    `SELECT a.id FROM friends f JOIN accounts a ON a.id = f.friend_id
     WHERE f.account_id = ?1 AND a.friend_code = ?2 AND f.state = 'friends'`,
  ).bind(accountId, code).first<{ id: string }>();
  return row ? { id: row.id, name: await nameOrDefault(db, row.id) } : null;
}

/** Sends notifications, if this server sends them. A failure never undoes what they're about. */
export async function sendNotices(env: Env, notices: readonly Notice[], now: number, fetchFn: typeof fetch = fetch): Promise<void> {
  const keys = vapidKeysOf(env);
  if (!keys) return;
  await Promise.all(notices.map(({ guestId, message }) =>
    notifyGuest(env.DB, keys, guestId, message, now, fetchFn).catch(() => {})));
}

/**
 * Lobby invites still worth showing: a day old at most, for a lobby still
 * open that you haven't joined. The rest are cleared out on the way.
 */
async function openLobbyInvites(env: Env, accountId: string, now: number): Promise<LobbyInvite[]> {
  await env.DB.prepare('DELETE FROM lobby_invites WHERE created_at < ?1').bind(now - OPEN_LOBBY_MS).run();
  const { results } = await env.DB.prepare(
    'SELECT code, from_name, created_at FROM lobby_invites WHERE account_id = ?1 ORDER BY created_at DESC',
  ).bind(accountId).all<{ code: string; from_name: string; created_at: number }>();
  const invites = await Promise.all(results.map(async (r): Promise<LobbyInvite | null> => {
    const response = await toLobby(env, r.code, { action: 'get', playerId: accountId });
    const answer = response.ok ? parseLobbyAnswer(await response.json()) : null;
    if (answer && answer.lobby.state === 'open' && !answer.lobby.joined) return { code: r.code, fromName: r.from_name, at: r.created_at };
    await env.DB.prepare('DELETE FROM lobby_invites WHERE account_id = ?1 AND code = ?2').bind(accountId, r.code).run();
    return null;
  }));
  return invites.filter((i): i is LobbyInvite => i !== null);
}

export async function listFriends(env: Env, accountId: string, now: number): Promise<FriendsList> {
  const db = env.DB;
  const { results } = await db.prepare(
    `SELECT f.friend_id, f.state, f.since, a.friend_code FROM friends f JOIN accounts a ON a.id = f.friend_id
     WHERE f.account_id = ?1 ORDER BY f.since DESC`,
  ).bind(accountId).all<{ friend_id: string; state: string; since: number; friend_code: string }>();
  const list: FriendsList = {
    code: await friendCodeOf(db, accountId), invite: await inviteKeyOf(db, accountId), friends: [], received: [], sent: [], lobbyInvites: [],
  };
  for (const row of results) {
    const friend: Friend = { code: row.friend_code, name: await nameOrDefault(db, row.friend_id), since: row.since };
    if (row.state === 'friends') list.friends.push(friend);
    else if (row.state === 'received') list.received.push(friend);
    else list.sent.push(friend);
  }
  list.friends.sort((a, b) => a.name.localeCompare(b.name));
  list.lobbyInvites = await openLobbyInvites(env, accountId, now);
  return list;
}

type Added = { ok: true; notices: Notice[] } | { ok: false; status: number; error: string };
type Accepted = { ok: true; notices: Notice[]; code: string } | { ok: false; status: number; error: string };

/**
 * Adds the player with `code`: a request they must accept, or, if they've
 * already sent you one, accepting it. Adding someone twice changes nothing.
 */
export async function addFriend(db: D1Database, accountId: string, code: string, now: number): Promise<Added> {
  const friendId = await accountByCode(db, code);
  if (!friendId) return { ok: false, status: 404, error: 'not-found' };
  if (friendId === accountId) return { ok: false, status: 400, error: 'own-code' };
  const existing = await db.prepare('SELECT state FROM friends WHERE account_id = ?1 AND friend_id = ?2')
    .bind(accountId, friendId).first<{ state: string }>();
  if (existing?.state === 'friends' || existing?.state === 'sent') return { ok: true, notices: [] };
  const name = await nameOrDefault(db, accountId);
  if (existing?.state === 'received') {
    await db.prepare(`UPDATE friends SET state = 'friends', since = ?3
      WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)`).bind(accountId, friendId, now).run();
    return { ok: true, notices: [friendAcceptedNotice(friendId, name)] };
  }
  for (const id of [accountId, friendId]) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE account_id = ?1').bind(id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_FRIENDS) return { ok: false, status: 409, error: 'too-many-friends' };
  }
  await db.prepare(`INSERT INTO friends (account_id, friend_id, state, since) VALUES (?1, ?2, 'sent', ?3)`)
    .bind(accountId, friendId, now).run();
  await db.prepare(`INSERT INTO friends (account_id, friend_id, state, since) VALUES (?2, ?1, 'received', ?3)`)
    .bind(accountId, friendId, now).run();
  return { ok: true, notices: [friendRequestNotice(friendId, name)] };
}

/**
 * Opens a friend's private invite link: you're friends at once, whatever
 * requests either of you had sent, and they're told. Opening it again, or
 * one from a friend, changes nothing.
 */
export async function acceptInvite(db: D1Database, accountId: string, key: string, now: number): Promise<Accepted> {
  const row = await db.prepare('SELECT id, friend_code FROM accounts WHERE invite_key = ?1').bind(key)
    .first<{ id: string; friend_code: string | null }>();
  if (!row) return { ok: false, status: 404, error: 'not-found' };
  const friendId = row.id;
  // The owner has opened their list (that's where the link came from), so they have a code.
  const code = row.friend_code ?? await friendCodeOf(db, friendId);
  if (friendId === accountId) return { ok: false, status: 400, error: 'own-code' };
  const existing = await db.prepare('SELECT state FROM friends WHERE account_id = ?1 AND friend_id = ?2')
    .bind(accountId, friendId).first<{ state: string }>();
  if (existing?.state === 'friends') return { ok: true, notices: [], code };
  // A pending request already counts against both lists.
  if (!existing) {
    for (const id of [accountId, friendId]) {
      const count = await db.prepare('SELECT COUNT(*) AS n FROM friends WHERE account_id = ?1').bind(id).first<{ n: number }>();
      if ((count?.n ?? 0) >= MAX_FRIENDS) return { ok: false, status: 409, error: 'too-many-friends' };
    }
  }
  await db.batch([
    db.prepare('DELETE FROM friends WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)')
      .bind(accountId, friendId),
    db.prepare(`INSERT INTO friends (account_id, friend_id, state, since) VALUES (?1, ?2, 'friends', ?3), (?2, ?1, 'friends', ?3)`)
      .bind(accountId, friendId, now),
  ]);
  return { ok: true, notices: [friendAcceptedNotice(friendId, await nameOrDefault(db, accountId))], code };
}

/**
 * Removes a friend, declines their request or withdraws yours: either way,
 * both sides forget it. Removing a friend also renews your invite link, so
 * one they still have can't make them your friend again.
 */
async function removeFriend(db: D1Database, accountId: string, code: string): Promise<void> {
  const friendId = await accountByCode(db, code);
  if (!friendId) return;
  const row = await db.prepare('SELECT state FROM friends WHERE account_id = ?1 AND friend_id = ?2')
    .bind(accountId, friendId).first<{ state: string }>();
  if (row?.state === 'friends') await inviteKeyOf(db, accountId, true);
  await db.prepare('DELETE FROM friends WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)')
    .bind(accountId, friendId).run();
}

/** Routes `/api/friends…`, or returns null for any other path. */
export async function routeFriends(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch = fetch,
): Promise<Response | null> {
  if (pathname !== '/api/friends' && !pathname.startsWith('/api/friends/')) return null;
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  // Friends are accounts: a guest has no list.
  const accountId = who.player.accountId;
  if (!accountId) return errorResponse(401, 'signed-out');
  const method = request.method;
  if (pathname === '/api/friends') {
    return method === 'GET' ? json(await listFriends(env, accountId, now)) : errorResponse(405, 'bad-request');
  }
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  const body = await readJson(request);
  if (pathname === '/api/friends/invite/reset') {
    await inviteKeyOf(env.DB, accountId, true);
    return json(await listFriends(env, accountId, now));
  }
  if (pathname === '/api/friends/invite/peek') {
    // Who an invite link is from, so the app can ask before accepting it. Only their name.
    const key = isObject(body) ? body.invite : undefined;
    if (!isInviteKey(key)) return errorResponse(400, 'bad-request');
    const owner = await env.DB.prepare('SELECT id FROM accounts WHERE invite_key = ?1').bind(key).first<{ id: string }>();
    if (!owner) return errorResponse(404, 'not-found');
    if (owner.id === accountId) return errorResponse(400, 'own-code');
    return json({ name: await nameOrDefault(env.DB, owner.id) });
  }
  if (pathname === '/api/friends/invite/accept') {
    const key = isObject(body) ? body.invite : undefined;
    if (!isInviteKey(key)) return errorResponse(400, 'bad-request');
    const accepted = await acceptInvite(env.DB, accountId, key, now);
    if (!accepted.ok) return errorResponse(accepted.status, accepted.error);
    await sendNotices(env, accepted.notices, now, fetchFn);
    // Which friend the link was from: the app knows them only by the link's key.
    const list = await listFriends(env, accountId, now);
    return json({ ...list, accepted: list.friends.find((f) => f.code === accepted.code) ?? null });
  }
  const code = isObject(body) ? body.code : undefined;
  if (!isFriendCode(code)) return errorResponse(400, 'bad-request');
  if (pathname === '/api/friends/add') {
    const added = await addFriend(env.DB, accountId, code, now);
    if (!added.ok) return errorResponse(added.status, added.error);
    await sendNotices(env, added.notices, now, fetchFn);
  } else if (pathname === '/api/friends/remove') {
    await removeFriend(env.DB, accountId, code);
  } else {
    return errorResponse(404, 'not-found');
  }
  return json(await listFriends(env, accountId, now));
}
