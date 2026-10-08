// A stand-in for the GAMES Durable Object namespace in tests: each game ID
// gets an in-memory room, refereed by the same code as a real GameRoom.
import { json } from './http';
import type { Notice } from './notices';
import { ratingPool } from '../../src/game';
import { ratingsOf } from './ratings';
import { currentNames } from './sync';
import { handleAlarm, handleRoom, saveFinishedGame, type RoomDeps, type RoomRequest, type RoomStorage } from './room';

/** In-memory storage with the Durable Object storage calls the room uses, and its alarm. */
export function memoryStorage(): RoomStorage & { data: Map<string, unknown>; alarm: number | null } {
  const data = new Map<string, unknown>();
  const storage = {
    data,
    alarm: null as number | null,
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async <T>(key: string, value: T) => {
      data.set(key, structuredClone(value));
    },
    setAlarm: async (time: number) => {
      storage.alarm = time;
    },
    deleteAlarm: async () => {
      storage.alarm = null;
    },
  };
  return storage;
}

export interface FakeRoomsOptions {
  db: D1Database;
  /** The rooms' clock. */
  now: () => number;
  /** Who goes first: below 0.5 the host. */
  random?: () => number;
}

export function fakeRooms({ db, now, random = () => 0 }: FakeRoomsOptions) {
  const rooms = new Map<string, ReturnType<typeof memoryStorage>>();
  let next = 0;
  const idOf = (hex: string) => ({ toString: () => hex, equals: (other: { toString(): string }) => other.toString() === hex });
  const namespace = {
    newUniqueId: () => idOf((++next).toString(16).padStart(64, 'a')),
    idFromString: (hex: string) => idOf(hex),
    get: (id: { toString(): string }) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const key = id.toString();
        const storage = rooms.get(key) ?? memoryStorage();
        rooms.set(key, storage);
        const request = JSON.parse(init.body as string) as RoomRequest;
        const { status, body } = await handleRoom(storage, deps, request, now());
        return json(body, status);
      },
    }),
  };
  /** Every notification the rooms sent, in order. */
  const notices: Notice[] = [];
  const deps: RoomDeps = {
    saveFinished: saveFinishedGame.bind(null, db), random,
    namesOf: (ids) => currentNames(db, ids),
    ratingsOf: (players, control, at) => ratingsOf(db, players, ratingPool(control), at),
    notify: (sent: readonly Notice[]) => notices.push(...sent),
  };
  /** Runs every alarm that is due by the rooms' clock, as Cloudflare would. */
  const runAlarms = async () => {
    for (const storage of rooms.values()) {
      if (storage.alarm !== null && storage.alarm <= now()) {
        storage.alarm = null;
        await handleAlarm(storage, deps, now());
      }
    }
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, rooms, runAlarms, notices };
}
