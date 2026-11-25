import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeD1 } from './fakeD1';
import type { Env } from './index';

// The Durable Object classes use two of the Workers runtime's globals in their constructors and sockets.
vi.stubGlobal('WebSocketRequestResponsePair', class { constructor(readonly request: string, readonly response: string) {} });

const { DailyRush, THEME_KEPT_MS } = await import('./dailyRush');
const { GameRoom } = await import('./gameRoom');

/** Just enough of a Durable Object's state for these tests. */
function fakeState(storage: Partial<DurableObjectStorage>, sockets: { send: (message: string) => void }[] = []) {
  return {
    storage,
    blockConcurrencyWhile: <T>(work: () => Promise<T>) => work(),
    getWebSockets: () => sockets,
    setWebSocketAutoResponse: () => {},
    waitUntil: () => {},
  } as unknown as DurableObjectState;
}

afterEach(() => vi.useRealTimers());

describe("the day's object (Issue 301)", () => {
  it('reads a corrected theme again once it has kept the old one for a few minutes', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 25, 12) });
    const { db, sqlite } = fakeD1();
    const set = (theme: string) => sqlite.prepare(
      `INSERT INTO daily_themes (day, theme_id, theme, words) VALUES ('2026-11-25', 't', ?1, 'storm,beach,flame,quick')
       ON CONFLICT (day) DO UPDATE SET theme = excluded.theme`,
    ).run(theme);
    const daily = new DailyRush(fakeState({}), { DB: db } as unknown as Env);
    const themeFor = (daily as unknown as { deps: { themeFor: (day: string) => Promise<{ theme: string } | null> } })
      .deps.themeFor;
    expect(await themeFor('2026-11-25')).toBeNull();
    set('First');
    // A day with no theme isn't remembered, so the loaded one is found at once.
    expect((await themeFor('2026-11-25'))?.theme).toBe('First');
    set('Corrected');
    vi.advanceTimersByTime(THEME_KEPT_MS - 1);
    expect((await themeFor('2026-11-25'))?.theme).toBe('First');
    vi.advanceTimersByTime(1);
    expect((await themeFor('2026-11-25'))?.theme).toBe('Corrected');
  });
});

describe('a game room whose alarm fails (Issue 301)', () => {
  it('still tells open pages to look again', async () => {
    const sent: string[] = [];
    const storage = { get: () => Promise.reject(new Error('storage down')) };
    const room = new GameRoom(fakeState(storage, [{ send: (message) => sent.push(message) }]), {} as Env);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(room.alarm()).rejects.toThrow('storage down');
    errors.mockRestore();
    expect(sent).toEqual(['changed']);
  });
});
