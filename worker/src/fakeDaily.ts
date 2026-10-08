// A stand-in for the DAILY Durable Object namespace in tests: each day gets
// in-memory storage, refereed by the same code as a real DailyRush.
import { HISTORY_VERSION } from '../../src/game';
import { handleDaily, saveFinishedDaily, type DailyDeps, type DailyRequest } from './dailyRoom';
import { themeFor } from './dailyThemes';
import { memoryStorage } from './fakeRooms';
import { json } from './http';

/** `random` orders each player's words; always 0 (the default) keeps the theme's order. */
export function fakeDaily({ db, now, random = () => 0 }: { db: D1Database; now: () => number; random?: () => number }) {
  const days = new Map<string, ReturnType<typeof memoryStorage>>();
  const deps: DailyDeps = {
    saveFinished: (day, entry, totals, late, at) => saveFinishedDaily(db, day, entry, totals, late, HISTORY_VERSION, at),
    random,
    themeFor: (day) => themeFor(db, day),
  };
  const namespace = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: (id: { toString(): string }) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const key = id.toString();
        const storage = days.get(key) ?? memoryStorage();
        days.set(key, storage);
        const request = JSON.parse(init.body as string) as DailyRequest;
        const { status, body } = await handleDaily(storage, deps, request, now());
        return json(body, status);
      },
    }),
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, days };
}
