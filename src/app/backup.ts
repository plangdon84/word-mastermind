import { isObject, parseHistoryEntry, type HistoryEntry } from '../game';
import { deleteHistory } from './historyDb';
import { parseProfile, type Profile } from './profileStorage';
import { parseRecentSecrets, RECENT_LIMIT } from './recentSecrets';
import { parseSettings, type Settings } from './settings';

/*
 * The JSON backup (README "Your data"): the profile, settings, recent secret
 * words and every finished game, for restoring into this or another browser.
 * Games in progress aren't included.
 */

const APP = 'word-mastermind';
const VERSION = 1;

export interface Backup {
  profile: Profile;
  settings: Settings;
  recentSecrets: string[];
  games: HistoryEntry[];
}

export function serializeBackup(backup: Backup, now: number): string {
  return JSON.stringify({ app: APP, version: VERSION, exportedAt: new Date(now).toISOString(), ...backup });
}

export interface ParsedBackup {
  backup: Backup;
  /** Games in the file that didn't parse or replay, and were left out. */
  skipped: number;
}

/** Reads a backup file defensively, or returns null if it isn't one. */
export function parseBackup(raw: string, current: Profile): ParsedBackup | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data) || data.app !== APP || data.version !== VERSION || !Array.isArray(data.games)) return null;
  const games = data.games.map(parseHistoryEntry).filter((g): g is HistoryEntry => g !== null);
  return {
    backup: {
      profile: parseProfile(data.profile, current),
      settings: parseSettings(JSON.stringify(data.settings ?? null)),
      recentSecrets: parseRecentSecrets(JSON.stringify(data.recentSecrets ?? null)),
      games,
    },
    skipped: data.games.length - games.length,
  };
}

/**
 * The profile after importing a backup: its name and country, and the earlier
 * member-since date. This browser keeps its own device ID, so two browsers
 * restored from one backup stay two devices.
 */
export function mergeProfile(current: Profile, imported: Profile): Profile {
  return {
    ...current,
    name: imported.name,
    country: imported.country,
    memberSince: Math.min(current.memberSince, imported.memberSince),
  };
}

/** This browser's recent secret words first, then the backup's. */
export function mergeRecentSecrets(current: readonly string[], imported: readonly string[]): string[] {
  return [...new Set([...current, ...imported])].slice(0, RECENT_LIMIT);
}

/** Reset profile: deletes game history and everything this app keeps in localStorage. */
export async function resetLocalData(): Promise<void> {
  await deleteHistory();
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) if (key?.startsWith(`${APP}:`)) localStorage.removeItem(key);
  } catch {
    // Nothing more to clear.
  }
}

/** Offers `text` as a file download. */
export function downloadFile(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
