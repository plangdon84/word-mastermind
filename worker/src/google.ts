import { hashToken, newToken } from './accounts';
import type { Env } from './index';
import { fromBase64Url, toBase64Url } from './push';

/*
 * Signing in with Google (OpenID Connect, the authorization code flow with
 * PKCE). The app never loads anything from Google: it sends the browser to
 * Google's sign-in page, Google sends it back to the worker's callback, and
 * the worker asks Google for the person's ID token directly, then sends the
 * browser back to the app with a one-use sign-in link, as an email would.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** How long someone has on Google's page before the sign-in must start again. */
export const STATE_MS = 10 * 60 * 1000;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

/** This environment's Google client, or null if Google sign-in is off. */
export function googleConfigOf(env: Env): GoogleConfig | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = env;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Where Google sends the browser back to: this worker's callback. */
export const redirectUriOf = (requestUrl: string) => `${new URL(requestUrl).origin}/api/auth/google/callback`;

const challengeOf = async (verifier: string) =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

/**
 * Starts a Google sign-in for the app at `returnTo` on the device whose
 * guest ID is `guestId`: remembers both, and returns the address of
 * Google's sign-in page. Only that device can use the sign-in link it ends
 * in, so a link someone else made can't sign your device in to their account.
 */
export async function startGoogle(
  db: D1Database, config: GoogleConfig, redirectUri: string, returnTo: string, guestId: string, now: number,
): Promise<string> {
  await db.prepare('DELETE FROM oauth_states WHERE expires_at < ?1').bind(now).run();
  const state = newToken();
  const verifier = newToken();
  await db.prepare('INSERT INTO oauth_states (state_hash, verifier, return_to, guest_id, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(await hashToken(state), verifier, returnTo, guestId, now + STATE_MS).run();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export interface GoogleIdentity {
  email: string;
  sub: string;
}

/**
 * Reads the claims Google vouches for from an ID token. It came straight
 * from Google's token endpoint over TLS, so its signature needn't be checked
 * (OpenID Connect Core 3.1.3.7), but who it's for and when it ends are.
 */
export function parseIdToken(idToken: unknown, clientId: string, now: number): GoogleIdentity | null {
  if (typeof idToken !== 'string') return null;
  const [, payload] = idToken.split('.');
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload ?? ''))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof claims !== 'object' || claims === null) return null;
  const { iss, aud, exp, sub, email, email_verified: verified } = claims;
  if (!GOOGLE_ISSUERS.includes(iss as string) || aud !== clientId) return null;
  if (typeof exp !== 'number' || exp * 1000 <= now) return null;
  if (typeof sub !== 'string' || sub === '' || typeof email !== 'string' || verified !== true) return null;
  return { email: email.toLowerCase(), sub };
}

/**
 * Finishes a Google sign-in from the callback's query. Null if the state is
 * unknown or stale (nowhere to send the browser back to); otherwise the
 * app's origin, the guest ID of the device that started it, and who signed
 * in, or null there if they cancelled or Google refused.
 */
export async function finishGoogle(
  db: D1Database, config: GoogleConfig, redirectUri: string, query: URLSearchParams, now: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ returnTo: string; guestId: string | null; identity: GoogleIdentity | null } | null> {
  const state = query.get('state');
  if (!state) return null;
  const row = await db.prepare(
    'DELETE FROM oauth_states WHERE state_hash = ?1 AND expires_at > ?2 RETURNING verifier, return_to, guest_id',
  ).bind(await hashToken(state), now).first<{ verifier: string; return_to: string; guest_id: string | null }>();
  if (!row) return null;
  const started = { returnTo: row.return_to, guestId: row.guest_id };
  const code = query.get('code');
  if (!code) return { ...started, identity: null };
  const response = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: row.verifier,
    }),
  }).catch(() => null);
  const tokens = response?.ok ? await response.json<{ id_token?: unknown }>().catch(() => null) : null;
  return { ...started, identity: parseIdToken(tokens?.id_token, config.clientId, now) };
}
