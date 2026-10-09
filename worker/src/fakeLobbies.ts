// A stand-in for the LOBBIES Durable Object namespace in tests: each join
// code gets in-memory storage, refereed by the same code as a real RushLobby.
import { memoryStorage } from './fakeRooms';
import { friendCodes } from './friends';
import { json } from './http';
import { handleLobby, handleLobbyAlarm, saveFinishedLobby, type LobbyDeps, type LobbyRequest } from './lobbyRoom';
import type { Notice } from './notices';

export interface FakeLobbiesOptions {
  db: D1Database;
  /** The lobbies' clock. */
  now: () => number;
  /** Picks the words. */
  random?: () => number;
}

export function fakeLobbies({ db, now, random = () => 0 }: FakeLobbiesOptions) {
  const lobbies = new Map<string, ReturnType<typeof memoryStorage>>();
  /** Every notification the lobbies sent, in order. */
  const notices: Notice[] = [];
  const deps: LobbyDeps = {
    random: () => random(),
    saveFinished: (lobby, endedAt) => saveFinishedLobby(db, lobby, endedAt),
    friendCodes: (accountId, ids) => friendCodes(db, accountId, ids),
    notify: (sent) => notices.push(...sent),
  };
  const namespace = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: (id: { toString(): string }) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const key = id.toString();
        const storage = lobbies.get(key) ?? memoryStorage();
        lobbies.set(key, storage);
        const request = JSON.parse(init.body as string) as LobbyRequest;
        const { status, body } = await handleLobby(storage, deps, request, now());
        return json(body, status);
      },
    }),
  };
  /** Runs every alarm that is due by the lobbies' clock, as Cloudflare would. */
  const runAlarms = async () => {
    for (const storage of lobbies.values()) {
      if (storage.alarm !== null && storage.alarm <= now()) {
        storage.alarm = null;
        await handleLobbyAlarm(storage, deps, now());
      }
    }
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, lobbies, runAlarms, notices };
}
