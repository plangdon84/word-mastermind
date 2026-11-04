import { DAILY_MODES, dailyDay, isObject, LOBBY_CODE_ALPHABET, OPEN_LOBBY_MS } from '../../src/game';
import { isCountry } from '../../src/app/countries';
import {
  EMAIL_REQUESTS_PER_DAY, FRIEND_CODE_LENGTH, INVITE_KEY_LENGTH, isFriendCode, isInviteKey, MAX_FRIENDS, normalizeSearch,
  parseFriendGamesParams, SEARCH_MAX, type FoundPlayer, type FoundState, type Friend, type FriendProfile,
  type FriendProfileAnswer, type FriendsList, type LobbyInvite,
} from '../../src/app/friendsApi';
import type { LadderFriend } from '../../src/app/friendApi';
import { parseLobbyAnswer } from '../../src/app/lobbyApi';
import { identify, normalizeEmail, playerOfAccount } from './accounts';
import { pastPlacements } from './dailyRoutes';
import { listRatings } from './ratings';
import { friendGamesPage, sharedSummaryOf, versusOf } from './friendProfiles';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import { toLobby } from './lobbyRoutes';
import { friendAcceptedNotice, friendRequestNotice, type Notice } from './notices';
import { notifyGuest } from './push';
import { vapidKeysOf } from './pushRoutes';
import { checkedName, NO_NAME, shownName } from './names';
import { currentNames, syncedName } from './sync';
import { secureRandom } from './secure';

/*
 * Friends (README "Friends"): signed-in players add each other by friend
 * code, or find each other by email or name (Dev Plan item 18d). A request
 * becomes a friendship once the other player adds you back
 * (accepts). A private invite link (its key) makes friends at once. Friends can challenge each other to a game (`games.ts`) and
 * invite each other to a Rush with Friends lobby (`lobbyRoutes.ts`).
 */



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

/** A friend of `accountId`'s account ID, by their friend code, or null if they aren't one (a request not yet accepted isn't). */
async function friendIdByCode(db: D1Database, accountId: string, code: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT a.id FROM friends f JOIN accounts a ON a.id = f.friend_id
     WHERE f.account_id = ?1 AND a.friend_code = ?2 AND f.state = 'friends'`,
  ).bind(accountId, code).first<{ id: string }>();
  return row?.id ?? null;
}

/** A friend of `accountId`'s, by their friend code: their account's ID and name, or null if they aren't one. */
export async function friendByCode(db: D1Database, accountId: string, code: string): Promise<{ id: string; name: string } | null> {
  const id = await friendIdByCode(db, accountId, code);
  return id ? { id, name: await nameOrDefault(db, id) } : null;
}

/**
 * SQL for the friend code of the player in `column` (an account's ID, or a
 * guest ID linked to one) when they're a friend of the account `param`,
 * else NULL. A name alone can't say who's a friend: two players can share
 * one, and anyone can change theirs.
 */
export function friendCodeSql(column: string, param: string): string {
  return `(SELECT a.friend_code FROM friends f JOIN accounts a ON a.id = f.friend_id
    WHERE f.account_id = ${param} AND f.state = 'friends'
      AND f.friend_id = COALESCE((SELECT account_id FROM guests WHERE id = ${column}), ${column}))`;
}

/**
 * The friend codes of those of these player IDs who are friends of
 * `accountId` (null for a guest, who has none), by player ID. One query,
 * the IDs as one JSON parameter (D1 allows 100).
 */
export async function friendCodes(db: D1Database, accountId: string | null, ids: readonly string[]): Promise<Record<string, string>> {
  if (!accountId || ids.length === 0) return {};
  const { results } = await db.prepare(
    `SELECT ids.value AS id, ${friendCodeSql('ids.value', '?1')} AS code FROM json_each(?2) AS ids`,
  ).bind(accountId, JSON.stringify([...new Set(ids)])).all<{ id: string; code: string | null }>();
  const codes: Record<string, string> = {};
  for (const row of results) if (row.code) codes[row.id] = row.code;
  return codes;
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
    if (answer && answer.lobby.state === 'open' && !answer.lobby.joined) return { code: r.code, fromName: shownName(r.from_name), at: r.created_at };
    await env.DB.prepare('DELETE FROM lobby_invites WHERE account_id = ?1 AND code = ?2').bind(accountId, r.code).run();
    return null;
  }));
  return invites.filter((i): i is LobbyInvite => i !== null);
}

export async function listFriends(env: Env, accountId: string, now: number): Promise<FriendsList> {
  const db = env.DB;
  const { results } = await db.prepare(
    `SELECT f.friend_id, f.state, f.since, a.friend_code FROM friends f JOIN accounts a ON a.id = f.friend_id
     WHERE f.account_id = ?1 AND NOT (f.state = 'sent' AND f.by_email = 1) ORDER BY f.since DESC`,
  ).bind(accountId).all<{ friend_id: string; state: string; since: number; friend_code: string }>();
  // Every name in one query, not one each (up to MAX_FRIENDS), alongside the rest.
  const [code, invite, names, lobbyInvites] = await Promise.all([
    friendCodeOf(db, accountId), inviteKeyOf(db, accountId), currentNames(db, results.map((r) => r.friend_id)),
    openLobbyInvites(env, accountId, now),
  ]);
  const list: FriendsList = { code, invite, friends: [], received: [], sent: [], lobbyInvites };
  for (const row of results) {
    const friend: Friend = { code: row.friend_code, name: names[row.friend_id] ?? NO_NAME, since: row.since };
    if (row.state === 'friends') list.friends.push(friend);
    else if (row.state === 'received') list.received.push(friend);
    else list.sent.push(friend);
  }
  list.friends.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

export type Added = { ok: true; notices: Notice[] } | { ok: false; status: number; error: string };

/**
 * How many friends and requests count against `accountId`'s limit: a
 * request they sent by email, still off their list, doesn't, or filling a
 * list to the brim could tell whether an email has an account.
 */
const listSize = async (db: D1Database, accountId: string) => (await db.prepare(
  `SELECT COUNT(*) AS n FROM friends WHERE account_id = ?1 AND NOT (state = 'sent' AND by_email = 1)`,
).bind(accountId).first<{ n: number }>())?.n ?? 0;

/**
 * Forgets a request `accountId` sent `friendId` by email, still off their
 * list, before adding them another way, which then goes exactly as if it
 * never was (a new request, and its notification): how it goes, and how
 * long it takes, can't tell whose email it was. One statement either way.
 */
const forgetEmailRequest = (db: D1Database, accountId: string, friendId: string) => db.prepare(
  `DELETE FROM friends WHERE ((account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1))
     AND EXISTS (SELECT 1 FROM friends WHERE account_id = ?1 AND friend_id = ?2 AND state = 'sent' AND by_email = 1)`,
).bind(accountId, friendId).run();

/**
 * Where `accountId` stands with `friendId` as their list shows it: a
 * request they sent by email, even one made a moment ago by a request
 * still under way, is none, so adding them goes as if it weren't there.
 */
const visibleState = (db: D1Database, accountId: string, friendId: string) => db.prepare(
  `SELECT state FROM friends WHERE account_id = ?1 AND friend_id = ?2 AND NOT (state = 'sent' AND by_email = 1)`,
).bind(accountId, friendId).first<{ state: string }>();
type Accepted = { ok: true; notices: Notice[]; code: string } | { ok: false; status: number; error: string };

/**
 * Adds the player with `code`: a request they must accept, or, if they've
 * already sent you one, accepting it. Adding someone twice changes nothing.
 */
export async function addFriend(db: D1Database, accountId: string, code: string, now: number): Promise<Added> {
  const friendId = await accountByCode(db, code);
  if (!friendId) return { ok: false, status: 404, error: 'not-found' };
  return addFriendById(db, accountId, friendId, now);
}

/** `addFriend` for the account `friendId`, however the app knows them. */
async function addFriendById(db: D1Database, accountId: string, friendId: string, now: number): Promise<Added> {
  if (friendId === accountId) return { ok: false, status: 400, error: 'own-code' };
  await forgetEmailRequest(db, accountId, friendId);
  const existing = await visibleState(db, accountId, friendId);
  if (existing?.state === 'friends' || existing?.state === 'sent') return { ok: true, notices: [] };
  const name = await nameOrDefault(db, accountId);
  if (existing?.state === 'received') {
    await db.prepare(`UPDATE friends SET state = 'friends', since = ?3
      WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)`).bind(accountId, friendId, now).run();
    return { ok: true, notices: [friendAcceptedNotice(friendId, name)] };
  }
  for (const id of [accountId, friendId]) {
    if (await listSize(db, id) >= MAX_FRIENDS) return { ok: false, status: 409, error: 'too-many-friends' };
  }
  // One statement that also takes the place of a request by email made meanwhile, so that overlap ends as this request alone.
  await db.prepare(
    `INSERT INTO friends (account_id, friend_id, state, since, by_email) VALUES (?1, ?2, 'sent', ?3, 0), (?2, ?1, 'received', ?3, 0)
     ON CONFLICT (account_id, friend_id) DO UPDATE SET state = excluded.state, since = excluded.since, by_email = 0
     WHERE friends.by_email = 1`,
  ).bind(accountId, friendId, now).run();
  return { ok: true, notices: [friendRequestNotice(friendId, name)] };
}

/**
 * SQL for the account of the player `param`: an account's ID as it is, a
 * guest ID linked to an account as that account's.
 */
const accountOfSql = (param: string) => `COALESCE((SELECT account_id FROM guests WHERE id = ${param}), ${param})`;

/**
 * Where `accountId` stands with the player `playerId` (an account's ID, or
 * a guest ID linked to one) as their friends list shows it (Dev Plan item
 * 19e): a request they sent by email, still off their list, is none, as in
 * a search, so a game can't tell them whose email it was. With nothing
 * between them, `declined` if that player declined a request of theirs in
 * the past week (`FRIEND_DECLINE_MS`): the game offers no Add friend.
 */
export async function friendStateOf(db: D1Database, accountId: string, playerId: string, now: number): Promise<LadderFriend> {
  const row = await db.prepare(
    `SELECT (SELECT state FROM friends WHERE account_id = ?1 AND friend_id = ${accountOfSql('?2')}
         AND NOT (state = 'sent' AND by_email = 1)) AS state,
       EXISTS (SELECT 1 FROM friend_declines WHERE sender_id = ?1 AND declined_by = ${accountOfSql('?2')} AND at > ?3) AS declined`,
  ).bind(accountId, playerId, now - FRIEND_DECLINE_MS).first<{ state: string | null; declined: number }>();
  const state = row?.state;
  if (state === 'friends' || state === 'sent' || state === 'received') return state;
  return row?.declined ? 'declined' : 'none';
}

/**
 * A friend request from a finished rated ladder game (Dev Plan item 19e)
 * to the other person in it, `playerId`: as adding them by code would
 * (or accepting theirs), so it's theirs to accept or decline. They may
 * never have opened their friends list, so each side's code is made first:
 * the request shows on each list by the other's code.
 */
export async function addLadderOpponent(db: D1Database, accountId: string, playerId: string, now: number): Promise<Added> {
  const row = await db.prepare(`SELECT id FROM accounts WHERE id = ${accountOfSql('?1')}`).bind(playerId).first<{ id: string }>();
  if (!row) return { ok: false, status: 404, error: 'not-found' };
  // Accepting their request still works; a new one waits out a week after they declined one (`FRIEND_DECLINE_MS`).
  if (await friendStateOf(db, accountId, row.id, now) === 'declined') return { ok: false, status: 409, error: 'declined' };
  await Promise.all([friendCodeOf(db, accountId), friendCodeOf(db, row.id)]);
  return addFriendById(db, accountId, row.id, now);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a declined request by email keeps the sender's repeats by email
 * to that player away (Dev Plan item 19a): ignored silently, still counted
 * towards the sender's daily limit, so nothing tells them it was declined.
 */
export const EMAIL_DECLINE_MS = 7 * DAY_MS;

/**
 * Deletes the declines whose week is over, so none is kept long after
 * (the privacy page's "deleted soon after"): run on each decline and by
 * the worker's scheduled job (Dev Plan item 19n, `cleanUp` in `index.ts`).
 */
export const forgetOldDeclines = (db: D1Database, now: number) => [
  db.prepare('DELETE FROM email_declines WHERE at <= ?1').bind(now - EMAIL_DECLINE_MS),
  db.prepare('DELETE FROM friend_declines WHERE at <= ?1').bind(now - FRIEND_DECLINE_MS),
];

/**
 * How long a declined request, however it came, keeps the ladder's Add
 * friend from its sender to that player (Dev Plan item 19e, the owner on
 * PR #75): the games stop offering it, so a stranger met on the ladder
 * can't send a request, and its alert, again and again.
 */
export const FRIEND_DECLINE_MS = 7 * DAY_MS;

/**
 * A friend request to whoever has an account with `email` (Dev Plan item
 * 18d), first counted against the sender's limits: whether anyone has
 * that email must never show, so every refusal is here, before the email
 * is looked up, and depends only on the sender. The rest is
 * `deliverEmailRequest`, run after answering where the server allows. Each
 * try counts, found or not, in one statement, so tries at once can't pass
 * the daily limit together.
 */
export async function countEmailRequest(
  db: D1Database, accountId: string, email: string, now: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const own = await db.prepare('SELECT email FROM accounts WHERE id = ?1').bind(accountId).first<{ email: string }>();
  if (own?.email === email) return { ok: false, status: 400, error: 'own-email' };
  if (await listSize(db, accountId) >= MAX_FRIENDS) return { ok: false, status: 409, error: 'too-many-friends' };
  await db.prepare('DELETE FROM email_requests WHERE account_id = ?1 AND at <= ?2').bind(accountId, now - DAY_MS).run();
  const { meta } = await db.prepare(
    `INSERT INTO email_requests (account_id, at) SELECT ?1, ?2
     WHERE (SELECT COUNT(*) FROM email_requests WHERE account_id = ?1) < ${EMAIL_REQUESTS_PER_DAY}`,
  ).bind(accountId, now).run();
  if (!meta.changes) return { ok: false, status: 429, error: 'too-many-emails' };
  // Your request shows on their list by your code, so you need one, even if you've never opened your own list.
  await friendCodeOf(db, accountId);
  return { ok: true };
}

/**
 * Sends a request counted by `countEmailRequest`, if anyone has `email`,
 * returning its notification. None goes to someone already a friend,
 * already asked either way, or whose list is full. The request stays off
 * the sender's list until it's accepted, and nothing is emailed or kept
 * for an email with no account.
 */
export async function deliverEmailRequest(db: D1Database, accountId: string, email: string, now: number): Promise<Notice[]> {
  const found = await db.prepare('SELECT id FROM accounts WHERE email = ?1').bind(email).first<{ id: string }>();
  const friendId = found?.id;
  if (!friendId || friendId === accountId) return [];
  // One read: where they stand, and whether this player declined a request by email from the sender in the past week.
  const existing = await db.prepare(
    `SELECT (SELECT state FROM friends WHERE account_id = ?1 AND friend_id = ?2) AS state,
       EXISTS (SELECT 1 FROM email_declines WHERE sender_id = ?1 AND declined_by = ?2 AND at > ?3) AS declined`,
  ).bind(accountId, friendId, now - EMAIL_DECLINE_MS).first<{ state: string | null; declined: number }>();
  if (existing?.state || existing?.declined || await listSize(db, friendId) >= MAX_FRIENDS) return [];
  await db.prepare(`INSERT INTO friends (account_id, friend_id, state, since, by_email) VALUES (?1, ?2, 'sent', ?3, 1), (?2, ?1, 'received', ?3, 1)`)
    .bind(accountId, friendId, now).run();
  return [friendRequestNotice(friendId, await nameOrDefault(db, accountId))];
}

/**
 * Players whose name has `search` in it (Dev Plan item 18d), for
 * `accountId` to send a request to: the best SEARCH_MAX, a name that is the
 * search first, then one that starts with it. Only names a player set
 * (never a made-up guest name), only those who haven't turned off
 * "Let players find me by name" (`findByName` in their synced settings),
 * never you, and never a name the profanity filter now refuses. A request
 * you sent by email shows as none, so a search can't tell you whose email
 * it was.
 */
export async function searchPlayers(db: D1Database, accountId: string, search: string): Promise<FoundPlayer[]> {
  const find = () => db.prepare(
    `SELECT a.id, a.friend_code AS code, p.name, p.country,
       (SELECT f.state FROM friends f WHERE f.account_id = ?1 AND f.friend_id = a.id
         AND NOT (f.state = 'sent' AND f.by_email = 1)) AS state
     FROM profiles p JOIN accounts a ON a.id = p.account_id
     WHERE p.name IS NOT NULL AND a.id <> ?1 AND COALESCE(json_extract(p.settings, '$.findByName'), 1) <> 0
       AND instr(lower(p.name), lower(?2)) > 0
     ORDER BY lower(p.name) = lower(?2) DESC, instr(lower(p.name), lower(?2)) = 1 DESC, lower(p.name), a.id
     LIMIT ${SEARCH_MAX}`,
  ).bind(accountId, search).all<{ id: string; code: string | null; name: string; country: string | null; state: string | null }>();
  let { results } = await find();
  // A player who never opened their friends list has no code yet: make theirs, in one go, then look again.
  const codeless = results.filter((r) => r.code === null);
  if (codeless.length > 0) {
    try {
      await db.batch(codeless.map((r) => db.prepare('UPDATE accounts SET friend_code = ?2 WHERE id = ?1 AND friend_code IS NULL')
        .bind(r.id, newFriendCode(secureRandom))));
    } catch {
      // A new code that's already someone's (all but impossible): those players are left out of this search, not the rest.
    }
    ({ results } = await find());
  }
  return results.flatMap((r): FoundPlayer[] => {
    const shown = checkedName(r.name);
    if (!r.code || shown === null) return [];
    const state: FoundState = (['friends', 'sent', 'received'] as const).find((s) => s === r.state) ?? null;
    return [{ code: r.code, name: shown, country: isCountry(r.country) ? r.country : null, state }];
  });
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
  await forgetEmailRequest(db, accountId, friendId);
  const existing = await visibleState(db, accountId, friendId);
  if (existing?.state === 'friends') return { ok: true, notices: [], code };
  // A pending request already counts against both lists (one you sent by email, which doesn't, was forgotten above).
  if (!existing) {
    for (const id of [accountId, friendId]) {
      if (await listSize(db, id) >= MAX_FRIENDS) return { ok: false, status: 409, error: 'too-many-friends' };
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
 * one they still have can't make them your friend again. Declining a
 * request that came by email remembers the sender for a week
 * (`EMAIL_DECLINE_MS`), and declining any request does for the ladder's
 * Add friend (`FRIEND_DECLINE_MS`), clearing older declines as it goes.
 */
async function removeFriend(db: D1Database, accountId: string, code: string, now: number): Promise<void> {
  const friendId = await accountByCode(db, code);
  if (!friendId) return;
  const row = await db.prepare('SELECT state, by_email FROM friends WHERE account_id = ?1 AND friend_id = ?2')
    .bind(accountId, friendId).first<{ state: string; by_email: number }>();
  if (row?.state === 'friends') await inviteKeyOf(db, accountId, true);
  const forget = db.prepare('DELETE FROM friends WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)')
    .bind(accountId, friendId);
  if (row?.state !== 'received') {
    await forget.run();
    return;
  }
  const remember = (table: 'email_declines' | 'friend_declines') => db.prepare(
    `INSERT INTO ${table} (sender_id, declined_by, at) VALUES (?1, ?2, ?3)
     ON CONFLICT (sender_id, declined_by) DO UPDATE SET at = excluded.at`,
  ).bind(friendId, accountId, now);
  await db.batch([
    forget,
    ...forgetOldDeclines(db, now),
    remember('friend_declines'),
    ...(row.by_email ? [remember('email_declines')] : []),
  ]);
}

/**
 * A friend's profile (Dev Plan item 18c, README "Friends' profiles"): their
 * name, country and Daily Set and Daily Word places; their games, stats and badges are
 * `friendProfiles.ts`'s. Only what any player may see of them: never their
 * settings, email, friends list or an ID.
 */
async function friendProfile(db: D1Database, friendId: string, now: number): Promise<FriendProfile> {
  const [row, player, name] = await Promise.all([
    db.prepare('SELECT country, member_since FROM profiles WHERE account_id = ?1').bind(friendId)
      .first<{ country: string | null; member_since: number }>(),
    playerOfAccount(db, friendId),
    nameOrDefault(db, friendId),
  ]);
  return {
    name,
    country: isCountry(row?.country) ? row.country : null,
    memberSince: row?.member_since ?? null,
    // The Daily Word's places come last, so an older app, which takes a day's first, shows the Daily Set's.
    placements: (await Promise.all(DAILY_MODES.map((mode) => pastPlacements(db, player, dailyDay(now), mode)))).flat(),
  };
}

/** Routes `/api/friends…`, or returns null for any other path. */
export async function routeFriends(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch = fetch,
  /** Runs work after the answer is sent (the worker's `waitUntil`); without it, the work is awaited first. */
  defer?: (work: Promise<unknown>) => void,
): Promise<Response | null> {
  if (pathname !== '/api/friends' && !pathname.startsWith('/api/friends/')) return null;
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  // Friends are accounts: a guest has no list.
  const accountId = who.player.accountId;
  if (!accountId) return errorResponse(401, 'signed-out');
  const method = request.method;
  /**
   * Notifications go out after answering where the server allows (else
   * first), so how long an answer takes never says whether one went: a
   * friend request by email, or adding someone you'd emailed.
   */
  const afterAnswering = async (work: Promise<Notice[]>) => {
    const sending = work.then((notices) => sendNotices(env, notices, now, fetchFn)).catch(() => {});
    if (defer) defer(sending);
    else await sending;
  };
  if (pathname === '/api/friends') {
    return method === 'GET' ? json(await listFriends(env, accountId, now)) : errorResponse(405, 'bad-request');
  }
  if (pathname === '/api/friends/profile' || pathname === '/api/friends/profile/games') {
    if (method !== 'GET') return errorResponse(405, 'bad-request');
    const params = new URL(request.url).searchParams;
    const code = params.get('code');
    const query = pathname === '/api/friends/profile/games' ? parseFriendGamesParams(params) : null;
    if (!isFriendCode(code) || (pathname === '/api/friends/profile/games' && !query)) return errorResponse(400, 'bad-request');
    // Only a friend's: anyone else's code, or a request not yet accepted, is no different from no such player.
    const friendId = await friendIdByCode(env.DB, accountId, code);
    if (!friendId) return errorResponse(404, 'not-found');
    if (query) return json(await friendGamesPage(env.DB, friendId, query, now));
    // Their ratings too, provisional or not (Dev Plan item 19t): friends see what the boards leave out.
    const [profile, summary, versus, ratings] = await Promise.all([
      friendProfile(env.DB, friendId, now), sharedSummaryOf(env.DB, friendId), versusOf(env.DB, accountId, friendId),
      listRatings(env.DB, friendId, now),
    ]);
    const answer: FriendProfileAnswer = { profile, summary, versus, ratings };
    return json(answer);
  }
  if (pathname === '/api/friends/search') {
    if (method !== 'GET') return errorResponse(405, 'bad-request');
    const search = normalizeSearch(new URL(request.url).searchParams.get('name') ?? '');
    if (!search) return errorResponse(400, 'bad-request');
    return json({ players: await searchPlayers(env.DB, accountId, search) });
  }
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  const body = await readJson(request);
  if (pathname === '/api/friends/email') {
    const email = normalizeEmail(isObject(body) ? body.email : undefined);
    if (!email) return errorResponse(400, 'bad-email');
    const counted = await countEmailRequest(env.DB, accountId, email, now);
    if (!counted.ok) return errorResponse(counted.status, counted.error);
    // Looking the email up, too, comes after answering, so the answer takes as long whoever it is.
    await afterAnswering(deliverEmailRequest(env.DB, accountId, email, now));
    return json({ ok: true });
  }
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
    await afterAnswering(Promise.resolve(accepted.notices));
    // Which friend the link was from: the app knows them only by the link's key.
    const list = await listFriends(env, accountId, now);
    return json({ ...list, accepted: list.friends.find((f) => f.code === accepted.code) ?? null });
  }
  const code = isObject(body) ? body.code : undefined;
  if (!isFriendCode(code)) return errorResponse(400, 'bad-request');
  if (pathname === '/api/friends/add') {
    const added = await addFriend(env.DB, accountId, code, now);
    if (!added.ok) return errorResponse(added.status, added.error);
    await afterAnswering(Promise.resolve(added.notices));
  } else if (pathname === '/api/friends/remove') {
    await removeFriend(env.DB, accountId, code, now);
  } else {
    return errorResponse(404, 'not-found');
  }
  return json(await listFriends(env, accountId, now));
}
