import { describe, expect, it } from 'vitest';
import { fakeD1 } from './fakeD1';
import { handle, type Env } from './index';
import {
  encryptPayload, fromBase64Url, isPushEndpoint, notifyGuest, parseSubscription, sendPush, toBase64Url, topicOf,
  vapidAuthorization, type VapidKeys,
} from './push';

const NOW = Date.UTC(2026, 8, 28);
const GUEST = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';
const ecdh = { name: 'ECDH', namedCurve: 'P-256' };
const encoder = new TextEncoder();

const raw = async (key: CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key) as ArrayBuffer);

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: string | Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const infoBytes = typeof info === 'string' ? encoder.encode(info) : info;
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: infoBytes }, key, bytes * 8));
}

/** A device: its key pair and auth secret, as a browser makes them. */
async function device() {
  const pair = await crypto.subtle.generateKey(ecdh, true, ['deriveBits']) as CryptoKeyPair;
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, keys: { p256dh: toBase64Url(await raw(pair.publicKey)), auth: toBase64Url(auth) }, auth };
}

/** Decrypts as the device would (RFC 8291, receiving side). */
async function decrypt(body: Uint8Array, d: Awaited<ReturnType<typeof device>>): Promise<string> {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLength = body[20];
  const asPublic = body.slice(21, 21 + idLength);
  const sealed = body.slice(21 + idLength);
  expect(recordSize).toBeGreaterThanOrEqual(sealed.length);
  const asKey = await crypto.subtle.importKey('raw', asPublic, ecdh, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: asKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, d.pair.privateKey, 256));
  const uaPublic = await raw(d.pair.publicKey);
  const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(d.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = await hkdf(salt, ikm, 'Content-Encoding: nonce\0', 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));
  expect(plain[plain.length - 1]).toBe(2);
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function vapidKeys(): Promise<VapidKeys & { verifyKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey;
  return {
    publicKey: toBase64Url(await raw(pair.publicKey)), privateKey: jwk.d!, subject: 'https://app.example',
    verifyKey: pair.publicKey,
  };
}

describe('encryptPayload', () => {
  it('encrypts a message only the device can read', async () => {
    const d = await device();
    const body = await encryptPayload(encoder.encode('{"title":"Your turn"}'), d.keys);
    expect(await decrypt(body, d)).toBe('{"title":"Your turn"}');
    // Each message has its own salt and server key.
    const again = await encryptPayload(encoder.encode('{"title":"Your turn"}'), d.keys);
    expect(toBase64Url(again)).not.toBe(toBase64Url(body));
  });

  it("can't be read with another device's keys", async () => {
    const [d, other] = [await device(), await device()];
    const body = await encryptPayload(encoder.encode('secret'), d.keys);
    await expect(decrypt(body, { ...other, auth: d.auth })).rejects.toThrow();
  });
});

describe('vapidAuthorization', () => {
  it('signs a JWT for the push service, with the public key', async () => {
    const keys = await vapidKeys();
    const header = await vapidAuthorization(ENDPOINT, keys, NOW);
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(k).toBe(keys.publicKey);
    const [head, claims, signature] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(head)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(new TextDecoder().decode(fromBase64Url(claims)))).toEqual({
      aud: 'https://fcm.googleapis.com', exp: NOW / 1000 + 12 * 60 * 60, sub: 'https://app.example',
    });
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.verifyKey,
      fromBase64Url(signature), encoder.encode(`${head}.${claims}`));
    expect(valid).toBe(true);
  });
});

describe('subscriptions', () => {
  it('only go to known push services', () => {
    expect(isPushEndpoint(ENDPOINT)).toBe(true);
    expect(isPushEndpoint('https://web.push.apple.com/QGuL')).toBe(true);
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/x')).toBe(false);
    expect(isPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isPushEndpoint('https://fcm.googleapis.com.evil.example/')).toBe(false);
    expect(isPushEndpoint('not a url')).toBe(false);
  });

  it('are read from what the browser gives', async () => {
    const d = await device();
    expect(parseSubscription({ endpoint: ENDPOINT, expirationTime: null, keys: d.keys })).toEqual({ endpoint: ENDPOINT, ...d.keys });
    expect(parseSubscription({ endpoint: ENDPOINT, keys: { ...d.keys, auth: 'AAAA' } })).toBeNull();
    expect(parseSubscription({ endpoint: 'https://evil.example/', keys: d.keys })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe('sending', () => {
  it('posts the encrypted message to the push service', async () => {
    const [d, keys] = [await device(), await vapidKeys()];
    let sent: Request | null = null;
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Request(input, init);
      return new Response(null, { status: 201 });
    }) as typeof fetch;
    const gameId = 'c'.repeat(64);
    const result = await sendPush({ endpoint: ENDPOINT, ...d.keys }, { title: 'Your turn against Ann', body: 'Ann guessed CRANE – 2.', gameId }, keys, NOW, fetchFn);
    expect(result).toBe('sent');
    const request = sent! as Request;
    expect(request.url).toBe(ENDPOINT);
    expect(request.headers.get('content-encoding')).toBe('aes128gcm');
    expect(request.headers.get('ttl')).toBe('86400');
    // The push service sees the topic, so it never carries the game's ID (a credential), only a hash of it.
    const topic = request.headers.get('topic')!;
    expect(topic).toBe(await topicOf(gameId));
    expect(topic).toMatch(/^[\w-]{32}$/);
    expect(gameId).not.toContain(topic.slice(0, 8));
    expect(await topicOf('d'.repeat(64))).not.toBe(topic);
    const payload = JSON.parse(await decrypt(new Uint8Array(await request.arrayBuffer()), d));
    expect(payload).toEqual({ title: 'Your turn against Ann', body: 'Ann guessed CRANE – 2.', tag: gameId, url: `/?game=${gameId}` });
  });

  it("forgets a device the push service says is gone, and keeps the others", async () => {
    const { db, sqlite } = fakeD1();
    sqlite.exec(`INSERT INTO guests (id, created_at, last_seen_at) VALUES ('${GUEST}', 0, 0)`);
    const [a, b, keys] = [await device(), await device(), await vapidKeys()];
    const gone = 'https://fcm.googleapis.com/fcm/send/gone';
    for (const [endpoint, d] of [[ENDPOINT, a], [gone, b]] as const) {
      sqlite.prepare('INSERT INTO push_subscriptions VALUES (?, ?, ?, ?, 0)').run(endpoint, GUEST, d.keys.p256dh, d.keys.auth);
    }
    const fetchFn = (async (input: RequestInfo | URL) =>
      new Response(null, { status: String(input) === gone ? 410 : 201 })) as typeof fetch;
    await notifyGuest(db, keys, GUEST, { title: 't', body: 'b', gameId: 'c'.repeat(64) }, NOW, fetchFn);
    expect(sqlite.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([{ endpoint: ENDPOINT }]);
  });
});

describe('the push routes', () => {
  async function setup(withKeys = true) {
    const { db, sqlite } = fakeD1();
    const keys = await vapidKeys();
    const env: Env = {
      DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: '',
      ...(withKeys ? { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: keys.subject } : {}),
    };
    const call = (method: string, path: string, body?: unknown) => handle(new Request(`https://api.example${path}`, {
      method, headers: { 'x-guest-id': GUEST }, body: body === undefined ? undefined : JSON.stringify(body),
    }), env, NOW);
    return { sqlite, keys, call };
  }

  it('give the public key to subscribe with', async () => {
    const { keys, call } = await setup();
    expect(await (await call('GET', '/api/push/key')).json()).toEqual({ publicKey: keys.publicKey });
  });

  it('say so when turn notifications are off', async () => {
    const { call } = await setup(false);
    const response = await call('GET', '/api/push/key');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'push-off' });
  });

  it("turn a device's notifications on and off", async () => {
    const { sqlite, call } = await setup();
    const d = await device();
    expect((await call('POST', '/api/push/subscribe', { endpoint: ENDPOINT, keys: d.keys })).status).toBe(200);
    expect(sqlite.prepare('SELECT guest_id, p256dh FROM push_subscriptions').all()).toEqual([{ guest_id: GUEST, p256dh: d.keys.p256dh }]);
    expect((await call('POST', '/api/push/subscribe', { endpoint: 'https://evil.example/', keys: d.keys })).status).toBe(400);
    expect((await call('POST', '/api/push/unsubscribe', { endpoint: ENDPOINT })).status).toBe(200);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get()).toEqual({ n: 0 });
  });
});
