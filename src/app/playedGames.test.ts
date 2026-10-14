import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../game';
import { dailyEntry, friendEntry } from '../game/testGames';
import { addFriendGame, updateFriendGame } from './friendGames';
import { PLAYED_TRIES, pullPlayedGames, type PlayedStore } from './playedGames';

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
    expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual(['friend-1', 'daily-1']);
    expect(games.get('friend-1')).toMatchObject({ marks: { b: 'in' } });
    expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual([]);
    expect(asked).toEqual([0, 7, 9]);
  });

  it('starts from the beginning for someone else (signing in)', async () => {
    const { fetchFn, asked } = server({ 0: { games: [{ entry: won, ref: ID }], next: null, cursor: 3 } });
    const { s } = store();
    expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual(['friend-1']);
    expect(await pullPlayedGames('https://api.example', identity, 'account', s, fetchFn)).toEqual([]);
    expect(asked).toEqual([0, 0]);
  });

  it("keeps games from before this device's profile, so signing in on a new device brings every one (Issue 203)", async () => {
    const { fetchFn } = server({ 0: { games: [{ entry: won, ref: ID }, { entry: day, ref: '2026-10-31' }], next: null, cursor: 3 } });
    const { s, games } = store();
    // A profile made after both games, as on a fresh install that then signs in.
    expect(await pullPlayedGames('https://api.example', identity, 'account', s, fetchFn)).toEqual(['friend-1', 'daily-1']);
    expect(games.size).toBe(2);
  });

  it('reads from the start once on a device whose old place may have skipped games', async () => {
    localStorage.setItem('word-mastermind:played:v1', JSON.stringify({ who: 'account', cursor: 3 }));
    const { fetchFn, asked } = server({ 0: { games: [{ entry: won, ref: ID }], next: null, cursor: 3 } });
    const { s } = store();
    expect(await pullPlayedGames('https://api.example', identity, 'account', s, fetchFn)).toEqual(['friend-1']);
    expect(asked).toEqual([0]);
  });

  it("stops just before a game this version can't read, so it comes once the app is updated", async () => {
    const future = { ...won, id: 'future-1', mode: 'hologram' } as unknown as HistoryEntry;
    const { fetchFn, asked } = server({
      0: { games: [{ entry: won, ref: ID, seq: 4 }, { entry: future, ref: 'x', seq: 5 }, { entry: day, ref: '2026-10-31', seq: 6 }], next: null, cursor: 6 },
    } as never);
    const { s } = store();
    expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual(['friend-1']);
    await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn);
    expect(asked).toEqual([0, 4]);
  });

  describe('a game whose room does not answer (Dev Plan item 18zg)', () => {
    /** A server that passes over game 4 while `failing`, and gives it once asked for again after that. */
    function flaky() {
      const state = { failing: true };
      const asked: string[] = [];
      const fetchFn = (async (url: RequestInfo | URL) => {
        const params = new URL(String(url)).searchParams;
        const after = Number(params.get('after'));
        const retry = params.get('retry') ? params.get('retry')!.split(',').map(Number) : [];
        asked.push(`${after}:${retry.join(',')}:${params.get('skip')}`);
        const again = retry.includes(4);
        const body = after === 0
          ? { games: [{ entry: day, ref: '2026-10-31', seq: 5 }], next: null, cursor: 5, retried: [], retry: [4] }
          : {
            games: [], next: null, cursor: after,
            retried: again && !state.failing ? [{ entry: won, ref: ID, seq: 4 }] : [],
            retry: again && state.failing ? [4] : [],
          };
        return new Response(JSON.stringify(body));
      }) as typeof fetch;
      return { fetchFn, asked, state };
    }

    it('carries on past it, and brings it once its room answers', async () => {
      const { fetchFn, asked, state } = flaky();
      const { s } = store();
      expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual(['daily-1']);
      expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual([]);
      state.failing = false;
      expect(await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn)).toEqual(['friend-1']);
      await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn);
      // Asked for again on each pull until it came, leaving room to pass over fewer meanwhile.
      expect(asked).toEqual(['0::3', '5:4:2', '5:4:2', '5::3']);
    });

    it(`gives up on it after ${PLAYED_TRIES} pulls in a row`, async () => {
      const { fetchFn, asked } = flaky();
      const { s } = store();
      for (let i = 0; i < PLAYED_TRIES + 1; i += 1) await pullPlayedGames('https://api.example', identity, 'guest', s, fetchFn);
      expect(asked.filter((a) => a.startsWith('5:4:'))).toHaveLength(PLAYED_TRIES - 1);
      expect(asked.at(-1)).toBe('5::3');
    });
  });
});
