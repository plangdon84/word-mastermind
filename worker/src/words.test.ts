import { describe, expect, it } from 'vitest';
import { handle, type Env } from './index';
import { parseWordCheck } from './words';

const env = { DB: undefined as unknown as D1Database, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '' } satisfies Env;

async function check(body: unknown) {
  const response = await handle(new Request('https://api.example/api/words/check', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), env, 0);
  return { status: response.status, body: await response.json() };
}

describe('checking words on the server', () => {
  it('accepts valid words, normalized as the app does', async () => {
    expect(await check({ kind: 'secret', word: ' Beach ' })).toEqual({ status: 200, body: { ok: true, word: 'beach' } });
    expect(await check({ kind: 'guess', word: 'bunny' })).toEqual({ status: 200, body: { ok: true, word: 'bunny' } });
  });

  it('gives the same reasons as the app for invalid words', async () => {
    expect((await check({ kind: 'secret', word: 'bunny' })).body).toEqual({ ok: false, error: 'repeated-letters' });
    expect((await check({ kind: 'guess', word: 'four' })).body).toEqual({ ok: false, error: 'wrong-length' });
    expect((await check({ kind: 'guess', word: 'ab-cd' })).body).toEqual({ ok: false, error: 'not-letters' });
    expect((await check({ kind: 'guess', word: 'qzxvj' })).body).toEqual({ ok: false, error: 'not-in-word-list' });
  });

  it('refuses a malformed request', async () => {
    for (const body of [null, {}, { kind: 'secret' }, { kind: 'other', word: 'beach' }, { kind: 'guess', word: 5 }]) {
      expect(await check(body)).toEqual({ status: 400, body: { error: 'bad-request' } });
    }
    expect(parseWordCheck({ kind: 'guess', word: 'a'.repeat(65) })).toBeNull();
  });
});
