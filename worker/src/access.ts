/*
 * Cloudflare Access (Dev Plan item 18m): the usage dashboard sits behind an
 * Access application, which asks for an allowed email and a one-time code
 * before the page loads, then signs a token (a JWT) that comes with each
 * request to it. The page's Pages Function passes that token on, and the
 * worker checks it here itself, so the figures can't be reached around
 * Access: anyone can send a header, but only Access can sign one.
 *
 * Checked: RS256, signed by one of the team's current keys
 * (`https://TEAM.cloudflareaccess.com/cdn-cgi/access/certs`), issued by that
 * team, for the dashboard's application (its AUD tag) and not expired.
 */

/** The header Access adds, and the Pages Function passes on. */
export const ACCESS_HEADER = 'cf-access-jwt-assertion';

/** The settings: the team's domain (`TEAM.cloudflareaccess.com`) and the application's AUD tag. */
export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

/** Leeway for clocks a little apart, in seconds. */
const LEEWAY = 60;
/** How long the team's keys are kept before they're fetched again (Access rotates them every 6 weeks). */
const KEYS_FOR_MS = 60 * 60 * 1000;
/** A token with a key not among them fetches them again, but not more often than this, so made-up tokens can't make it fetch on every request. */
const REFETCH_MS = 5 * 60 * 1000;

interface Jwk extends JsonWebKey {
  kid?: string;
}

let keys: { teamDomain: string; at: number; byKid: Map<string, CryptoKey> } | null = null;

/** Forgets the fetched keys (tests). */
export function forgetAccessKeys(): void {
  keys = null;
}

/** The team's domain as a bare host, whatever form it was set in (`team`, `team.cloudflareaccess.com` or a URL). */
export function teamHost(teamDomain: string): string {
  const host = teamDomain.trim().replace(/^https:\/\//, '').replace(/\/.*$/, '').toLowerCase();
  return host.includes('.') ? host : `${host}.cloudflareaccess.com`;
}

async function teamKeys(config: AccessConfig, now: number, fetchFn: typeof fetch, refresh: boolean): Promise<Map<string, CryptoKey>> {
  if (keys && keys.teamDomain === config.teamDomain && now - keys.at < (refresh ? REFETCH_MS : KEYS_FOR_MS)) return keys.byKid;
  const response = await fetchFn(`https://${teamHost(config.teamDomain)}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access keys: ${response.status}`);
  const body = await response.json() as { keys?: Jwk[] };
  const byKid = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
    const { kid, ...key } = jwk;
    byKid.set(kid, await crypto.subtle.importKey(
      'jwk', { kty: key.kty, n: key.n, e: key.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    ));
  }
  keys = { teamDomain: config.teamDomain, at: now, byKid };
  return byKid;
}

function base64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function jsonPart(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64url(text)));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Whether `token` is a valid Access token for this application at `now`
 * (ms). A key the worker hasn't seen yet
 * (Access rotated them) fetches the keys again once.
 */
export async function verifyAccessToken(
  token: string, config: AccessConfig, now: number, fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[\w-]+$/.test(p))) return false;
  const header = jsonPart(parts[0]);
  const claims = jsonPart(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return false;
  let key = (await teamKeys(config, now, fetchFn, false)).get(header.kid);
  key ??= (await teamKeys(config, now, fetchFn, true)).get(header.kid);
  if (!key) return false;
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64url(parts[2]), signed)) return false;
  const seconds = now / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${teamHost(config.teamDomain)}` || !aud.includes(config.aud)) return false;
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY < seconds) return false;
  if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY > seconds) return false;
  return true;
}
