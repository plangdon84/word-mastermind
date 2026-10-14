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
 * The most games the app keeps to ask for again, after their room didn't
 * answer (Dev Plan item 18zg): a request looks them up again, and a page
 * passes over no more than that many new ones, so a room that keeps failing
 * doesn't hold up every game after it, and an outage still stops the page.
 */
export const PLAYED_RETRIES = 3;

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
  /** Games asked for again that came this time. */
  retried: PlayedGame[];
  /** Games passed over, or asked for again, whose room didn't answer for now (`seq`s), to ask for again. */
  retry: number[];
}

/** Games to ask for again (`seq`s), and how many more the page may pass over. */
export interface PlayedRetries {
  retry: readonly number[];
  skip: number;
}

/** One game of a page, or null if this version can't read it; its `seq` either way, where it has one. */
function parsePlayedGame(value: unknown): { game: PlayedGame | null; seq?: number } {
  if (!isObject(value)) return { game: null };
  const seq = Number.isSafeInteger(value.seq) ? value.seq as number : undefined;
  const entry = typeof value.ref === 'string' && value.ref.length <= 128 ? parseHistoryEntry(value.entry) : null;
  return { game: entry && { entry, ref: value.ref as string, seq }, seq };
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
    const { game, seq } = parsePlayedGame(g);
    if (!game) {
      unreadableFrom = before;
      break;
    }
    games.push(game);
    if (seq !== undefined) before = seq;
  }
  // A server from before games were retried sends neither list. A game asked for again that this version can't
  // read stays to ask for again, like one whose room didn't answer.
  const retry = Array.isArray(value.retry) ? value.retry.filter((seq): seq is number => Number.isSafeInteger(seq)) : [];
  const retried: PlayedGame[] = [];
  for (const g of Array.isArray(value.retried) ? value.retried : []) {
    const { game, seq } = parsePlayedGame(g);
    if (game) retried.push(game);
    else if (seq !== undefined) retry.push(seq);
  }
  return { games, unreadableFrom, next: value.next as number | null, cursor: value.cursor as number, retried, retry };
}

export class PlayedError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

/**
 * Your games the server refereed, after `cursor` (0 for all of them), and
 * any asked for again (`retries`). Rejects with a `PlayedError`.
 */
export async function fetchPlayed(
  apiUrl: string, identity: ApiIdentity, cursor: number, fetchFn: typeof fetch = fetch, retries?: PlayedRetries,
): Promise<PlayedPage> {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new PlayedError(code, status));
  const query = retries ? `&retry=${retries.retry.join(',')}&skip=${retries.skip}` : '';
  const page = parsePlayedPage(await request('GET', `/api/played?after=${cursor}${query}`), cursor);
  if (!page) throw new PlayedError('bad-request', 200);
  return page;
}
