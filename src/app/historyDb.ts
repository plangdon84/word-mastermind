import {
  matchesFilter, parseHistoryEntry, replayEntry, summarizeGame,
  type GameSummary, type HistoryEntry, type HistoryFilter, type ReplayedGame,
} from '../game';

/*
 * Game history in IndexedDB (README "Game history"): one entry per finished
 * game, keyed by its ID, newest first by start time. Entries are checked and
 * replayed when read, so a corrupted one is skipped rather than trusted.
 */

const DB_NAME = 'word-mastermind';
const STORE = 'games';
const BY_START = 'startedAt';

let opening: Promise<IDBDatabase> | undefined;
/** The connection `opening` gave, once open. */
let current: IDBDatabase | undefined;

function openDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex(BY_START, 'record.startedAt');
    };
    request.onsuccess = () => {
      const db = request.result;
      current = db;
      // Another tab deleting the database (Reset profile) needs this one closed.
      db.onversionchange = () => forget(db);
      // The browser closed it (Safari can, after the app has been in the background): the next use opens another.
      db.onclose = () => forget(db);
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The history database is open in another tab.'));
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

/** Stops reusing `db`, if it's still the connection kept, so the next use opens a fresh one. */
function forget(db: IDBDatabase | undefined): void {
  if (db && db !== current) return;
  current = undefined;
  opening = undefined;
  try {
    db?.close();
  } catch {
    // Already closed.
  }
}

/**
 * Runs `use` with the database. If it fails, it's tried once more with a
 * fresh connection (issue 239): a kept connection can go bad without saying
 * so, as Safari's can after the app has been in the background. A second
 * failure is passed on.
 */
async function withDb<T>(use: (db: IDBDatabase) => Promise<T>): Promise<T> {
  let db: IDBDatabase | undefined;
  try {
    db = await openDb();
    return await use(db);
  } catch {
    forget(db);
    return use(await openDb());
  }
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

/** Adds or replaces games by ID, so saving the same game again never duplicates it. */
export async function putGames(entries: readonly HistoryEntry[]): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const entry of entries) store.put(entry);
    await done(tx);
  });
}

export const putGame = (entry: HistoryEntry) => putGames([entry]);

/** Every entry, newest first. Ones that don't parse and replay are left out. */
export async function getAllGames(): Promise<HistoryEntry[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE);
    const request = tx.objectStore(STORE).index(BY_START).getAll();
    await done(tx);
    return (request.result as unknown[])
      .reverse()
      .map(parseHistoryEntry)
      .filter((e): e is HistoryEntry => e !== null);
  });
}

export async function getGame(id: string): Promise<HistoryEntry | null> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE);
    const request = tx.objectStore(STORE).get(id);
    await done(tx);
    return parseHistoryEntry(request.result);
  });
}

/** The IDs of every saved game, without reading the games. */
export async function getAllIds(): Promise<string[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE);
    const request = tx.objectStore(STORE).getAllKeys();
    await done(tx);
    return (request.result as IDBValidKey[]).filter((k): k is string => typeof k === 'string');
  });
}

/** The games with these IDs that are saved and still read, in the order asked. */
export async function getGames(ids: readonly string[]): Promise<HistoryEntry[]> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE);
    const store = tx.objectStore(STORE);
    const requests = ids.map((id) => store.get(id));
    await done(tx);
    return requests.map((r) => parseHistoryEntry(r.result)).filter((e): e is HistoryEntry => e !== null);
  });
}

/** A game ready to show: its entry, the game rebuilt from it, and its summary. */
export interface HistoryGame {
  entry: HistoryEntry;
  replayed: ReplayedGame;
  summary: GameSummary;
}

export function toHistoryGame(entry: HistoryEntry): HistoryGame | null {
  const replayed = replayEntry(entry);
  return replayed ? { entry, replayed, summary: summarizeGame(replayed) } : null;
}

/** Where a page of history starts: an offset into this browser's, or a friend's `FriendGamesQuery.after`. */
export type HistoryCursor = number | string;

export interface HistoryPage<C extends HistoryCursor = HistoryCursor> {
  games: HistoryGame[];
  /** Where the next page starts, or null at the end. */
  next: C | null;
}

/**
 * Up to `limit` games matching `filter`, newest first, starting `offset`
 * entries in. Filtering needs each game replayed, so it happens here as the
 * cursor walks, and `next` counts entries walked, not games matched.
 */
export async function loadGamesPage(filter: HistoryFilter, offset: number, limit: number): Promise<HistoryPage<number>> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE);
    const games: HistoryGame[] = [];
    let walked = offset;
    let next: number | null = null;
    const request = tx.objectStore(STORE).index(BY_START).openCursor(null, 'prev');
    let skipped = offset === 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (!skipped) {
        skipped = true;
        cursor.advance(offset);
        return;
      }
      if (games.length === limit) {
        next = walked;
        return;
      }
      walked++;
      const entry = parseHistoryEntry(cursor.value);
      const game = entry && toHistoryGame(entry);
      if (game && matchesFilter(game.summary, filter)) games.push(game);
      cursor.continue();
    };
    await done(tx);
    return { games, next };
  });
}

/** Every game matching `filter`, newest first. */
export async function loadAllMatching(filter: HistoryFilter): Promise<HistoryGame[]> {
  return (await loadGamesPage(filter, 0, Infinity)).games;
}

/** Deletes every saved game (Reset profile). */
export async function deleteHistory(): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await done(tx);
  });
}

let persistAsked = false;

/** The latest save of each game this session, so its badges are worked out after it's stored. */
const saving = new Map<string, Promise<void>>();

const savedListeners = new Set<(id: string) => void>();

/** Calls `listener` with each finished game's ID once it's saved (to sync it). Returns a function that stops it. */
export function onGameSaved(listener: (id: string) => void): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/**
 * Saves a finished game, and the first time, asks the browser to keep this
 * site's storage (README "Your data"). A game started before the profile
 * existed (`memberSince`) isn't saved: history, and so stats and
 * achievements, only count games played since. Failures are ignored: history
 * is a convenience, and the game works without it.
 */
export function saveFinishedGame(entry: HistoryEntry, memberSince: number): Promise<void> {
  if (entry.record.startedAt < memberSince) return Promise.resolve();
  if (!persistAsked) {
    persistAsked = true;
    globalThis.navigator?.storage?.persist?.().catch(() => {});
  }
  const saved = putGame(entry).then(() => {
    for (const listener of savedListeners) listener(entry.id);
  }, () => {});
  saving.set(entry.id, saved);
  return saved;
}

/** Resolves once the game `id` has been saved (or failed to), if a save was started. */
export const whenSaved = (id: string): Promise<void> => saving.get(id) ?? Promise.resolve();
