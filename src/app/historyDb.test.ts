import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../game';
import {
  deleteHistory, getAllGames, getAllIds, getGame, getGames, loadAllMatching, loadGamesPage, onGameSaved, putGame, putGames,
  saveFinishedGame, statsGame,
} from './historyDb';

const T = 1_000_000;

/** A won single-player game started at `T + n`, guessing `words` and then the secret, ending at `T + end`. */
const game = (n: number, secret = 'beach', words: string[] = [], end = n): HistoryEntry & { mode: 'single' } => ({
  id: `game-${n}`, version: 1, mode: 'single', marks: {},
  record: {
    secret, startedAt: T + n, difficulty: 'medium',
    moves: [...words, secret].map((word, i, all) => ({ kind: 'guess' as const, word, at: i === all.length - 1 ? T + end : T + n })),
  },
});

const ids = (games: readonly { entry: HistoryEntry }[]) => games.map((g) => g.entry.id);

beforeEach(() => deleteHistory());

describe('game history', () => {
  it('keeps each game once, however often it is saved', async () => {
    await putGame(game(1));
    await putGame({ ...game(1), marks: { b: 'in' } });
    expect(await getAllGames()).toEqual([{ ...game(1), marks: { b: 'in' } }]);
    expect(await getGame('game-1')).toEqual({ ...game(1), marks: { b: 'in' } });
    expect(await getGame('nope')).toBeNull();
  });

  it('lists games newest first, skipping ones that no longer replay', async () => {
    const broken = { ...game(3), record: { ...game(3).record, secret: 'bunny' } } as HistoryEntry;
    await putGames([game(1), game(2), broken]);
    expect((await getAllGames()).map((g) => g.id)).toEqual(['game-2', 'game-1']);
  });

  it('loads matching games a page at a time', async () => {
    await putGames(Array.from({ length: 7 }, (_, i) => game(i, 'beach', i % 2 ? ['crane'] : [])));
    const first = await loadGamesPage({}, 0, 3);
    expect(first.games.map((g) => g.entry.id)).toEqual(['game-6', 'game-5', 'game-4']);
    expect(first.games[0].summary).toMatchObject({ result: 'won', yourGuesses: 1 });
    const second = await loadGamesPage({}, first.next!, 3);
    expect(second.games.map((g) => g.entry.id)).toEqual(['game-3', 'game-2', 'game-1']);
    const last = await loadGamesPage({}, second.next!, 3);
    expect(last).toMatchObject({ next: null });
    expect(last.games.map((g) => g.entry.id)).toEqual(['game-0']);

    const cranes = await loadGamesPage({ search: 'cra' }, 0, 2);
    expect(cranes.games.map((g) => g.entry.id)).toEqual(['game-5', 'game-3']);
    const more = await loadGamesPage({ search: 'cra' }, cranes.next!, 2);
    expect(more.games.map((g) => g.entry.id)).toEqual(['game-1']);
    expect(more.next).toBeNull();
  });

  it('lists games by when they ended, the date each row shows, newest first', async () => {
    // Game 1 started first but ended last, as a long correspondence game does.
    await putGames([game(1, 'beach', ['crane'], 50), game(2), game(3, 'beach', [], 20)]);
    expect(ids((await loadGamesPage({}, 0, 10)).games)).toEqual(['game-1', 'game-3', 'game-2']);
    expect(ids(await loadAllMatching({}, 'endedAt'))).toEqual(['game-1', 'game-3', 'game-2']);
    // Stats read by start, as before.
    expect(ids(await loadAllMatching({}))).toEqual(['game-3', 'game-2', 'game-1']);
    // A game stored keeps only its entry: the end is for the index alone.
    expect(await getGame('game-1')).toEqual(game(1, 'beach', ['crane'], 50));
  });

  describe('a connection that has gone bad (issue 239)', () => {
    afterEach(() => vi.restoreAllMocks());
    const closing = () => {
      throw new DOMException('The database connection is closing.', 'InvalidStateError');
    };

    it('reads again with a fresh connection', async () => {
      await putGames([game(1), game(2)]);
      const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(closing);
      expect((await loadGamesPage({}, 0, Infinity)).games.map((g) => g.entry.id)).toEqual(['game-2', 'game-1']);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(transaction.mock.contexts[1]).not.toBe(transaction.mock.contexts[0]);
    });

    it('passes on a second failure', async () => {
      vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(closing);
      await expect(getAllGames()).rejects.toThrow('closing');
    });
  });

  it('reads every matching game in one go, newest first, with its summary for stats', async () => {
    const broken = { ...game(3), record: { ...game(3).record, secret: 'bunny' } } as HistoryEntry;
    await putGames([game(1), game(2, 'beach', ['crane']), broken, game(4)]);
    const all = await loadAllMatching({});
    expect(all.map((g) => g.entry.id)).toEqual(['game-4', 'game-2', 'game-1']);
    expect(statsGame(all[1])).toEqual({ id: 'game-2', replayed: all[1].replayed, summary: all[1].summary });
    expect((await loadAllMatching({ result: 'lost' }))).toEqual([]);
  });

  it('only saves games started since the profile was created', async () => {
    await saveFinishedGame(game(1), T + 2);
    await saveFinishedGame(game(2), T + 2);
    await saveFinishedGame(game(3), T + 2);
    expect((await getAllGames()).map((g) => g.id)).toEqual(['game-3', 'game-2']);
  });

  it('forgets everything on reset', async () => {
    await putGames([game(1), game(2)]);
    await deleteHistory();
    expect(await getAllGames()).toEqual([]);
  });
});

describe('reading games for syncing', () => {
  it('lists the saved IDs and reads games by ID, in the order asked', async () => {
    await putGames([game(1), game(2)]);
    expect((await getAllIds()).sort()).toEqual(['game-1', 'game-2']);
    expect((await getGames(['game-2', 'missing', 'game-1'])).map((g) => g.id)).toEqual(['game-2', 'game-1']);
  });

  it('tells listeners about each finished game once it is saved', async () => {
    const saved: string[] = [];
    const stop = onGameSaved((id) => saved.push(id));
    await saveFinishedGame(game(3), 0);
    stop();
    await saveFinishedGame(game(4), 0);
    expect(saved).toEqual(['game-3']);
  });
});

describe('the history saved before games were listed by their end', () => {
  it('gets each game its end once, then lists them by it', async () => {
    vi.resetModules();
    const { deleteHistory: forgetHistory } = await import('./historyDb');
    await forgetHistory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('word-mastermind');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    // The store as version 1 made it, holding a game that ended after a newer one, and a value that isn't a game.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('word-mastermind', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('games', { keyPath: 'id' });
        store.createIndex('startedAt', 'record.startedAt');
        store.put(game(1, 'beach', [], 50));
        store.put(game(2));
        store.put({ id: 'junk', record: { startedAt: T } });
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const fresh = await import('./historyDb');
    expect(ids((await fresh.loadGamesPage({}, 0, 10)).games)).toEqual(['game-1', 'game-2']);
    expect((await fresh.getAllIds()).sort()).toEqual(['game-1', 'game-2', 'junk']);
    await fresh.putGame(game(3));
    expect(ids((await fresh.loadGamesPage({}, 0, 10)).games)).toEqual(['game-1', 'game-3', 'game-2']);
  });
});

describe('a database opened first by something else, with no store', () => {
  it('makes the store and keeps games', async () => {
    vi.resetModules();
    await (await import('./historyDb')).deleteHistory();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('word-mastermind');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('word-mastermind');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const fresh = await import('./historyDb');
    await fresh.putGames([game(1), game(2)]);
    expect(ids((await fresh.loadGamesPage({}, 0, 10)).games)).toEqual(['game-2', 'game-1']);
  });
});

describe('a stored game\'s end', () => {
  it('is its last move, or its start without one, and nothing for a value that is not a game', async () => {
    const { storedEndedAt } = await import('./historyDb');
    expect(storedEndedAt(game(1, 'beach', ['crane'], 9))).toBe(T + 9);
    expect(storedEndedAt({ record: { startedAt: T, moves: [] } })).toBe(T);
    expect(storedEndedAt({ record: { startedAt: T } })).toBeUndefined();
    expect(storedEndedAt({ record: { moves: [{}] } })).toBeUndefined();
    expect(storedEndedAt(null)).toBeUndefined();
  });
});
