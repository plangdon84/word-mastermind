import { isObject, parseMarks, type Marks, type PlayOn } from '../game';

/*
 * Games played on after a loss (README "Play on after a loss"), kept on this
 * device only: never synced, never in the history. Each is keyed by its game
 * (a history ID vs. the computer, the game's ID vs. a friend).
 */

/** A game played on: its practice words, whether you asked to see their word, and Medium's marks while practising. */
export interface PlayOnSaved extends PlayOn {
  marks: Marks;
}

/** Only the latest games played on are kept. */
export const PLAY_ON_LIMIT = 20;

const KEY = 'word-mastermind:play-on:v1';

/** Keeps each well-formed entry, oldest first, at most the latest `PLAY_ON_LIMIT`. */
export function parsePlayOns(raw: string | null): Record<string, PlayOnSaved> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(data)) return {};
  const entries = Object.entries(data).flatMap(([key, value]): [string, PlayOnSaved][] => {
    if (!isObject(value) || !Array.isArray(value.words)) return [];
    const words = value.words.filter((w): w is string => typeof w === 'string' && /^[a-z]{5}$/.test(w));
    return [[key, { words, revealed: value.revealed === true, marks: parseMarks(value.marks) }]];
  });
  return Object.fromEntries(entries.slice(-PLAY_ON_LIMIT));
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadPlayOn(key: string): PlayOnSaved | null {
  try {
    return parsePlayOns(localStorage.getItem(KEY))[key] ?? null;
  } catch {
    return null;
  }
}

/** Saves one game, moving it to the newest place so the oldest are the ones dropped. */
export function savePlayOn(key: string, saved: PlayOnSaved): void {
  try {
    const all = parsePlayOns(localStorage.getItem(KEY));
    delete all[key];
    all[key] = saved;
    localStorage.setItem(KEY, JSON.stringify(parsePlayOns(JSON.stringify(all))));
  } catch {
    // Storage is a convenience; the game works without it.
  }
}
