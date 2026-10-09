import { isServerMode, type HistoryEntry } from '../game';
import type { Profile } from './profileStorage';
import type { Settings } from './settings';
import { UPLOAD_BATCH, type SyncApi, type SyncedProfile } from './syncApi';

/*
 * Keeping this device and the account in step (README "Accounts"): on
 * signing in, this browser's games go up to the server, and from then on
 * games finished on any of the account's devices reach every one of them.
 * The profile and settings follow too; a change made here wins over the
 * server's, and otherwise the server's is taken. Signed out, nothing is sent.
 */

/** What this browser remembers about syncing with the signed-in account. */
export interface SyncState {
  accountId: string;
  /** The server's cursor: every game up to it has been downloaded. */
  cursor: number;
  /** Games saved here that the server may not have yet. */
  pending: string[];
  /** The synced profile as last agreed with the server (JSON), to tell a change made here from one made elsewhere. */
  profile: string | null;
}

const KEY = 'word-mastermind:sync:v1';

export function parseSyncState(raw: string | null): SyncState | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const { accountId, cursor, pending, profile } = data as Record<string, unknown>;
    if (typeof accountId !== 'string' || !Number.isSafeInteger(cursor) || !Array.isArray(pending)) return null;
    return {
      accountId,
      cursor: cursor as number,
      pending: pending.filter((id): id is string => typeof id === 'string'),
      profile: typeof profile === 'string' ? profile : null,
    };
  } catch {
    return null;
  }
}

export function loadSyncState(): SyncState | null {
  try {
    return parseSyncState(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function saveSyncState(state: SyncState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The next sign-in sends every game again, which the server ignores.
  }
}

/** Signing out forgets which account this browser synced with; the games here stay. */
export function clearSyncState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Games saved here (a finished game, a restored backup) for the next sync to send, once signed in. */
export function notePending(ids: readonly string[]): void {
  const state = loadSyncState();
  if (!state || ids.length === 0) return;
  saveSyncState({ ...state, pending: [...new Set([...state.pending, ...ids])] });
}

/** A synced profile with its keys in a fixed order, so two equal profiles compare equal as JSON. */
function canonical(p: SyncedProfile): SyncedProfile {
  const { difficulty, newestFirst, showTutorial, shareMarks, findByName } = p.settings;
  return {
    guestName: p.guestName,
    name: p.name,
    country: p.country,
    memberSince: p.memberSince,
    settings: {
      difficulty,
      newestFirst: { easy: newestFirst.easy, medium: newestFirst.medium, hard: newestFirst.hard, extreme: newestFirst.extreme },
      showTutorial,
      shareMarks,
      findByName,
    },
  };
}

export const profileKey = (p: SyncedProfile): string => JSON.stringify(canonical(p));

/** The part of this browser's profile and settings that follows the account. */
export const syncedOf = (profile: Profile, settings: Settings): SyncedProfile => canonical({ ...profile, settings });

/** This browser's profile and settings with the account's applied. The device ID and title-screen choices stay. */
export function applySynced(profile: Profile, settings: Settings, synced: SyncedProfile): { profile: Profile; settings: Settings } {
  return {
    profile: { ...profile, guestName: synced.guestName, name: synced.name, country: synced.country, memberSince: synced.memberSince },
    settings: { ...settings, ...synced.settings },
  };
}

/**
 * The first time a device syncs with an account that already has a profile:
 * the account's name, country and settings, filling a name or country the
 * account hasn't set from this device, and the earlier member-since date.
 */
export function mergeFirstSync(local: SyncedProfile, server: SyncedProfile): SyncedProfile {
  return {
    ...server,
    name: server.name ?? local.name,
    country: server.country ?? local.country,
    memberSince: Math.min(local.memberSince, server.memberSince),
  };
}

/** What syncing needs from this browser's game history. */
export interface HistoryStore {
  allIds(): Promise<string[]>;
  /** The games with these IDs that are here and still read. */
  getGames(ids: readonly string[]): Promise<HistoryEntry[]>;
  putGames(entries: readonly HistoryEntry[]): Promise<void>;
}

export interface SyncResult {
  /** The profile as agreed with the account, to show here. */
  profile: SyncedProfile;
  /** Games from the account's other devices that are new here. */
  added: number;
}

/**
 * One round of syncing with the signed-in account: the profile, then this
 * device's games up, then the account's new games down. Progress is saved as
 * it goes, so a round cut short picks up where it stopped. Rejects if the
 * server can't be reached or the session has ended.
 */
export async function syncAccount(api: SyncApi, accountId: string, local: SyncedProfile, store: HistoryStore): Promise<SyncResult> {
  const saved = loadSyncState();
  const first = !saved || saved.accountId !== accountId;
  // Signing in moves every game here to the account.
  let state: SyncState = first ? { accountId, cursor: 0, pending: await store.allIds(), profile: null } : saved;
  saveSyncState(state);

  const server = await api.getProfile();
  let agreed: SyncedProfile;
  if (first || !server) {
    const merged = server ? mergeFirstSync(local, server) : local;
    agreed = server && profileKey(merged) === profileKey(server) ? server : await api.putProfile(merged);
  } else if (profileKey(local) !== state.profile) {
    // Changed here since the last sync: this device's wins.
    agreed = profileKey(local) === profileKey(server) ? server : await api.putProfile(local);
  } else {
    agreed = server;
  }
  state = { ...(loadSyncState() ?? state), profile: profileKey(agreed) };
  saveSyncState(state);

  while (state.pending.length > 0) {
    const batch = state.pending.slice(0, UPLOAD_BATCH);
    // The server's own games reach every device from the server (`playedGames.ts`), not from here.
    const entries = (await store.getGames(batch)).filter((e) => !isServerMode(e.mode));
    if (entries.length > 0) await api.upload(entries);
    // Games saved while this batch was on its way stay pending.
    const latest = loadSyncState() ?? state;
    state = { ...latest, pending: latest.pending.filter((id) => !batch.includes(id)) };
    saveSyncState(state);
  }

  let added = 0;
  const known = new Set(await store.allIds());
  for (;;) {
    const page = await api.download(state.cursor);
    const fresh = page.entries.filter((e) => !known.has(e.id));
    if (fresh.length > 0) await store.putGames(fresh);
    for (const e of fresh) known.add(e.id);
    added += fresh.length;
    state = { ...(loadSyncState() ?? state), cursor: page.cursor };
    saveSyncState(state);
    if (page.next === null) break;
  }
  return { profile: agreed, added };
}
