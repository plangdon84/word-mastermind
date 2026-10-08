import { describe, expect, it } from 'vitest';
import { localSource, remoteSource } from '../../src/app/gameSource';
import { handle } from './index';

/** A fetch that answers from the worker itself, in process. */
const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  handle(new Request(input, init), { DB: undefined as unknown as D1Database, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '' }, 0)) as typeof fetch;

describe("the app's remote game source against the worker", () => {
  it('gives the same word checks as the local source', async () => {
    const remote = remoteSource('https://api.example', { guestId: '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41', token: null }, workerFetch);
    const cases = [['secret', 'Beach'], ['secret', 'bunny'], ['guess', 'bunny'], ['guess', 'four'], ['guess', 'qzxvj']] as const;
    for (const [kind, word] of cases) {
      expect(await remote.checkWord(kind, word)).toEqual(await localSource.checkWord(kind, word));
    }
  });
});
