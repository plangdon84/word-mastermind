import { describe, expect, it } from 'vitest';
import { fakeD1 } from './fakeD1';
import { handle, type Env } from './index';
import { addressKey, limitOf } from './limits';

const API = 'https://api.example';

/** A rate limit binding that allows `limit` requests per key, and records the keys. */
function fakeLimit(limit: number) {
  const counts = new Map<string, number>();
  const binding: RateLimit = {
    limit: async ({ key }) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key)! <= limit };
    },
  };
  return { binding, counts };
}

function setup(env: Partial<Env> = {}) {
  const { db } = fakeD1();
  const fullEnv: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace,
    LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace,
    ALLOWED_ORIGINS: 'https://app.example', ...env,
  };
  const register = (id: string, address: string | null = '203.0.113.7') => handle(new Request(`${API}/api/guests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(address ? { 'cf-connecting-ip': address } : {}) },
    body: JSON.stringify({ id }),
  }), fullEnv, 0);
  return { register };
}

const guest = (n: number) => `0f8b6c2e-5d4a-4b1c-9e3f-${String(n).padStart(12, '0')}`;

describe('rate limits by address', () => {
  it('cover what makes something new or sends something out, never playing', () => {
    expect(limitOf('POST', '/api/reports')).toBe('strict');
    expect(limitOf('POST', '/api/auth/email')).toBe('strict');
    for (const path of ['/api/guests', '/api/games', '/api/lobbies', '/api/daily/start', '/api/auth/google',
      '/api/auth/link', '/api/auth/session', '/api/friends/add', '/api/friends/invite/peek', '/api/friends/invite/accept', '/api/friends/invite/reset', '/api/push/subscribe']) {
      expect(limitOf('POST', path)).toBe('general');
    }
    expect(limitOf('POST', `/api/games/${'a'.repeat(64)}/rematch`)).toBe('general');
    expect(limitOf('POST', `/api/games/${'a'.repeat(64)}/decline`)).toBe('general');
    for (const path of ['/api/history', '/api/games/abc/guess', '/api/daily/guess', '/api/lobbies/ABC123/guess', '/api/friends/remove']) {
      expect(limitOf('POST', path)).toBeNull();
    }
    expect(limitOf('GET', '/api/games')).toBeNull();
    // Opening a friend's profile can be a lot of work for the server (item 18cb); a page of their history isn't.
    expect(limitOf('GET', '/api/friends/profile')).toBe('general');
    expect(limitOf('GET', '/api/friends/profile/games')).toBeNull();
  });

  it('refuse an address over its limit with 429, whatever guest IDs it uses', async () => {
    const { binding, counts } = fakeLimit(2);
    const { register } = setup({ RATE_LIMIT: binding });
    expect((await register(guest(1))).status).toBe(200);
    expect((await register(guest(2))).status).toBe(200);
    const refused = await register(guest(3));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'too-many-requests' });
    // Another address has its own count.
    expect((await register(guest(4), '198.51.100.9')).status).toBe(200);
    expect([...counts.keys()]).toEqual(['203.0.113.7', '198.51.100.9']);
  });

  // An IPv6 home or phone gets a whole /64, so a new address each time mustn't get round the limit.
  it('count an IPv6 address by its /64', async () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64');
    expect(addressKey('2001:DB8:0000:0001:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:0:1::/64');
    expect(addressKey('2001:db8::5')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    // IPv4 written as IPv6 counts as its own IPv4 address, not one shared /64.
    expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('::FFFF:198.51.100.9')).toBe('198.51.100.9');
    // Only that form: an ordinary IPv6 address ending in dotted digits still counts by its /64.
    expect(addressKey('2001:db8::1.2.3.4')).toBe('2001:db8:0:0::/64');
    const { binding } = fakeLimit(1);
    const { register } = setup({ RATE_LIMIT: binding });
    expect((await register(guest(1), '2001:db8:0:1::1')).status).toBe(200);
    expect((await register(guest(2), '2001:db8:0:1::2')).status).toBe(429);
    expect((await register(guest(3), '2001:db8:0:2::1')).status).toBe(200);
  });

  it('limit nothing without the bindings or outside Cloudflare', async () => {
    const { register } = setup();
    for (let i = 0; i < 5; i++) expect((await register(guest(i))).status).toBe(200);
    const { binding } = fakeLimit(0);
    const noAddress = setup({ RATE_LIMIT: binding });
    expect((await noAddress.register(guest(9), null)).status).toBe(200);
  });
});
