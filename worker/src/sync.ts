import { isObject, isServerMode, parseHistoryEntry, validateName, type HistoryEntry } from '../../src/game';
import { DOWNLOAD_PAGE, parseSyncedProfile, UPLOAD_BATCH, type SyncedProfile } from '../../src/app/syncApi';
import { identify } from './accounts';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';

/*
 * The synced profile (README "Profile", "Accounts"): a signed-in player's
 * profile, settings and game history, which every device signed in to the
 * account shares. Only accounts have one; a guest's stays on their device.
 */

/** The longest history entry kept, as JSON: far more than any real game's record. */
const MAX_ENTRY_CHARS = 200_000;
/**
 * The most history one account keeps, as JSON: tens of thousands of real
 * games, but not enough for one account to fill the database. Past it,
 * new games stay on the device and aren't synced.
 */
export const MAX_ACCOUNT_CHARS = 20_000_000;

interface ProfileRow {
  guest_name: string;
  name: string | null;
  country: string | null;
  member_since: number;
  settings: string;
}

export async function loadSyncedProfile(db: D1Database, accountId: string): Promise<SyncedProfile | null> {
  const row = await db.prepare(
    'SELECT guest_name, name, country, member_since, settings FROM profiles WHERE account_id = ?1',
  ).bind(accountId).first<ProfileRow>();
  if (!row) return null;
  let settings: unknown = null;
  try {
    settings = JSON.parse(row.settings);
  } catch {
    // Left for parseSyncedProfile to refuse.
  }
  return parseSyncedProfile({
    guestName: row.guest_name, name: row.name, country: row.country, memberSince: row.member_since, settings,
  });
}

async function saveSyncedProfile(db: D1Database, accountId: string, profile: SyncedProfile, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO profiles (account_id, guest_name, name, country, member_since, settings, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (account_id) DO UPDATE SET guest_name = excluded.guest_name, name = excluded.name,
       country = excluded.country, member_since = excluded.member_since, settings = excluded.settings,
       updated_at = excluded.updated_at`,
  ).bind(accountId, profile.guestName, profile.name, profile.country, profile.memberSince,
    JSON.stringify(profile.settings), now).run();
}

/** The name others see for an account: its synced name, or its guest name; null without a profile. */
export async function syncedName(db: D1Database, accountId: string): Promise<string | null> {
  return (await currentNames(db, [accountId]))[accountId] ?? null;
}

/**
 * The names others see now for these player IDs (issue #133), in one query:
 * each ID's account, whether the ID is the account's own or a guest ID it
 * linked, by its synced name or guest name. IDs with no account profile are
 * left out, and so is a name the profanity filter now refuses.
 */
export async function currentNames(db: D1Database, ids: readonly string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { results } = await db.prepare(
    `SELECT ids.value AS id, COALESCE(p.name, p.guest_name) AS name FROM json_each(?1) AS ids
     JOIN profiles p ON p.account_id = COALESCE((SELECT account_id FROM guests WHERE id = ids.value), ids.value)`,
  ).bind(JSON.stringify([...new Set(ids)])).all<{ id: string; name: string }>();
  const names: Record<string, string> = {};
  for (const row of results) {
    const shown = validateName(row.name);
    if (shown.ok) names[row.id] = shown.name;
  }
  return names;
}

/**
 * Adds the games the account doesn't have yet, while it has room
 * (`MAX_ACCOUNT_CHARS`). Returns how many were new. Each insert checks the
 * account's running total (`accounts.history_chars`, kept by triggers) in
 * the same statement, so two uploads at once can't both pass the limit.
 */
export async function saveEntries(db: D1Database, accountId: string, entries: readonly HistoryEntry[], now: number): Promise<number> {
  let added = 0;
  for (const entry of entries) {
    const { meta } = await db.prepare(
      `INSERT OR IGNORE INTO history_entries (account_id, id, mode, version, entry, started_at, uploaded_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE (SELECT history_chars FROM accounts WHERE id = ?1) + LENGTH(?5) <= ${MAX_ACCOUNT_CHARS}`,
    ).bind(accountId, entry.id, entry.mode, entry.version, JSON.stringify(entry), entry.record.startedAt, now).run();
    added += meta.changes ?? 0;
  }
  return added;
}

/** A page of the account's games after `cursor`, in the order they arrived. */
export async function loadEntries(db: D1Database, accountId: string, cursor: number) {
  const { results } = await db.prepare(
    `SELECT seq, entry FROM history_entries WHERE account_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ${DOWNLOAD_PAGE + 1}`,
  ).bind(accountId, cursor).all<{ seq: number; entry: string }>();
  const page = results.slice(0, DOWNLOAD_PAGE);
  const entries = page.map((r) => JSON.parse(r.entry) as unknown);
  const last = page.length > 0 ? page[page.length - 1].seq : cursor;
  return { entries, cursor: last, next: results.length > DOWNLOAD_PAGE ? last : null };
}

/** Routes `/api/profile` and `/api/history`, or returns null for any other path. */
export async function routeSync(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (pathname !== '/api/profile' && pathname !== '/api/history') return null;
  const method = request.method;
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  // Only an account has a synced profile; a guest's stays on their device.
  const accountId = who.player.accountId;
  if (!accountId) return errorResponse(401, 'signed-out');

  if (pathname === '/api/profile') {
    if (method === 'GET') return json({ profile: await loadSyncedProfile(env.DB, accountId) });
    if (method !== 'POST') return errorResponse(405, 'bad-request');
    const profile = parseSyncedProfile(await readJson(request));
    if (!profile) return errorResponse(400, 'bad-request');
    await saveSyncedProfile(env.DB, accountId, profile, now);
    return json({ profile });
  }

  if (method === 'GET') {
    const after = Number(new URL(request.url).searchParams.get('after') ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) return errorResponse(400, 'bad-request');
    return json(await loadEntries(env.DB, accountId, after));
  }
  if (method !== 'POST') return errorResponse(405, 'bad-request');
  const body = await readJson(request);
  if (!isObject(body) || !Array.isArray(body.entries) || body.entries.length > UPLOAD_BATCH) {
    return errorResponse(400, 'bad-request');
  }
  // Each game must replay to a finished one, as the app checks; one that doesn't is left out, not refused,
  // so a device never gets stuck sending it again. The server's own games (a friend's, Daily Rush, a
  // lobby's) come from `GET /api/played`, built from what it kept, so an upload of one is left out too.
  const entries = body.entries
    .filter((e) => JSON.stringify(e).length <= MAX_ENTRY_CHARS)
    .map(parseHistoryEntry)
    .filter((e): e is HistoryEntry => e !== null && !isServerMode(e.mode));
  const added = await saveEntries(env.DB, accountId, entries, now);
  return json({ added, skipped: body.entries.length - entries.length });
}
