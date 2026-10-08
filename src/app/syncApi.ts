import {
  DIFFICULTIES, isDifficulty, isObject, isTime, parseHistoryEntry, validateName, type Difficulty, type HistoryEntry,
} from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';
import { isCountry } from './countries';

/*
 * The synced profile (README "Profile", "Accounts"): signed in, your profile,
 * your settings and your game history are kept on the server too, so every
 * device signed in to the account shares them. The server checks what it's
 * sent with the same rules as the app (`worker/src/sync.ts`).
 */

/** The settings that follow you between devices. The title screen's last choices stay with each device. */
export interface SyncedSettings {
  difficulty: Difficulty;
  newestFirst: Readonly<Record<Difficulty, boolean>>;
  showTutorial: boolean;
  shareMarks: boolean;
}

/** The profile as the server keeps it. The device ID stays on each device. */
export interface SyncedProfile {
  guestName: string;
  name: string | null;
  country: string | null;
  memberSince: number;
  settings: SyncedSettings;
}

function parseSyncedSettings(value: unknown): SyncedSettings | null {
  if (!isObject(value) || !isDifficulty(value.difficulty) || typeof value.showTutorial !== 'boolean') return null;
  const order = value.newestFirst;
  // Easy came later (Dev Plan item 13c): settings saved before it have no Easy order, which means oldest first.
  if (!isObject(order)) return null;
  const known = (d: Difficulty) => (d === 'easy' && order[d] === undefined ? false : order[d]);
  if (DIFFICULTIES.some((d) => typeof known(d) !== 'boolean')) return null;
  const newestFirst = Object.fromEntries(DIFFICULTIES.map((d) => [d, known(d) as boolean])) as Record<Difficulty, boolean>;
  // Share my Medium marks came later (Dev Plan item 18i): settings saved before it share them.
  if (value.shareMarks !== undefined && typeof value.shareMarks !== 'boolean') return null;
  return { difficulty: value.difficulty, newestFirst, showTutorial: value.showTutorial, shareMarks: value.shareMarks !== false };
}

/** Reads a synced profile strictly: the server refuses anything that doesn't parse, and the app ignores it. */
export function parseSyncedProfile(value: unknown): SyncedProfile | null {
  if (!isObject(value)) return null;
  const { guestName, name, country, memberSince } = value;
  if (typeof guestName !== 'string' || guestName.length > 64 || !validateName(guestName).ok) return null;
  let checkedName: string | null = null;
  if (name !== null) {
    if (typeof name !== 'string' || name.length > 64) return null;
    const valid = validateName(name);
    if (!valid.ok) return null;
    checkedName = valid.name;
  }
  if (!(country === null || isCountry(country)) || !isTime(memberSince)) return null;
  const settings = parseSyncedSettings(value.settings);
  if (!settings) return null;
  return { guestName, name: checkedName, country, memberSince, settings };
}

/** The most games one upload carries, and one download page holds. */
export const UPLOAD_BATCH = 50;
export const DOWNLOAD_PAGE = 100;

/** A page of the account's games, in the order the server got them. */
export interface HistoryDownload {
  entries: HistoryEntry[];
  /** Where the next page starts, or null at the end: the cursor to ask for next time. */
  next: number | null;
  /** The cursor after this page, whether or not there's more. */
  cursor: number;
}

export function parseHistoryDownload(value: unknown): HistoryDownload | null {
  if (!isObject(value) || !Array.isArray(value.entries) || !Number.isInteger(value.cursor)) return null;
  if (!(value.next === null || Number.isInteger(value.next))) return null;
  // An entry this version can't read is skipped, not trusted.
  const entries = value.entries.map(parseHistoryEntry).filter((e): e is HistoryEntry => e !== null);
  return { entries, next: value.next as number | null, cursor: value.cursor as number };
}

export type SyncErrorCode = 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'unreachable';

export class SyncError extends Error {
  constructor(readonly code: SyncErrorCode, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

export interface SyncApi {
  /** The account's profile, or null if no device has sent one yet. */
  getProfile(): Promise<SyncedProfile | null>;
  /** Replaces the account's profile, and answers with it as kept. */
  putProfile(profile: SyncedProfile): Promise<SyncedProfile>;
  /** Adds games (at most `UPLOAD_BATCH`); ones the server already has are left as they are. */
  upload(entries: readonly HistoryEntry[]): Promise<void>;
  /** The account's games after `cursor` (0 for all of them). */
  download(cursor: number): Promise<HistoryDownload>;
}

/** Talks to the worker at `apiUrl` as the signed-in account (`identity`). Every call rejects with a `SyncError`. */
export function syncApi(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): SyncApi {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new SyncError(code as SyncErrorCode, status));
  return {
    getProfile: async () => {
      const data = await request('GET', '/api/profile');
      if (!isObject(data)) throw new SyncError('bad-request', 200);
      return data.profile === null ? null : parseSyncedProfile(data.profile);
    },
    putProfile: async (profile) => {
      const data = await request('POST', '/api/profile', profile);
      const kept = isObject(data) ? parseSyncedProfile(data.profile) : null;
      if (!kept) throw new SyncError('bad-request', 200);
      return kept;
    },
    upload: async (entries) => {
      await request('POST', '/api/history', { entries });
    },
    download: async (cursor) => {
      const page = parseHistoryDownload(await request('GET', `/api/history?after=${cursor}`));
      if (!page) throw new SyncError('bad-request', 200);
      return page;
    },
  };
}
