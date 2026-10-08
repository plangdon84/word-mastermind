import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../game';
import { dailyEntry, friendEntry } from '../game/testGames';
import { addFriendGame, updateFriendGame } from './friendGames';
import { pullPlayedGames, type PlayedStore } from './playedGames';

const ID = 'a'.repeat(64);
const T = Date.UTC(2026, 9, 31, 12);
const identity = { guestId: 'guest', token: null };

/** A server answering from `pages`: the page after each cursor, and the cursors asked for. */
function server(pages: Record<number, { games: { entry: HistoryEntry; ref: string }[]; next: number | null; cursor: number }>) {
  const asked: number[] = [];
  const fetchFn = (async (url: RequestInfo | URL) => {
    const after = Number(new URL(String(url)).searchParams.get('after'));
    asked.push(after);
    return new Response(JSON.stringify(pages[after] ?? { games: [], next: null, cursor: after }));
  }) as typeof fetch;
  return { fetchFn, asked };
}

function store() {
  const games = new Map<string, HistoryEntry>();
  const s: PlayedStore = {
    allIds: async () => [...games.keys()],
    putGames: async (entries) => {
      for (const e of entries) games.set(e.id, e);
    },
  };
  return { s, games };
}

describe('pulling your server games', () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });

  const won = friendEntry('friend-1', T, { you: ['crane', 'beach'], them: ['house', 'crane'] });
  const day = dailyEntry('daily-1', '2026-10-31', T - 1000, [['beach'], ['crane'], ['storm'], ['house']]);

  it("saves each game once, page by page, with the marks this browser kept, and starts after where it stopped", async () => {
    addFriendGame(ID, T);
    updateFriendGame(ID, { marks: { b: 'in' } });
    const { fetchFn, asked } = server({
      0: { games: [{ entry: won, ref: ID }], next: 7, cursor: 7 },
      7: { games: [{ entry: day, ref: '2026-10-31' }], next: null, cursor: 9 },
    });
    const { s, games } = store();
    expect(await pullPlayedGames('https://api.example', identity, 'guest', 0, s, fetchFn)).toEqual(['friend-1', 'daily-1']);
    expect(games.get('friend-1')).toMatchObject({ marks: { b: 'in' } });
    expect(await pullPlayedGames('https://api.example', identity, 'guest', 0, s, fetchFn)).toEqual([]);
    expect(asked).toEqual([0, 7, 9]);
  });

  it('starts from the beginning for someone else (signing in), and skips games from before the profile', async () => {
    const { fetchFn, asked } = server({ 0: { games: [{ entry: won, ref: ID }, { entry: day, ref: '2026-10-31' }], next: null, cursor: 3 } });
    const { s } = store();
    expect(await pullPlayedGames('https://api.example', identity, 'guest', T, s, fetchFn)).toEqual(['friend-1']);
    expect(await pullPlayedGames('https://api.example', identity, 'account', T, s, fetchFn)).toEqual([]);
    expect(asked).toEqual([0, 0]);
  });

  it("stops just before a game this version can't read, so it comes once the app is updated", async () => {
    const future = { ...won, id: 'future-1', mode: 'hologram' } as unknown as HistoryEntry;
    const { fetchFn, asked } = server({
      0: { games: [{ entry: won, ref: ID, seq: 4 }, { entry: future, ref: 'x', seq: 5 }, { entry: day, ref: '2026-10-31', seq: 6 }], next: null, cursor: 6 },
    } as never);
    const { s } = store();
    expect(await pullPlayedGames('https://api.example', identity, 'guest', 0, s, fetchFn)).toEqual(['friend-1']);
    await pullPlayedGames('https://api.example', identity, 'guest', 0, s, fetchFn);
    expect(asked).toEqual([0, 4]);
  });
});
