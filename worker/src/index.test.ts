import { describe, expect, it } from 'vitest';
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
