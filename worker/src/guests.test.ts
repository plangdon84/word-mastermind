import { describe, expect, it } from 'vitest';
import { newId } from '../../src/app/ids';
import { fakeD1 } from './fakeD1';
import { handle, type Env } from './index';
import { isGuestId, registerGuest } from './guests';

const NOW = Date.UTC(2026, 8, 28);
const ID = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';

function register(env: Env, body: unknown, now = NOW) {
  return handle(new Request('https://api.example/api/guests', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), env, now);
}

describe('guest IDs', () => {
  it('accepts IDs devices create', () => {
    for (let i = 0; i < 20; i++) expect(isGuestId(newId())).toBe(true);
    expect(isGuestId(ID)).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of [undefined, null, 42, '', 'guest', ID.toUpperCase(), `${ID}0`, ID.replace('-4b1c', '-1b1c')]) {
      expect(isGuestId(value)).toBe(false);
    }
  });
});

describe('registering a guest', () => {
  it('stores the guest once and updates when they were last seen', async () => {
    const { db, sqlite } = fakeD1();
    expect(await registerGuest(db, ID, NOW)).toEqual({ id: ID, createdAt: NOW, lastSeenAt: NOW });
    expect(await registerGuest(db, ID, NOW + 1000)).toEqual({ id: ID, createdAt: NOW, lastSeenAt: NOW + 1000 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM guests').get()).toEqual({ n: 1 });
  });

  it('is served at POST /api/guests', async () => {
    const env = { DB: fakeD1().db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '' };
    const response = await register(env, { id: ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ID, createdAt: NOW, lastSeenAt: NOW });
  });

  it('refuses a bad ID or body', async () => {
    const env = { DB: fakeD1().db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '' };
    for (const body of [{ id: 'nope' }, {}, null, 'text']) {
      const response = await register(env, body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'bad-guest-id' });
    }
  });
});
