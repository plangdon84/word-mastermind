/*
 * Browser storage (localStorage) for the app's own keys. It can be missing,
 * blocked (some private windows) or full, and the game works without it, so
 * every read, write and removal here survives that: a read gives null, a
 * write that fails says so and changes nothing. Storage is a convenience;
 * what matters is kept elsewhere too (the history in IndexedDB, games on the
 * server).
 */

/** The value stored under `key`, or null if there's none or storage can't be read. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value` under `key`; false if storage refused it. */
export function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Forgets `key`, if storage can be reached. */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to forget.
  }
}
