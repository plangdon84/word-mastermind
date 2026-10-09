import { isGuestId } from './guests';
import { toBase64Url } from './push';
import { deleteRatings } from './ratings';

/*
 * Accounts (README "Accounts"): signing in with an email link or Google, and
 * the sessions that keep a device signed in. Both ways of signing in end the
 * same way: a one-use sign-in link (`login_links`) that the app trades for a
 * session. An account upgrades a guest in place: a new account's ID is the
 * guest ID of the device that made it, and every device that signs in links
 * its guest ID to the account. Nothing here reads the clock: the time is
 * passed in.
 */

/** How long an emailed sign-in link works for. */
export const LOGIN_LINK_MS = 15 * 60 * 1000;
/** A session ends after this long without being used. */
export const SESSION_MS = 180 * 24 * 60 * 60 * 1000;
/** How often a session in use pushes its end back (one write a day, not one a request). */
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
/** Most sign-in emails an address gets in an hour, and the least time between two. */
export const EMAILS_PER_HOUR = 5;
export const EMAIL_GAP_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** What the app is told about an account. */
export interface Account {
  id: string;
  email: string;
  /** They've signed in with Google. */
  google: boolean;
  createdAt: number;
}

interface AccountRow {
  id: string;
  email: string;
  google_sub: string | null;
  created_at: number;
}

const toAccount = (row: AccountRow): Account =>
  ({ id: row.id, email: row.email, google: row.google_sub !== null, createdAt: row.created_at });

/** A secret nobody can guess: 32 random bytes, base64url. */
export const newToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** Tokens are stored as their SHA-256 (hex), so a leaked table signs nobody in. */
export async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A token as `newToken` makes them; anything else can't be one, so it isn't looked up. */
export const isToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

/** An email address, trimmed and lowercased, or null if it can't be one. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * May `email` be sent another sign-in link now? At most `EMAILS_PER_HOUR`
 * an hour, a minute apart, so the form can't be used to flood an inbox.
 */
export async function mayEmail(db: D1Database, email: string, now: number): Promise<boolean> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS sent, MAX(created_at) AS latest FROM login_links
     WHERE email = ?1 AND google_sub IS NULL AND created_at > ?2`,
  ).bind(email, now - HOUR_MS).first<{ sent: number; latest: number | null }>();
  if (!row) return true;
  return row.sent < EMAILS_PER_HOUR && (row.latest === null || now - row.latest >= EMAIL_GAP_MS);
}

/**
 * Makes a one-use sign-in link for `email` (and, from Google, the person's
 * Google ID) and returns its token. With `guestId` (Google's, from the
 * device that started it), only that device can use it. Old links are
 * cleared out on the way.
 */
export async function createLoginLink(
  db: D1Database, email: string, googleSub: string | null, now: number, guestId: string | null = null,
): Promise<string> {
  await db.prepare('DELETE FROM login_links WHERE expires_at < ?1').bind(now - 24 * HOUR_MS).run();
  const token = newToken();
  await db.prepare(
    `INSERT INTO login_links (token_hash, email, google_sub, guest_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(await hashToken(token), email, googleSub, guestId, now, now + LOGIN_LINK_MS).run();
  return token;
}

export async function findAccount(db: D1Database, id: string): Promise<Account | null> {
  const row = await db.prepare('SELECT id, email, google_sub, created_at FROM accounts WHERE id = ?1')
    .bind(id).first<AccountRow>();
  return row && toAccount(row);
}

/** The ID of the account a sign-in link would sign in to, if it exists yet. */
async function existingAccountId(db: D1Database, email: string, googleSub: string | null): Promise<string | null> {
  const byGoogle = googleSub
    ? await db.prepare('SELECT id FROM accounts WHERE google_sub = ?1').bind(googleSub).first<{ id: string }>() : null;
  const row = byGoogle ?? await db.prepare('SELECT id FROM accounts WHERE email = ?1').bind(email).first<{ id: string }>();
  return row?.id ?? null;
}

/** Finds the account for this email (or Google ID), making it if there's none. */
async function accountFor(db: D1Database, email: string, googleSub: string | null, guestId: string, now: number): Promise<AccountRow> {
  const select = 'SELECT id, email, google_sub, created_at FROM accounts';
  let row = googleSub ? await db.prepare(`${select} WHERE google_sub = ?1`).bind(googleSub).first<AccountRow>() : null;
  row ??= await db.prepare(`${select} WHERE email = ?1`).bind(email).first<AccountRow>();
  if (row) {
    // Someone who signed in by email now uses Google with the same address: one account.
    if (googleSub && row.google_sub === null) {
      await db.prepare('UPDATE accounts SET google_sub = ?2 WHERE id = ?1').bind(row.id, googleSub).run();
      row = { ...row, google_sub: googleSub };
    }
    return row;
  }
  // A new account upgrades this device's guest in place, unless that guest is already someone's.
  const guest = await db.prepare('SELECT account_id FROM guests WHERE id = ?1').bind(guestId).first<{ account_id: string | null }>();
  const id = guest?.account_id ? crypto.randomUUID() : guestId;
  await db.prepare('INSERT INTO accounts (id, email, google_sub, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(id, email, googleSub, now).run();
  await db.prepare(
    `INSERT INTO guests (id, created_at, last_seen_at, account_id) VALUES (?1, ?2, ?2, ?1)
     ON CONFLICT (id) DO UPDATE SET account_id = excluded.account_id`,
  ).bind(id, now).run();
  return { id, email, google_sub: googleSub, created_at: now };
}

/** Who a sign-in link is for, before it's used: its email, and whether it came by email (not from Google). */
export interface LinkInfo {
  email: string;
  emailed: boolean;
}

/**
 * Who a sign-in link would sign the device whose guest ID is `guestId` in
 * as, without using it, or null if `signIn` would refuse it as `bad-login`.
 * The app asks "Sign in as …?" before using an emailed link, since one
 * someone made for their own account and sent you would otherwise sign your
 * device in to theirs unnoticed (a Google one already belongs to the device
 * that started it).
 */
export async function peekLoginLink(db: D1Database, loginToken: string, guestId: string, now: number): Promise<LinkInfo | null> {
  const link = await usableLink(db, await hashToken(loginToken), guestId, now);
  return link && { email: link.email, emailed: link.google_sub === null && link.guest_id === null };
}

/** A sign-in link this device may use now: unused, unexpired, and not another device's. */
function usableLink(db: D1Database, tokenHash: string, guestId: string, now: number) {
  return db.prepare(
    `SELECT email, google_sub, guest_id FROM login_links WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2
       AND (guest_id IS NULL OR guest_id = ?3)`,
  ).bind(tokenHash, now, guestId).first<{ email: string; google_sub: string | null; guest_id: string | null }>();
}

export type SignedIn = { ok: true; token: string; account: Account } | { ok: false; status: number; error: string };

/**
 * Trades a sign-in link's token for a session on the device whose guest ID
 * is `guestId`, which joins the account. Refused (`bad-login`) if the link
 * is unknown, used, expired or another device's (a Google sign-in belongs to
 * the device that started it); and (`sign-in-needed`, the link left unused)
 * if this guest ID is already another account's, whose turn alerts the
 * session would otherwise reach: the app signs in as a new guest instead.
 */
export async function signIn(db: D1Database, loginToken: string, guestId: string, now: number): Promise<SignedIn> {
  const tokenHash = await hashToken(loginToken);
  const pending = await usableLink(db, tokenHash, guestId, now);
  if (!pending) return { ok: false, status: 400, error: 'bad-login' };
  const guest = await db.prepare('SELECT account_id FROM guests WHERE id = ?1').bind(guestId).first<{ account_id: string | null }>();
  if (guest?.account_id && guest.account_id !== await existingAccountId(db, pending.email, pending.google_sub)) {
    return { ok: false, status: 409, error: 'sign-in-needed' };
  }
  const link = await db.prepare(
    `UPDATE login_links SET used_at = ?2 WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2
     RETURNING email, google_sub`,
  ).bind(tokenHash, now).first<{ email: string; google_sub: string | null }>();
  if (!link) return { ok: false, status: 400, error: 'bad-login' };
  const account = await accountFor(db, link.email, link.google_sub, guestId, now);
  await db.prepare(
    `INSERT INTO guests (id, created_at, last_seen_at, account_id) VALUES (?1, ?2, ?2, ?3)
     ON CONFLICT (id) DO UPDATE SET account_id = COALESCE(guests.account_id, excluded.account_id),
       last_seen_at = excluded.last_seen_at`,
  ).bind(guestId, now, account.id).run();
  const token = newToken();
  await db.prepare(
    `INSERT INTO sessions (token_hash, account_id, guest_id, created_at, last_seen_at, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
  ).bind(await hashToken(token), account.id, guestId, now, now + SESSION_MS).run();
  return { ok: true, token, account: toAccount(account) };
}

export interface Session {
  accountId: string;
  /** The guest ID of the device that signed in. */
  guestId: string;
}

/** The session a token belongs to, if it hasn't ended; using it keeps it going. */
export async function findSession(db: D1Database, token: string, now: number): Promise<Session | null> {
  const hash = await hashToken(token);
  const row = await db.prepare(
    'SELECT account_id, guest_id, last_seen_at FROM sessions WHERE token_hash = ?1 AND expires_at > ?2',
  ).bind(hash, now).first<{ account_id: string; guest_id: string; last_seen_at: number }>();
  if (!row) return null;
  if (now - row.last_seen_at >= SESSION_REFRESH_MS) {
    await db.prepare('UPDATE sessions SET last_seen_at = ?2, expires_at = ?3 WHERE token_hash = ?1')
      .bind(hash, now, now + SESSION_MS).run();
  }
  return { accountId: row.account_id, guestId: row.guest_id };
}

/** The bearer token a request carries, if it looks like one. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
  return match && isToken(match[1]) ? match[1] : null;
}

/** Who a request is from, once `identify` has checked it. */
export interface Player {
  /** The player's ID: the account's, or the guest's without one. Games take this one. */
  id: string;
  /** The account's other guest IDs (its other devices), which games made before signing in are under. */
  aliases: string[];
  /** This device's guest ID (`x-guest-id`). */
  deviceId: string;
  accountId: string | null;
}

/**
 * SQL that `column` is one of a player's IDs, `param` being the player's ID
 * (`Player.id`): that ID and, for an account, every guest ID linked to it.
 * Looked up by account rather than bound one by one, since D1 allows 100
 * bound parameters and an account signed in on a new browser each time
 * gains a guest ID each time.
 */
export function isPlayers(column: string, param: string): string {
  return `${column} IN (SELECT ${param} UNION SELECT id FROM guests WHERE account_id = ${param})`;
}

/**
 * An account as a player, with every guest ID it linked: what `identify`
 * gives its own session, and what a friend's profile looks the account's
 * games up by. `deviceId` is the account's own ID, there being no device.
 */
export async function playerOfAccount(db: D1Database, accountId: string): Promise<Player> {
  const { results } = await db.prepare('SELECT id FROM guests WHERE account_id = ?1 ORDER BY created_at')
    .bind(accountId).all<{ id: string }>();
  const aliases = results.map((r) => r.id).filter((id) => id !== accountId);
  return { id: accountId, aliases, deviceId: accountId, accountId };
}

export type Identified = { ok: true; player: Player } | { ok: false; status: number; error: string };

/**
 * Checks who a request is from. A session (`authorization: Bearer …`) makes
 * it the account's; without one, it's the guest in `x-guest-id`, unless
 * that guest ID belongs to an account, which only its session can use.
 */
export async function identify(request: Request, db: D1Database, now: number): Promise<Identified> {
  const deviceId = request.headers.get('x-guest-id');
  if (!isGuestId(deviceId)) return { ok: false, status: 400, error: 'bad-guest-id' };
  if (request.headers.get('authorization') !== null) {
    const token = bearerToken(request);
    const session = token && await findSession(db, token, now);
    if (!session) return { ok: false, status: 401, error: 'signed-out' };
    return { ok: true, player: { ...await playerOfAccount(db, session.accountId), deviceId } };
  }
  const guest = await db.prepare('SELECT account_id FROM guests WHERE id = ?1').bind(deviceId)
    .first<{ account_id: string | null }>();
  if (guest?.account_id) return { ok: false, status: 401, error: 'sign-in-needed' };
  return { ok: true, player: { id: deviceId, aliases: [], deviceId, accountId: null } };
}

/**
 * Ends one session: signing out on one device. That device's turn alerts
 * stop too, since its guest ID stays the account's; the app sends them
 * again under its next guest ID.
 */
export async function endSessionAndAlerts(db: D1Database, token: string): Promise<void> {
  const hash = await hashToken(token);
  const session = await db.prepare('SELECT guest_id FROM sessions WHERE token_hash = ?1').bind(hash).first<{ guest_id: string }>();
  if (session) await db.prepare('DELETE FROM push_subscriptions WHERE guest_id = ?1').bind(session.guest_id).run();
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run();
}

/**
 * Deletes an account: every device is signed out and stops getting turn
 * alerts, its email, sign-in links, synced profile and history, friends
 * lobby invites and ratings are forgotten, and its guest IDs are plain guests again. Games already played
 * stay in the game history.
 */
export async function deleteAccount(db: D1Database, accountId: string): Promise<void> {
  const account = await findAccount(db, accountId);
  if (!account) return;
  await db.prepare('DELETE FROM push_subscriptions WHERE guest_id IN (SELECT id FROM guests WHERE account_id = ?1)')
    .bind(accountId).run();
  await db.prepare('DELETE FROM sessions WHERE account_id = ?1').bind(accountId).run();
  await db.prepare('DELETE FROM login_links WHERE email = ?1').bind(account.email).run();
  await db.prepare('DELETE FROM history_entries WHERE account_id = ?1').bind(accountId).run();
  await db.prepare('DELETE FROM profiles WHERE account_id = ?1').bind(accountId).run();
  await db.prepare('DELETE FROM friends WHERE account_id = ?1 OR friend_id = ?1').bind(accountId).run();
  await db.prepare('DELETE FROM lobby_invites WHERE account_id = ?1').bind(accountId).run();
  await db.prepare('DELETE FROM email_requests WHERE account_id = ?1').bind(accountId).run();
  await deleteRatings(db, accountId);
  await db.prepare('UPDATE guests SET account_id = NULL WHERE account_id = ?1').bind(accountId).run();
  // Its profile for friends (Dev Plan item 18cb) last, with the account, so a request indexing it meanwhile can't leave rows behind.
  await db.batch([
    db.prepare('DELETE FROM profile_games WHERE account_id = ?1').bind(accountId),
    db.prepare('DELETE FROM shared_profiles WHERE account_id = ?1').bind(accountId),
    db.prepare('DELETE FROM accounts WHERE id = ?1').bind(accountId),
  ]);
}
