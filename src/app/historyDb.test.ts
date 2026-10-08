import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../game';
import {
  deleteHistory, getAllGames, getAllIds, getGame, getGames, loadGamesPage, onGameSaved, putGame, putGames, saveFinishedGame,
} from './historyDb';

const T = 1_000_000;

/** A won single-player game started at `T + n`, guessing `words` and then the secret. */
const game = (n: number, secret = 'beach', words: string[] = []): HistoryEntry & { mode: 'single' } => ({
  id: `game-${n}`, version: 1, mode: 'single', marks: {},
  record: {
    secret, startedAt: T + n, difficulty: 'medium',
    moves: [...words, secret].map((word) => ({ kind: 'guess' as const, word, at: T + n })),
  },
});

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
