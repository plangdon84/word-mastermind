import { isObject } from '../../src/game';
import { identify } from './accounts';
import { registerGuest } from './guests';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import { deleteSubscription, parseSubscription, saveSubscription, type VapidKeys } from './push';

/** The server's VAPID keys, or null if turn notifications aren't set up for this environment. */
export function vapidKeysOf(env: Env): VapidKeys | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/**
 * `/api/push/…`: the public key the app subscribes with, and turning a
 * device's turn notifications on (`subscribe`) or off (`unsubscribe`).
 * Returns null for any other path.
 */
export async function routePush(request: Request, env: Env, now: number, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith('/api/push/')) return null;
  const keys = vapidKeysOf(env);
  if (pathname === '/api/push/key' && request.method === 'GET') {
    return keys ? json({ publicKey: keys.publicKey }) : errorResponse(404, 'push-off');
  }
  if (request.method !== 'POST') return errorResponse(404, 'not-found');
  // Turn alerts belong to the device (its guest ID), which reach its account's games once it signs in.
  const who = await identify(request, env.DB, now);
  if (!who.ok) return errorResponse(who.status, who.error);
  const guestId = who.player.deviceId;
  const body = await readJson(request);
  if (pathname === '/api/push/subscribe') {
    if (!keys) return errorResponse(404, 'push-off');
    const subscription = parseSubscription(body);
    if (!subscription) return errorResponse(400, 'bad-request');
    await registerGuest(env.DB, guestId, now);
    await saveSubscription(env.DB, guestId, subscription, now);
    return json({ ok: true });
  }
  if (pathname === '/api/push/unsubscribe') {
    if (!isObject(body) || typeof body.endpoint !== 'string') return errorResponse(400, 'bad-request');
    await deleteSubscription(env.DB, guestId, body.endpoint);
    return json({ ok: true });
  }
  return errorResponse(404, 'not-found');
}
