import { isObject, type HistoryEntry, type Marks } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { loadDaily } from './dailyStorage';
import { findFriendGame } from './friendGames';
import { loadLobby } from './lobbyStorage';
import { fetchPlayed, PLAYED_RETRIES, type PlayedGame } from './playedApi';

/*
 * Bringing the server's games into this browser's history (README "Game
 * history"): games against a friend, Daily Rush and Rush with Friends. The
 * server hands over each finished one once (`GET /api/played`), from your
 * side, and it's saved like any other game, with the Medium marks this
 * browser kept while you played it.
 */

/**
 * How far this browser has read, for whoever it plays as: a guest, or an
 * account (which also gets its guests' games), and the games passed over
 * whose room didn't answer, with how many days in a row it hasn't.
 */
interface PlayedState {
  who: string;
  cursor: number;
  retry: RetryGame[];
}

interface RetryGame {
  seq: number;
  /** Failed tries counted, at most one a `TRY_GAP_MS`. */
  tries: number;
  /** When the last one was counted. */
  countedAt: number;
}

/**
 * A game whose room fails on this many days in a row is given up on (Dev
 * Plan item 18zg): a pull fails a try at most once a day, so an outage of
 * a few hours, with pulls on every visit, never loses a game.
 */
export const PLAYED_TRIES = 5;
const TRY_GAP_MS = 24 * 60 * 60 * 1000;

/**
 * v1 could save its place past games it had left out as from before this
 * device's profile, losing them for good on a device that then signed in;
 * v2 reads every device's games again once (the ones it has are skipped).
 */
const KEY = 'word-mastermind:played:v2';

export function parsePlayedState(raw: string | null): PlayedState | null {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!isObject(data) || typeof data.who !== 'string' || !Number.isSafeInteger(data.cursor)) return null;
    const retry = (Array.isArray(data.retry) ? data.retry : [])
      .filter((r): r is RetryGame => isObject(r) && [r.seq, r.tries, r.countedAt].every(Number.isSafeInteger))
      .slice(0, PLAYED_RETRIES);
    return { who: data.who, cursor: data.cursor as number, retry };
  } catch {
    return null;
  }
}

function loadState(): PlayedState | null {
  try {
    return parsePlayedState(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function saveState(state: PlayedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The next pull reads from the start again; games already here are skipped.
  }
}

/** The marks you left on a game while playing it, where this browser still has them. */
function withMarks({ entry, ref }: PlayedGame): HistoryEntry {
  switch (entry.mode) {
    case 'friend': {
      const marks: Marks | undefined = findFriendGame(ref)?.marks;
      return marks ? { ...entry, marks } : entry;
    }
    case 'daily':
    case 'dailyWord': {
      const saved = loadDaily(entry.mode);
      return saved?.day === ref && saved.marks.length === entry.record.words.length ? { ...entry, marks: saved.marks } : entry;
    }
    case 'lobby': {
      const saved = loadLobby();
      return saved?.code === ref && saved.marks.length === entry.record.words.length ? { ...entry, marks: saved.marks } : entry;
    }
    default:
      return entry;
  }
}

/** What pulling needs from this browser's game history. */
export interface PlayedStore {
  allIds(): Promise<string[]>;
  putGames(entries: readonly HistoryEntry[]): Promise<void>;
}

/**
 * Saves your finished server games this browser doesn't have yet. `who` is
 * whoever the app plays as (the account's ID, or the guest's), since signing
 * in brings the account's other games. Unlike games played here, these
 * aren't left out for starting before this device's profile (`memberSince`):
 * every one is yours, and a device that just signed in has its own date
 * until the account's arrives. Returns the new games' IDs; rejects if the
 * server can't be reached.
 */
export async function pullPlayedGames(
  apiUrl: string, identity: ApiIdentity, who: string, store: PlayedStore, fetchFn: typeof fetch = fetch, now = Date.now(),
): Promise<string[]> {
  const saved = loadState();
  let cursor = saved?.who === who ? saved.cursor : 0;
  // The games to ask for again are asked for on the first page only, once a pull.
  let retry = saved?.who === who ? saved.retry : [];
  let asked: readonly RetryGame[] = retry;
  const known = new Set(await store.allIds());
  const added: string[] = [];
  for (;;) {
    const page = await fetchPlayed(apiUrl, identity, cursor, fetchFn, {
      retry: asked.map((r) => r.seq), skip: PLAYED_RETRIES - retry.length,
    });
    const fresh = [...page.retried, ...page.games]
      .filter((g) => !known.has(g.entry.id))
      .map(withMarks);
    if (fresh.length > 0) await store.putGames(fresh);
    for (const e of fresh) {
      known.add(e.id);
      added.push(e.id);
    }
    // Those asked for that came, or aren't yours to have, are done; those that failed again count a try (once
    // a day), given up on after `PLAYED_TRIES`; one this version can't read waits for the app to be updated;
    // those passed over now join them.
    const failed = new Set(page.retry);
    const kept = new Set([...page.retry, ...page.unread]);
    const listed = new Set(retry.map((r) => r.seq));
    const asking = new Set(asked.map((r) => r.seq));
    retry = [
      ...retry.filter((r) => !asking.has(r.seq) || kept.has(r.seq)),
      ...page.retry.filter((seq) => !listed.has(seq)).map((seq) => ({ seq, tries: 0, countedAt: 0 })),
    ].map((r) => (failed.has(r.seq) && now - r.countedAt >= TRY_GAP_MS ? { ...r, tries: r.tries + 1, countedAt: now } : r))
      .filter((r) => r.tries < PLAYED_TRIES)
      .slice(0, PLAYED_RETRIES);
    asked = [];
    // A game this version can't read: stop just before it, so it comes again once the app is updated.
    cursor = page.unreadableFrom ?? page.cursor;
    saveState({ who, cursor, retry });
    if (page.next === null || page.unreadableFrom !== null) return added;
  }
}
