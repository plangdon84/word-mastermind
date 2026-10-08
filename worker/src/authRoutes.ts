import { isObject } from '../../src/game';
import {
  bearerToken, createLoginLink, deleteAccount, endSessionAndAlerts, findAccount, identify, isToken, mayEmail,
  normalizeEmail, peekLoginLink, signIn,
} from './accounts';
import { finishGoogle, googleConfigOf, redirectUriOf, startGoogle } from './google';
import { isGuestId } from './guests';
import { errorResponse, isAllowedOrigin, json, readJson } from './http';
import type { Env } from './index';
import { loginMail, mailerOf } from './mail';

/** The app's origin to send someone back to, if it's one the API serves. */
function appOrigin(value: unknown, env: Env): string | null {
  return typeof value === 'string' && isAllowedOrigin(value, env.ALLOWED_ORIGINS) ? value : null;
}

/** The app's address that signs in with a link's token (`src/app/account.ts` reads it). */
export const loginUrl = (origin: string, token: string) => `${origin}/?login=${token}`;

/** A request about a sign-in link: this device's guest ID and the link's token, or the error to answer with. */
async function linkRequest(request: Request): Promise<{ guestId: string; loginToken: string } | Response> {
  const guestId = request.headers.get('x-guest-id');
  if (!isGuestId(guestId)) return errorResponse(400, 'bad-guest-id');
  const body = await readJson(request);
  const loginToken = isObject(body) ? body.token : undefined;
  return isToken(loginToken) ? { guestId, loginToken } : errorResponse(400, 'bad-login');
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

/**
 * `/api/auth/…`: which ways to sign in this server offers, sending an email
 * link, Google's round trip, who a link is for, trading a link for a session, signing out and
 * deleting the account.
 * Returns null for any other path.
 */
export async function routeAuth(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch = fetch,
): Promise<Response | null> {
  if (!pathname.startsWith('/api/auth/')) return null;
  const method = request.method;
  const google = googleConfigOf(env);

  // Who's signed in on this device (null if nobody), and the ways to sign in.
  if (pathname === '/api/auth/me' && method === 'GET') {
    const methods = { email: mailerOf(env, fetchFn) !== null, google: google !== null };
    const who = await identify(request, env.DB, now);
    if (!who.ok) return errorResponse(who.status, who.error);
    const account = who.player.accountId && await findAccount(env.DB, who.player.accountId);
    return json({ account: account || null, methods });
  }

  if (pathname === '/api/auth/email' && method === 'POST') {
    const body = await readJson(request);
    const email = isObject(body) ? normalizeEmail(body.email) : null;
    const origin = isObject(body) ? appOrigin(body.returnTo, env) : null;
    if (!email) return errorResponse(400, 'bad-email');
    if (!origin) return errorResponse(400, 'bad-request');
    const mailer = mailerOf(env, fetchFn);
    if (!mailer) return errorResponse(404, 'email-off');
    if (!await mayEmail(env.DB, email, now)) return errorResponse(429, 'too-many-emails');
    const token = await createLoginLink(env.DB, email, null, now);
    return await mailer(loginMail(email, loginUrl(origin, token)))
      ? json({ ok: true }) : errorResponse(502, 'email-failed');
  }

  if (pathname === '/api/auth/google' && method === 'POST') {
    if (!google) return errorResponse(404, 'google-off');
    const guestId = request.headers.get('x-guest-id');
    if (!isGuestId(guestId)) return errorResponse(400, 'bad-guest-id');
    const body = await readJson(request);
    const origin = isObject(body) ? appOrigin(body.returnTo, env) : null;
    if (!origin) return errorResponse(400, 'bad-request');
    return json({ url: await startGoogle(env.DB, google, redirectUriOf(request.url), origin, guestId, now) });
  }

  // Google sends the browser here, not the app, so the answers are pages or redirects.
  if (pathname === '/api/auth/google/callback' && method === 'GET') {
    const finished = google
      && await finishGoogle(env.DB, google, redirectUriOf(request.url), new URL(request.url).searchParams, now, fetchFn);
    if (!finished) {
      return new Response('This sign-in has expired. Go back to Word Mastermind and try again.', {
        status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    const { returnTo, guestId, identity } = finished;
    if (!identity) return redirect(`${returnTo}/?login-error=google`);
    return redirect(loginUrl(returnTo, await createLoginLink(env.DB, identity.email, identity.sub, now, guestId)));
  }

  // Who a sign-in link is for, without using it: the app asks "Sign in as …?" before using an emailed one.
  if (pathname === '/api/auth/link' && method === 'POST') {
    const asked = await linkRequest(request);
    if (asked instanceof Response) return asked;
    const link = await peekLoginLink(env.DB, asked.loginToken, asked.guestId, now);
    return link ? json({ email: link.email, confirm: link.emailed }) : errorResponse(400, 'bad-login');
  }

  // Trades a sign-in link for a session on this device.
  if (pathname === '/api/auth/session' && method === 'POST') {
    const asked = await linkRequest(request);
    if (asked instanceof Response) return asked;
    const signedIn = await signIn(env.DB, asked.loginToken, asked.guestId, now);
    return signedIn.ok ? json({ token: signedIn.token, account: signedIn.account })
      : errorResponse(signedIn.status, signedIn.error);
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = bearerToken(request);
    if (token) await endSessionAndAlerts(env.DB, token);
    return json({ ok: true });
  }

  if (pathname === '/api/auth/delete' && method === 'POST') {
    const who = await identify(request, env.DB, now);
    if (!who.ok) return errorResponse(who.status, who.error);
    if (!who.player.accountId) return errorResponse(401, 'signed-out');
    await deleteAccount(env.DB, who.player.accountId);
    return json({ ok: true });
  }

  return errorResponse(404, 'not-found');
}
