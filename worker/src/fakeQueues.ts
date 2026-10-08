// A stand-in for the QUEUES Durable Object namespace in tests: each queue
// gets in-memory storage, refereed by the same code as a real Matchmaker.
import { memoryStorage } from './fakeRooms';
import { json } from './http';
import type { Env } from './index';
import { queueDeps, type MatchmakerRequest } from './matchmaker';
import { handleQueue, type QueueRequest } from './queue';

export interface FakeQueuesOptions {
  /** The worker's bindings, for starting games; read when a game starts. */
  env: () => Env;
  /** The queues' clock. */
  now: () => number;
}

export function fakeQueues({ env, now }: FakeQueuesOptions) {
  const queues = new Map<string, ReturnType<typeof memoryStorage>>();
  const namespace = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: (id: { toString(): string }) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const key = id.toString();
        const storage = queues.get(key) ?? memoryStorage();
        queues.set(key, storage);
        const { timeControl, difficulty, ...request } = JSON.parse(init.body as string) as MatchmakerRequest;
        const { status, body } = await handleQueue(storage, queueDeps(env(), { timeControl, difficulty }), request as QueueRequest, now());
        return json(body, status);
      },
    }),
  };
  return { namespace: namespace as unknown as DurableObjectNamespace, queues };
}
