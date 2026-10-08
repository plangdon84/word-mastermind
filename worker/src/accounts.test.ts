import { describe, expect, it } from 'vitest';
import { newId } from '../../src/app/ids';
import { EMAILS_PER_HOUR, LOGIN_LINK_MS, normalizeEmail, SESSION_MS } from './accounts';
import { fakeD1 } from './fakeD1';
import { GOOGLE_TOKEN_URL, parseIdToken } from './google';
import { handle, type Env } from './index';
import { toBase64Url } from './push';

const NOW = Date.UTC(2026, 8, 28);
const APP = 'https://app.example';
const API = 'https://api.example';
const CLIENT_ID = 'client.apps.googleusercontent.com';

/** An unsigned JWT: the worker only reads the claims of one straight from Google. */
const idToken = (claims: Record<string, unknown>) =>
  ['e30', toBase64Url(new TextEncoder().encode(JSON.stringify(claims))), 'sig'].join('.');

const googleClaims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: NOW / 1000 + 3600, sub: 'g-123',
  email: 'Ann@Example.com', email_verified: true, ...over,
});

/** A server with email and Google on, whose outside calls are recorded and answered here. */
function setup(env: Partial<Env> = {}) {
  const { db, sqlite } = fakeD1();
  const emails: { to: string[]; text: string }[] = [];
  let claims: Record<string, unknown> = googleClaims();
  const tokenRequests: URLSearchParams[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://api.resend.com/emails') {
      emails.push(JSON.parse(String(init?.body)));
      return new Response('{}');
    }
    if (url === GOOGLE_TOKEN_URL) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return Response.json({ id_token: idToken(claims) });
    }
    throw new Error(`Unexpected fetch to ${url}`);
  }) as typeof fetch;
  const fullEnv: Env = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: APP,
    RESEND_API_KEY: 'key', EMAIL_FROM: 'Word Mastermind <play@example.com>',
    GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'shh', ...env,
  };
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, now = NOW) =>
    handle(new Request(`${API}${path}`, {
      method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), fullEnv, now, fetchFn);
  /** The token in the last email's link. */
  const emailedToken = () => /\?login=([\w-]+)/.exec(emails[emails.length - 1].text)![1];
  const signIn = (token: string, guestId: string, now = NOW) =>
    call('POST', '/api/auth/session', { token }, { 'x-guest-id': guestId }, now);
  const peek = (token: string, guestId: string, now = NOW) =>
    call('POST', '/api/auth/link', { token }, { 'x-guest-id': guestId }, now);
  const setClaims = (next: Record<string, unknown>) => {
    claims = next;
  };
  return { db, sqlite, env: fullEnv, emails, tokenRequests, call, emailedToken, signIn, peek, setClaims };
}

type Server = ReturnType<typeof setup>;

async function emailSignIn(server: Server, email: string, guestId: string, now = NOW) {
  expect((await server.call('POST', '/api/auth/email', { email, returnTo: APP }, {}, now)).status).toBe(200);
  const response = await server.signIn(server.emailedToken(), guestId, now);
  expect(response.status).toBe(200);
  return response.json() as Promise<{ token: string; account: { id: string; email: string; google: boolean } }>;
}

/** Google's round trip: the app starts it, Google sends the browser to the callback, which sends it to the app. */
async function googleSignIn(server: Server, guestId: string) {
  const start = await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': guestId });
  const { url } = await start.json() as { url: string };
  const state = new URL(url).searchParams.get('state')!;
  const back = await server.call('GET', `/api/auth/google/callback?state=${state}&code=abc`);
  expect(back.status).toBe(302);
  const location = back.headers.get('location')!;
  const token = new URL(location).searchParams.get('login');
  if (!token) return { location, signedIn: null };
  const response = await server.signIn(token, guestId);
  return { location, signedIn: await response.json() as { token: string; account: { id: string; google: boolean } } };
}

const DEVICE = '9f8e7d6c-5b4a-4c3d-a2e1-f0e9d8c7b6a5';

const me = (server: Server, token: string, now = NOW) =>
  server.call('GET', '/api/auth/me', undefined, { authorization: `Bearer ${token}`, 'x-guest-id': DEVICE }, now);

describe('email addresses', () => {
  it('are trimmed and lowercased, and must look like one', () => {
    expect(normalizeEmail('  Ann@Example.COM ')).toBe('ann@example.com');
    for (const bad of ['', 'ann', 'ann@', '@example.com', 'ann@example', 'a b@example.com', 42, `${'a'.repeat(250)}@x.io`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});

describe('signing in by email', () => {
  it('emails a link back to the app, which signs this device in as a new account', async () => {
    const server = setup();
    const guest = newId();
    const response = await server.call('POST', '/api/auth/email', { email: ' Ann@Example.com', returnTo: APP });
    expect(response.status).toBe(200);
    expect(server.emails).toHaveLength(1);
    expect(server.emails[0].to).toEqual(['ann@example.com']);
    expect(server.emails[0].text).toContain(`${APP}/?login=`);

    const signedIn = await server.signIn(server.emailedToken(), guest);
    expect(signedIn.status).toBe(200);
    const { token, account } = await signedIn.json() as { token: string; account: unknown };
    // The account upgrades the guest in place: its ID is the guest's.
    expect(account).toEqual({ id: guest, email: 'ann@example.com', google: false, createdAt: NOW });
    expect(server.sqlite.prepare('SELECT account_id FROM guests WHERE id = ?').get(guest)).toEqual({ account_id: guest });

    const who = await me(server, token);
    expect(await who.json()).toEqual({ account, methods: { email: true, google: true } });
  });

  it('never stores a token itself', async () => {
    const server = setup();
    const { token } = await emailSignIn(server, 'ann@example.com', newId());
    const stored = JSON.stringify(server.sqlite.prepare('SELECT * FROM sessions').all())
      + JSON.stringify(server.sqlite.prepare('SELECT * FROM login_links').all());
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(server.emailedToken());
  });

  it('works once, and only for 15 minutes', async () => {
    const server = setup();
    await server.call('POST', '/api/auth/email', { email: 'ann@example.com', returnTo: APP });
    const link = server.emailedToken();
    expect((await server.signIn(link, newId(), NOW + LOGIN_LINK_MS)).status).toBe(400);
    expect((await server.signIn(link, newId())).status).toBe(200);
    const again = await server.signIn(link, newId());
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'bad-login' });
  });

  it('signs a second device into the same account, linking its guest ID', async () => {
    const server = setup();
    const [phone, laptop] = [newId(), newId()];
    const first = await emailSignIn(server, 'ann@example.com', phone);
    const second = await emailSignIn(server, 'ANN@example.com', laptop, NOW + 60_000);
    expect(second.account.id).toBe(first.account.id);
    expect(second.token).not.toBe(first.token);
    expect(server.sqlite.prepare('SELECT account_id FROM guests WHERE id = ?').get(laptop)).toEqual({ account_id: phone });
  });

  // A link someone made for their own account and sent you: the app asks "Sign in as …?" before using it.
  it('says who a link is for without using it, so the app can ask first', async () => {
    const server = setup();
    await server.call('POST', '/api/auth/email', { email: 'Ann@Example.com', returnTo: APP });
    const link = server.emailedToken();
    const guest = newId();
    for (let i = 0; i < 2; i++) {
      const peeked = await server.peek(link, guest);
      expect(peeked.status).toBe(200);
      expect(await peeked.json()).toEqual({ email: 'ann@example.com', confirm: true });
    }
    expect(server.sqlite.prepare('SELECT account_id FROM guests WHERE id = ?').get(guest)).toBeUndefined();
    expect((await server.signIn(link, guest)).status).toBe(200);
    // Used, expired or malformed, it's refused as signing in would be.
    for (const [token, now] of [[link, NOW], ['x'.repeat(43), NOW], ['short', NOW]] as const) {
      const refused = await server.peek(token, newId(), now);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: 'bad-login' });
    }
    await server.call('POST', '/api/auth/email', { email: 'bob@example.com', returnTo: APP });
    expect((await server.peek(server.emailedToken(), newId(), NOW + LOGIN_LINK_MS)).status).toBe(400);
    expect((await server.call('POST', '/api/auth/link', { token: link })).status).toBe(400);
  });

  it('limits how many emails an address gets', async () => {
    const server = setup();
    const send = (now: number) =>
      server.call('POST', '/api/auth/email', { email: 'ann@example.com', returnTo: APP }, {}, now);
    expect((await send(NOW)).status).toBe(200);
    expect((await send(NOW + 30_000)).status).toBe(429);
    for (let i = 1; i < EMAILS_PER_HOUR; i++) expect((await send(NOW + i * 60_000)).status).toBe(200);
    expect((await send(NOW + EMAILS_PER_HOUR * 60_000)).status).toBe(429);
    expect((await send(NOW + 61 * 60_000)).status).toBe(200);
    expect(server.emails).toHaveLength(EMAILS_PER_HOUR + 1);
  });

  it('refuses a bad address, an app it doesn\'t serve, and a server without email', async () => {
    const server = setup();
    expect(await (await server.call('POST', '/api/auth/email', { email: 'ann', returnTo: APP })).json())
      .toEqual({ error: 'bad-email' });
    expect((await server.call('POST', '/api/auth/email', { email: 'a@b.co', returnTo: 'https://evil.example' })).status)
      .toBe(400);
    const off = setup({ RESEND_API_KEY: undefined });
    expect((await off.call('POST', '/api/auth/email', { email: 'a@b.co', returnTo: APP })).status).toBe(404);
    expect(await (await off.call('GET', '/api/auth/me', undefined, { 'x-guest-id': DEVICE })).json())
      .toEqual({ account: null, methods: { email: false, google: true } });
  });

  it('prints the email instead when told to (local development)', async () => {
    const server = setup({ RESEND_API_KEY: undefined, LOG_LOGIN_LINKS: 'true' });
    const log = console.log;
    const lines: string[] = [];
    console.log = (line: string) => lines.push(line);
    try {
      expect((await server.call('POST', '/api/auth/email', { email: 'a@b.co', returnTo: APP })).status).toBe(200);
    } finally {
      console.log = log;
    }
    expect(lines.join('\n')).toContain(`${APP}/?login=`);
  });
});

describe('signing in with Google', () => {
  it('sends the browser to Google with PKCE, and back to the app with a sign-in link', async () => {
    const server = setup();
    const guest = newId();
    const start = await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': guest });
    const url = new URL((await start.json() as { url: string }).url);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('redirect_uri')).toBe(`${API}/api/auth/google/callback`);
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const back = await server.call('GET', `/api/auth/google/callback?state=${url.searchParams.get('state')}&code=abc`);
    expect(back.headers.get('location')).toMatch(new RegExp(`^${APP}/\\?login=[\\w-]{43}$`));
    const exchange = server.tokenRequests[0];
    expect(exchange.get('code')).toBe('abc');
    expect(exchange.get('code_verifier')).toMatch(/^[\w-]{43}$/);
    expect(exchange.get('client_secret')).toBe('shh');

    const token = new URL(back.headers.get('location')!).searchParams.get('login')!;
    const signedIn = await (await server.signIn(token, guest)).json() as { account: unknown };
    expect(signedIn.account).toEqual({ id: guest, email: 'ann@example.com', google: true, createdAt: NOW });
  });

  it('joins the account already made by email for the same address', async () => {
    const server = setup();
    const byEmail = await emailSignIn(server, 'ann@example.com', newId());
    const { signedIn } = await googleSignIn(server, newId());
    expect(signedIn?.account).toMatchObject({ id: byEmail.account.id, google: true });
    // After that, Google finds it by its Google ID, whatever the email says.
    server.setClaims(googleClaims({ email: 'ann@new.example' }));
    const later = await googleSignIn(server, newId());
    expect(later.signedIn?.account.id).toBe(byEmail.account.id);
  });

  it('sends the browser back with an error if they cancel or Google refuses', async () => {
    const server = setup();
    const start = await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': DEVICE });
    const state = new URL((await start.json() as { url: string }).url).searchParams.get('state');
    const cancelled = await server.call('GET', `/api/auth/google/callback?state=${state}&error=access_denied`);
    expect(cancelled.headers.get('location')).toBe(`${APP}/?login-error=google`);

    server.setClaims(googleClaims({ email_verified: false }));
    expect((await googleSignIn(server, newId())).location).toBe(`${APP}/?login-error=google`);
  });

  it('refuses an unknown or reused state', async () => {
    const server = setup();
    expect((await server.call('GET', '/api/auth/google/callback?state=nope&code=abc')).status).toBe(400);
    const start = await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': DEVICE });
    const state = new URL((await start.json() as { url: string }).url).searchParams.get('state');
    expect((await server.call('GET', `/api/auth/google/callback?state=${state}&code=abc`)).status).toBe(302);
    expect((await server.call('GET', `/api/auth/google/callback?state=${state}&code=abc`)).status).toBe(400);
  });

  it('is off without a client', async () => {
    const server = setup({ GOOGLE_CLIENT_SECRET: undefined });
    expect((await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': DEVICE })).status).toBe(404);
  });

  it('needs the guest ID of the device starting it', async () => {
    const server = setup();
    expect((await server.call('POST', '/api/auth/google', { returnTo: APP })).status).toBe(400);
  });

  // A sign-in link someone made for their own account, sent to you, mustn't sign your device in to it.
  it('signs in only the device that started it', async () => {
    const server = setup();
    const attacker = newId();
    const victim = newId();
    const start = await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': attacker });
    const state = new URL((await start.json() as { url: string }).url).searchParams.get('state');
    const back = await server.call('GET', `/api/auth/google/callback?state=${state}&code=abc`);
    const token = new URL(back.headers.get('location')!).searchParams.get('login')!;
    const refused = await server.signIn(token, victim);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'bad-login' });
    expect(server.sqlite.prepare('SELECT account_id FROM guests WHERE id = ?').get(victim)).toBeUndefined();
    // The device that started it still can.
    expect((await server.signIn(token, attacker)).status).toBe(200);
  });

  it('needs no asking: its link is for the device that started it alone', async () => {
    const server = setup();
    const device = newId();
    const start = await server.call('POST', '/api/auth/google', { returnTo: APP }, { 'x-guest-id': device });
    const state = new URL((await start.json() as { url: string }).url).searchParams.get('state');
    const back = await server.call('GET', `/api/auth/google/callback?state=${state}&code=abc`);
    const token = new URL(back.headers.get('location')!).searchParams.get('login')!;
    expect(await (await server.peek(token, device)).json()).toEqual({ email: 'ann@example.com', confirm: false });
    expect((await server.peek(token, newId())).status).toBe(400);
  });

  it('reads only ID tokens for this client that haven\'t ended', () => {
    expect(parseIdToken(idToken(googleClaims()), CLIENT_ID, NOW)).toEqual({ email: 'ann@example.com', sub: 'g-123' });
    for (const over of [{ aud: 'other' }, { iss: 'https://evil.example' }, { exp: NOW / 1000 }, { sub: '' },
      { email: undefined }, { email_verified: 'true' }]) {
      expect(parseIdToken(idToken(googleClaims(over)), CLIENT_ID, NOW)).toBeNull();
    }
    expect(parseIdToken('not a token', CLIENT_ID, NOW)).toBeNull();
    expect(parseIdToken(undefined, CLIENT_ID, NOW)).toBeNull();
  });
});

describe('a device already linked to another account', () => {
  // Its guest ID reaches that account's turn alerts, so a session for someone else mustn't use it.
  it('is refused, and the link stays unused for the app to try again as a new guest', async () => {
    const server = setup();
    const device = newId();
    await emailSignIn(server, 'ann@example.com', device);
    expect((await server.call('POST', '/api/auth/email', { email: 'bob@example.com', returnTo: APP })).status).toBe(200);
    const token = server.emailedToken();
    const refused = await server.signIn(token, device);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'sign-in-needed' });
    const fresh = newId();
    const signedIn = await server.signIn(token, fresh);
    expect(signedIn.status).toBe(200);
    expect((await signedIn.json() as { account: { email: string } }).account.email).toBe('bob@example.com');
  });

  it('can sign in to its own account again', async () => {
    const server = setup();
    const device = newId();
    const first = await emailSignIn(server, 'ann@example.com', device, NOW);
    const again = await emailSignIn(server, 'ann@example.com', device, NOW + 2 * 60 * 1000);
    expect(again.account.id).toBe(first.account.id);
  });
});

describe('sessions', () => {
  it('end on signing out', async () => {
    const server = setup();
    const { token } = await emailSignIn(server, 'ann@example.com', newId());
    expect((await me(server, token)).status).toBe(200);
    await server.call('POST', '/api/auth/logout', {}, { authorization: `Bearer ${token}` });
    expect(await (await me(server, token)).json()).toEqual({ error: 'signed-out' });
  });

  it('end after 180 days unused, and keep going while used', async () => {
    const server = setup();
    const { token } = await emailSignIn(server, 'ann@example.com', newId());
    expect((await me(server, token, NOW + SESSION_MS - 1)).status).toBe(200);
    expect((await me(server, token, NOW + 2 * SESSION_MS - 2)).status).toBe(200);
    expect((await me(server, token, NOW + 3 * SESSION_MS)).status).toBe(401);
  });

  it('refuse a malformed token', async () => {
    const server = setup();
    expect((await me(server, 'nope')).status).toBe(401);
  });
});
