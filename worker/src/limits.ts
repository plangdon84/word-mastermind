import { errorResponse } from './http';
import type { Env } from './index';

/*
 * Rate limits by internet address (security review, Dev Plan item 15). A
 * device makes up its own guest ID, so a limit per guest ID can be got
 * round with a new one; these count per address instead, with Cloudflare's
 * rate limiting bindings (wrangler.toml `ratelimits`). They're generous,
 * since a household or a phone network can share one address, and they
 * only cover what makes something new or sends something out: playing a
 * game never counts, nor does syncing history (accounts only, and capped
 * per account), whose first upload can be many requests. Without the bindings (tests, older configs) nothing is
 * limited.
 */

/** Which limit a request counts against: `general` (30 a minute) or `strict` (3 a minute). */
export type Limit = 'general' | 'strict';

/** What each limited request counts against; anything else isn't limited. */
export function limitOf(method: string, pathname: string): Limit | null {
  if (method !== 'POST') return null;
  if (pathname === '/api/reports' || pathname === '/api/auth/email') return 'strict';
  if (/^\/api\/(guests|games|lobbies|daily\/start|auth\/google|auth\/link|auth\/session|friends\/add|friends\/invite\/(?:peek|accept|reset)|push\/subscribe)$/.test(pathname)) {
    return 'general';
  }
  // A rematch makes a game and a decline sends a notification, like a new invite.
  if (/^\/api\/games\/[0-9a-f]{64}\/(?:rematch|decline)$/.test(pathname)) return 'general';
  return null;
}

/**
 * Who a request came from, for counting: its IPv4 address, or for IPv6 the
 * first half of its address (the /64 one home or phone gets, which holds
 * billions of addresses, so a script could otherwise use a new one each
 * time). Null outside Cloudflare.
 */
export function addressOf(request: Request): string | null {
  const address = request.headers.get('cf-connecting-ip');
  return address === null ? null : addressKey(address);
}

/**
 * An address as `addressOf` counts it: IPv4 as it is, IPv6 as its /64
 * (`2001:db8:0:1::/64`), and an IPv4 address written as IPv6
 * (`::ffff:203.0.113.7`) as the IPv4 address, not the /64 they'd all share.
 */
export function addressKey(address: string): string {
  if (!address.includes(':')) return address;
  const ipv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (ipv4) return ipv4[1];
  const [head, tail] = address.toLowerCase().split('::');
  const front = head ? head.split(':') : [];
  const back = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? front : [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** A 429 if this request is over its limit, or null to go ahead. */
export async function overLimit(request: Request, env: Env, pathname: string): Promise<Response | null> {
  const limit = limitOf(request.method, pathname);
  if (!limit) return null;
  const binding = limit === 'strict' ? env.RATE_LIMIT_STRICT : env.RATE_LIMIT;
  const address = addressOf(request);
  if (!binding || !address) return null;
  const { success } = await binding.limit({ key: address });
  return success ? null : errorResponse(429, 'too-many-requests');
}
