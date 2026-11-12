import { describe, expect, it, vi } from 'vitest';
import { GUESS_WORDS, SECRET_WORDS } from '../../src/game';
import { handle, type Env } from './index';

const env = {
  DB: undefined as unknown as D1Database, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace,
  ALLOWED_ORIGINS: 'https://app.example',
} satisfies Env;
const NOW = Date.UTC(2026, 8, 28);

describe('worker', () => {
  it('reports its health and bundled word lists', async () => {
    const response = await handle(new Request('https://api.example/api/health'), env, NOW);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, secretWords: SECRET_WORDS.length, guessWords: GUESS_WORDS.length,
    });
  });

  it('answers unknown routes with 404', async () => {
    const response = await handle(new Request('https://api.example/api/nope'), env, NOW);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not-found' });
  });

  it('adds CORS headers only for allowed origins', async () => {
    const allowed = await handle(
      new Request('https://api.example/api/health', { headers: { origin: 'https://app.example' } }), env, NOW);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example');
    const other = await handle(
      new Request('https://api.example/api/health', { headers: { origin: 'https://evil.example' } }), env, NOW);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers preflight requests', async () => {
    const response = await handle(new Request('https://api.example/api/health', {
      method: 'OPTIONS', headers: { origin: 'https://app.example' },
    }), env, NOW);
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-headers')).toContain('x-guest-id');
  });
});

describe('the route table (Dev Plan item 19zp)', () => {
  const ask = async (method: string, path: string) => {
    const response = await handle(new Request(`https://api.example${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) }), env, NOW);
    return [response.status, ((await response.json()) as { error?: string }).error ?? 'ok'];
  };

  it('identifies the player for every route that needs it, so one without a guest ID is refused', async () => {
    const id = 'a'.repeat(64);
    for (const [method, path] of [
      ['GET', '/api/auth/me'], ['POST', '/api/auth/delete'], ['GET', '/api/games'], ['POST', '/api/games'], ['GET', `/api/games/${id}`],
      ['POST', `/api/games/${id}/guess`], ['GET', '/api/daily'], ['POST', '/api/daily/guess'], ['GET', '/api/daily/word'],
      ['POST', '/api/daily/name'], ['POST', '/api/lobbies'], ['GET', '/api/lobbies/ABCDE'], ['GET', '/api/friends'],
      ['POST', '/api/friends/add'], ['GET', '/api/friends/profile'], ['POST', '/api/profile/shared'], ['POST', '/api/profile/index'],
      ['GET', '/api/profile'], ['POST', '/api/history'], ['GET', '/api/played'], ['GET', '/api/ratings'],
      ['GET', '/api/leaderboards/ratings'], ['POST', '/api/push/subscribe'], ['POST', '/api/push/unsubscribe'],
    ]) {
      expect(await ask(method, path), `${method} ${path}`).toEqual([400, 'bad-guest-id']);
    }
  });

  it('answers the open routes without a guest ID', async () => {
    expect(await ask('GET', '/api/health')).toEqual([200, 'ok']);
    expect(await ask('POST', '/api/guests')).toEqual([400, 'bad-guest-id']);
    expect(await ask('POST', '/api/words/check')).toEqual([400, 'bad-request']);
    expect(await ask('POST', '/api/auth/logout')).toEqual([200, 'ok']);
    expect(await ask('POST', '/api/auth/email')).toEqual([400, 'bad-email']);
    expect(await ask('GET', '/api/auth/nope')).toEqual([404, 'not-found']);
    expect(await ask('GET', '/api/push/key')).toEqual([404, 'push-off']);
    expect(await ask('GET', '/api/admin/figures')).toEqual([404, 'off']);
  });

  it("refuses a route's method or launch switch before asking who's there", async () => {
    expect(await ask('GET', '/api/profile/shared')).toEqual([405, 'bad-request']);
    expect(await ask('POST', '/api/played')).toEqual([405, 'bad-request']);
    expect(await ask('POST', '/api/ratings')).toEqual([405, 'bad-request']);
    expect(await ask('POST', '/api/leaderboards/ratings')).toEqual([405, 'bad-request']);
    expect(await ask('GET', '/api/leaderboards/nope')).toEqual([404, 'not-found']);
    expect(await ask('GET', '/api/push/subscribe')).toEqual([404, 'not-found']);
    expect(await ask('GET', '/api/queue')).toEqual([405, 'bad-request']);
    expect(await ask('POST', '/api/queue')).toEqual([400, 'bad-guest-id']);
    expect(await ask('GET', '/api/games/not-an-id/nope')).toEqual([404, 'not-found']);
    expect(await ask('POST', '/api/health')).toEqual([404, 'not-found']);
  });

  it('refuses the queue while its launch switch is off, before anything else', async () => {
    vi.resetModules();
    vi.doMock('../../src/game/features', async (original) => ({
      FEATURES: { ...(await original<typeof import('../../src/game/features')>()).FEATURES, randomOpponent: false },
    }));
    const fresh = await import('./index');
    for (const method of ['GET', 'POST']) {
      const answer = await fresh.handle(new Request('https://api.example/api/queue', { method }), env, NOW);
      expect([answer.status, ((await answer.json()) as { error: string }).error], method).toEqual([404, 'off']);
    }
    vi.doUnmock('../../src/game/features');
  });
});
