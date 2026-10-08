/*
 * Web Push (README "Two player vs. a friend"): turn notifications sent to
 * the push service of each device that turned them on (Google's for Chrome,
 * Apple's for Safari, and so on), which delivers them even when the game
 * isn't open. Messages are encrypted for the device (RFC 8291) and signed
 * with the server's VAPID key (RFC 8292), using WebCrypto only.
 */

/** What a notification says. The app's service worker (`public/sw.js`) shows it. */
export interface PushMessage {
  title: string;
  body: string;
  /** The game it's about: tapping the notification opens it, and a newer one replaces it. */
  gameId: string;
  /** Where tapping it goes, if not the game against a friend `gameId` names (`/?game=…`). */
  url?: string;
}

/** A device's push subscription, as the browser's `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionKeys {
  endpoint: string;
  /** The device's public key (P-256, uncompressed), base64url. */
  p256dh: string;
  /** The device's authentication secret (16 bytes), base64url. */
  auth: string;
}

/** The server's VAPID key pair, from `npm run vapid-keys`. */
export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (VAPID_PUBLIC_KEY). */
  publicKey: string;
  /** The private key's `d`, base64url (VAPID_PRIVATE_KEY, a secret). */
  privateKey: string;
  /** Who runs the server, for the push services: a `mailto:` or `https:` URL. */
  subject: string;
}

/**
 * Push services the server will send to. A subscription's endpoint is where
 * the server posts, so it must be a real push service, not any address a
 * request names.
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge on Android, most Chromium browsers
  'updates.push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari (web.push.apple.com)
  'notify.windows.com', // Edge on Windows
];

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** HKDF-SHA-256 (extract and expand) to `bytes` bytes. */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** The record size in the header. A payload of one record just has to fit in it. */
const RECORD_SIZE = 4096;

/**
 * Encrypts `payload` for one device (RFC 8291, the `aes128gcm` content
 * coding of RFC 8188, as a single record). `salt` and `serverKeys` are
 * random unless a test fixes them.
 */
export async function encryptPayload(
  payload: Uint8Array,
  keys: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>,
  salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
  serverKeys?: CryptoKeyPair,
): Promise<Uint8Array> {
  if (payload.length + 1 + 16 > RECORD_SIZE) throw new Error('Push payload too long for one record');
  const uaPublic = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' };
  const pair = serverKeys ?? await crypto.subtle.generateKey(ecdh, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ecdh, false, []);
  // The standard's `public` (Cloudflare's types spell it `$public`).
  const agreement = { name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(agreement, pair.privateKey, 256));

  const keyInfo = concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);

  // One record: the payload, then the delimiter 0x02 marking the last record.
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, concat(payload, Uint8Array.of(2))));

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, sealed);
}

/**
 * The VAPID `Authorization` header for a push to `endpoint`: a JWT signed
 * with the server's key, valid for 12 hours.
 */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now: number): Promise<string> {
  const publicKey = fromBase64Url(keys.publicKey);
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', d: keys.privateKey,
    x: toBase64Url(publicKey.slice(1, 33)), y: toBase64Url(publicKey.slice(33, 65)),
  };
  const signingKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const json = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const claims = { aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: keys.subject };
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json(claims)}`;
  // WebCrypto's ECDSA signature is r ‖ s, which is what a JWT's ES256 wants.
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, signingKey, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

/** A message's `Topic` header: at most 32 URL-safe base64 characters (RFC 8030), from a hash of its game. */
export async function topicOf(gameId: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`topic:${gameId}`)))).slice(0, 32);
}

/** How long a push service keeps trying to deliver a message: a day, then it's stale. */
const TTL_SECONDS = 24 * 60 * 60;

/**
 * Sends one message to one device. Returns 'gone' if the push service says
 * the subscription no longer exists (the device turned alerts off, or the
 * browser dropped it), so it can be deleted.
 */
export async function sendPush(
  subscription: PushSubscriptionKeys, message: PushMessage, keys: VapidKeys, now: number,
  fetchFn: typeof fetch = fetch,
): Promise<'sent' | 'gone' | 'failed'> {
  const payload = encoder.encode(JSON.stringify({
    title: message.title, body: message.body, tag: message.gameId, url: message.url ?? `/?game=${message.gameId}`,
  }));
  const response = await fetchFn(subscription.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuthorization(subscription.endpoint, keys, now),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(TTL_SECONDS),
      urgency: 'high',
      // A newer message about the same game replaces one not yet delivered. The push service sees the
      // topic, and a friend game's ID is a credential, so it gets a hash of the ID instead.
      topic: await topicOf(message.gameId),
    },
    body: await encryptPayload(payload, subscription),
  });
  if (response.status === 404 || response.status === 410) return 'gone';
  return response.ok ? 'sent' : 'failed';
}

/** Most devices a guest can have turn alerts on; the oldest goes first. */
export const MAX_SUBSCRIPTIONS = 10;

export async function saveSubscription(db: D1Database, guestId: string, sub: PushSubscriptionKeys, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO push_subscriptions (endpoint, guest_id, p256dh, auth, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (endpoint) DO UPDATE SET guest_id = excluded.guest_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).bind(sub.endpoint, guestId, sub.p256dh, sub.auth, now).run();
  await db.prepare(
    `DELETE FROM push_subscriptions WHERE guest_id = ?1 AND endpoint NOT IN
       (SELECT endpoint FROM push_subscriptions WHERE guest_id = ?1 ORDER BY created_at DESC LIMIT ?2)`,
  ).bind(guestId, MAX_SUBSCRIPTIONS).run();
}

export async function deleteSubscription(db: D1Database, guestId: string, endpoint: string): Promise<void> {
  await db.prepare('DELETE FROM push_subscriptions WHERE guest_id = ?1 AND endpoint = ?2').bind(guestId, endpoint).run();
}

/**
 * Sends a message to every device the guest turned alerts on for, and, once
 * they've signed in, every device of their account, forgetting any that are
 * gone.
 */
export async function notifyGuest(
  db: D1Database, keys: VapidKeys, guestId: string, message: PushMessage, now: number, fetchFn: typeof fetch = fetch,
): Promise<void> {
  const { results } = await db.prepare(
    `SELECT endpoint, p256dh, auth, guest_id FROM push_subscriptions WHERE guest_id = ?1 OR guest_id IN
       (SELECT id FROM guests WHERE account_id = (SELECT account_id FROM guests WHERE id = ?1))`,
  ).bind(guestId).all<PushSubscriptionKeys & { guest_id: string }>();
  await Promise.all(results.map(async ({ guest_id: owner, ...sub }) => {
    const sent = await sendPush(sub, message, keys, now, fetchFn).catch(() => 'failed' as const);
    if (sent === 'gone') await deleteSubscription(db, owner, sub.endpoint);
  }));
}

/** Reads a subscription from a request body defensively. */
export function parseSubscription(body: unknown): PushSubscriptionKeys | null {
  if (typeof body !== 'object' || body === null) return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== 'string' || endpoint.length > 1024 || !isPushEndpoint(endpoint)) return null;
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  const base64Url = /^[A-Za-z0-9_-]+$/;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !base64Url.test(p256dh) || !base64Url.test(auth)) {
    return null;
  }
  if (fromBase64Url(p256dh).length !== 65 || fromBase64Url(auth).length !== 16) return null;
  return { endpoint, p256dh, auth };
}
