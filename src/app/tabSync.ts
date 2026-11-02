/*
 * The same game open in two tabs (Dev Plan items 17 and 19d): each tab
 * follows the other's saves rather than saving its own older copy over
 * them. These read one localStorage key the way every game's storage does.
 */

/**
 * What's saved under `key`, if it's changed since this page last wrote
 * `written`: a page that comes back (another tab's, or one restored by
 * Back) may have missed another tab's saves while it slept (issue #163).
 * Unchanged, or unreadable, gives null.
 */
export function savedSinceAt<T>(key: string, written: string | null, parse: (raw: string | null) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null && raw !== written ? parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * What's saved under `key` now. A storage event's own value can be older
 * than what this page has already caught up to (events arrive late), so
 * it's read again from storage rather than trusted.
 */
export function currentAt(key: string, fallback: string | null): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return fallback;
  }
}

/**
 * Calls `listener` with what's saved under `key` when another tab saves
 * there, if it reads: the latest save, not the event's own (`currentAt`).
 * Returns the unsubscribe.
 */
export function onOtherTabSaveAt<T>(key: string, parse: (raw: string | null) => T | null, listener: (saved: T) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== key) return;
    const saved = parse(currentAt(key, e.newValue));
    if (saved) listener(saved);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** Whether two records are the same game state: compared as saved, so key order matters only as the engine builds them. */
export const sameRecord = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
