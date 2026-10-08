import { isObject, parseHistoryEntry, type HistoryEntry } from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';

/*
 * The games the server refereed that you played (README "Game history"):
 * against a friend, Daily Rush and Rush with Friends. The server keeps them
 * and hands each player their own side as a history entry, which the app
 * saves with the rest (`playedGames.ts`). Shared with the worker
 * (`worker/src/played.ts`), which builds the entries.
 */

/**
 * The most games one page holds. Each friend game asks its room for your
 * seat, and a Worker has a limit on those calls per request, so pages are small.
 */
export const PLAYED_PAGE = 20;

/**
 * One of your games, and what the app looks up its marks by: a friend
 * game's ID, a lobby's join code or a Daily Rush's day. These never go into
 * the entry, which can reach a backup file.
 */
export interface PlayedGame {
  entry: HistoryEntry;
  ref: string;
  /** Where it comes in the server's list: the cursor just after it. */
  seq?: number;
}

export interface PlayedPage {
  games: PlayedGame[];
  /**
   * A game this version of the app can't read (from a newer server), as the
   * cursor just before it: the app stops there, and reads it once updated.
   */
  unreadableFrom: number | null;
  /** Where the next page starts, or null at the end. */
  next: number | null;
  /** The cursor after this page, whether or not there's more. */
  cursor: number;
}

/** Reads a page asked for from `after`. */
export function parsePlayedPage(value: unknown, after: number): PlayedPage | null {
  if (!isObject(value) || !Array.isArray(value.games) || !Number.isSafeInteger(value.cursor)) return null;
  if (!(value.next === null || Number.isSafeInteger(value.next))) return null;
  // A game this version can't read isn't trusted, and the page ends before it.
  const games: PlayedGame[] = [];
  let unreadableFrom: number | null = null;
  let before = after;
  for (const g of value.games) {
    const seq = isObject(g) && Number.isSafeInteger(g.seq) ? g.seq as number : undefined;
    const entry = isObject(g) && typeof g.ref === 'string' && g.ref.length <= 128 ? parseHistoryEntry(g.entry) : null;
    if (!entry) {
      unreadableFrom = before;
      break;
    }
    games.push({ entry, ref: (g as { ref: string }).ref, seq });
    if (seq !== undefined) before = seq;
  }
  return { games, unreadableFrom, next: value.next as number | null, cursor: value.cursor as number };
}

export class PlayedError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

/** Your games the server refereed, after `cursor` (0 for all of them). Rejects with a `PlayedError`. */
export async function fetchPlayed(
  apiUrl: string, identity: ApiIdentity, cursor: number, fetchFn: typeof fetch = fetch,
): Promise<PlayedPage> {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new PlayedError(code, status));
  const page = parsePlayedPage(await request('GET', `/api/played?after=${cursor}`), cursor);
  if (!page) throw new PlayedError('bad-request', 200);
  return page;
}
