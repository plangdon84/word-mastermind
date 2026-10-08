import { useState } from 'preact/hooks';

/*
 * ☰ Highlights → Check for mistakes works once a game, once a word in a
 * Rush (README "Menu", issue #134), in every mode and at every level it's
 * offered at, rated games included. The app counts it, since it uses only
 * what the player can see: kept on this device by the game's key (a history
 * ID, a friend game's ID, a day or a join code, plus the word in a Rush), so
 * a reload doesn't give it back.
 */

/** Checks a game (a word in a Rush) gets. */
export const CHECK_LIMIT = 1;

/** Only the latest games' counts are kept. */
export const CHECKS_KEPT = 50;

const KEY = 'word-mastermind:checks:v1';

/** Keeps each well-formed count, oldest first, at most the latest `CHECKS_KEPT`. */
export function parseChecks(raw: string | null): Record<string, number> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {};
  const entries = Object.entries(data).filter(([, n]) => Number.isInteger(n) && n > 0);
  return Object.fromEntries(entries.slice(-CHECKS_KEPT));
}

/** Browser storage can be missing or blocked (private windows), so failures read as none used. */
export function checksUsed(key: string): number {
  try {
    return parseChecks(localStorage.getItem(KEY))[key] ?? 0;
  } catch {
    return 0;
  }
}

/** Counts one check, moving the game to the newest place so the oldest are the ones dropped. */
export function countCheck(key: string): void {
  try {
    const all = parseChecks(localStorage.getItem(KEY));
    const used = (all[key] ?? 0) + 1;
    delete all[key];
    all[key] = used;
    localStorage.setItem(KEY, JSON.stringify(parseChecks(JSON.stringify(all))));
  } catch {
    // Storage is a convenience; the count still holds until the page reloads.
  }
}

export interface CheckLimit {
  /** Checks left for this game (this word in a Rush). */
  left: number;
  /** Uses one; false, doing nothing, when none are left. */
  use: () => boolean;
}

/** The checks left for the game (or Rush word) `key`. */
export function useCheckLimit(key: string): CheckLimit {
  const [counted, setCounted] = useState<Record<string, number>>({});
  const used = Math.max(counted[key] ?? 0, checksUsed(key));
  const left = Math.max(0, CHECK_LIMIT - used);
  return {
    left,
    use: () => {
      if (left === 0) return false;
      countCheck(key);
      setCounted((c) => ({ ...c, [key]: used + 1 }));
      return true;
    },
  };
}
