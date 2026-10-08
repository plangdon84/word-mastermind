import { SECRET_WORD_SET } from '../game/wordLists';

/** How many of your past secret words are offered on the choose-your-word screen. */
export const RECENT_LIMIT = 10;

const KEY = 'word-mastermind:recent-secrets:v1';

/** Puts `word` first, without duplicates, keeping the newest `RECENT_LIMIT`. */
export function addRecentSecret(recent: readonly string[], word: string): string[] {
  return [word, ...recent.filter((w) => w !== word)].slice(0, RECENT_LIMIT);
}

/** Keeps only secret-list words, once each, newest first. */
export function parseRecentSecrets(raw: string | null): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const words = data.filter((w): w is string => typeof w === 'string' && SECRET_WORD_SET.has(w));
  return [...new Set(words)].slice(0, RECENT_LIMIT);
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadRecentSecrets(): string[] {
  try {
    return parseRecentSecrets(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function saveRecentSecrets(recent: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(recent));
  } catch {
    // Storage is a convenience; the game works without it.
  }
}
