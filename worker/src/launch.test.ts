import { describe, expect, it } from 'vitest';
import { lobbyApi, LobbyApiError } from '../../src/app/lobbyApi';
import { fakeD1 } from './fakeD1';
import { fakeLobbies } from './fakeLobbies';
import { handle, type Env } from './index';

/*
 * The launch switches (`src/game/features.ts`): the worker refuses what's
 * switched off for 1.0 with 404 `off`, whoever asks.
 */

const ANN = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const NOW = Date.UTC(2026, 9, 3, 18);

function setup() {
  const { db } = fakeD1();
  const none = undefined as unknown as DurableObjectNamespace;
  const env: Env = { DB: db, GAMES: none, DAILY: none, LOBBIES: fakeLobbies({ db, now: () => NOW }).namespace, QUEUES: none, ALLOWED_ORIGINS: '' };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init), env, NOW)) as typeof fetch;
  return { fetchFn };
}

async function refusal(response: Response) {
  return { status: response.status, error: ((await response.json()) as { error: string }).error };
}

describe('switched off for 1.0', () => {
  it('the matchmaking queue', async () => {
    const { fetchFn } = setup();
    for (const path of ['/api/queue', '/api/queue/poll', '/api/queue/leave']) {
      const response = await fetchFn(`https://api.example${path}`, {
        method: 'POST', headers: { 'x-guest-id': ANN, 'content-type': 'application/json' },
        body: JSON.stringify({ timeControl: '10m', difficulty: 'hard' }),
      });
      expect(await refusal(response)).toEqual({ status: 404, error: 'off' });
    }
  });

  it('the rating boards', async () => {
    const { fetchFn } = setup();
    const response = await fetchFn('https://api.example/api/leaderboards/ratings?pool=live-10&circle=everyone', { headers: { 'x-guest-id': ANN } });
    expect(await refusal(response)).toEqual({ status: 404, error: 'off' });
  });

  it('opening a Competitive Rush lobby, while Rush with Friends stays on', async () => {
    const { fetchFn } = setup();
    const lobbies = lobbyApi('https://api.example', { guestId: ANN, token: null }, fetchFn);
    const code = await lobbies.create('Ann', 'hard', 'storm').then(() => 'accepted', (e: LobbyApiError) => e.code);
    expect(code).toBe('off');
    expect((await lobbies.create('Ann', 'hard')).lobby.kind).toBe('friends');
  });
});
