import { describe, expect, it } from 'vitest';
import { authApi, AuthError, checkSession, loginFailedInUrl, loginTokenFromUrl, parseSession, type AuthApi } from './account';
import { identityHeaders } from './apiIdentity';

const TOKEN = 'a'.repeat(43);
const GUEST = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const ACCOUNT = { id: GUEST, email: 'ann@example.com', google: false, createdAt: 1 };

/** A fetch that answers with `body` and records what it was asked. */
function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('sessions', () => {
  it('read back only a well-formed token and account', () => {
    expect(parseSession({ token: TOKEN, account: ACCOUNT })).toEqual({ token: TOKEN, account: ACCOUNT });
    expect(parseSession({ token: 'short', account: ACCOUNT })).toBeNull();
    expect(parseSession({ token: TOKEN, account: { ...ACCOUNT, email: 1 } })).toBeNull();
    expect(parseSession(null)).toBeNull();
  });
});

describe('sign-in links', () => {
  it('carry their token in ?login=, and a failed Google sign-in in ?login-error=', () => {
    expect(loginTokenFromUrl(`?login=${TOKEN}`)).toBe(TOKEN);
    expect(loginTokenFromUrl('?login=nope')).toBeNull();
    expect(loginTokenFromUrl('')).toBeNull();
    expect(loginFailedInUrl('?login-error=google')).toBe(true);
    expect(loginFailedInUrl(`?login=${TOKEN}`)).toBe(false);
  });
});

describe('the auth API', () => {
  it('trades a sign-in link for a session as this device', async () => {
    const { calls, fetchFn } = fakeFetch({ token: TOKEN, account: ACCOUNT });
    const session = await authApi('https://api.example/', GUEST, fetchFn).signIn(TOKEN);
    expect(session).toEqual({ token: TOKEN, account: ACCOUNT });
    expect(calls[0].url).toBe('https://api.example/api/auth/session');
    expect(calls[0].init.headers).toMatchObject({ 'x-guest-id': GUEST });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN });
  });

  it('asks who a sign-in link is for without using it', async () => {
    const { calls, fetchFn } = fakeFetch({ email: 'ann@example.com', confirm: true });
    expect(await authApi('https://api.example', GUEST, fetchFn).checkLink(TOKEN))
      .toEqual({ email: 'ann@example.com', confirm: true });
    expect(calls[0].url).toBe('https://api.example/api/auth/link');
    expect(calls[0].init.headers).toMatchObject({ 'x-guest-id': GUEST });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ token: TOKEN });
    await expect(authApi('https://api.example', GUEST, fakeFetch({ email: 'ann@example.com' }).fetchFn).checkLink(TOKEN))
      .rejects.toMatchObject({ code: 'bad-request' });
  });

  it('sends the session token to ask who is signed in', async () => {
    const { calls, fetchFn } = fakeFetch({ account: ACCOUNT, methods: { email: true, google: false } });
    expect(await authApi('https://api.example', GUEST, fetchFn).me(TOKEN))
      .toEqual({ account: ACCOUNT, methods: { email: true, google: false } });
    expect(calls[0].init.headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });

  it("rejects with the server's reason", async () => {
    const { fetchFn } = fakeFetch({ error: 'too-many-emails' }, 429);
    await expect(authApi('https://api.example', GUEST, fetchFn).sendLink('a@b.co', 'https://app.example'))
      .rejects.toMatchObject({ code: 'too-many-emails', status: 429 });
    const unreachable = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(authApi('https://api.example', GUEST, unreachable).me(null)).rejects.toBeInstanceOf(AuthError);
  });

  it('only follows Google addresses over HTTPS', async () => {
    const { fetchFn } = fakeFetch({ url: 'javascript:alert(1)' });
    await expect(authApi('https://api.example', GUEST, fetchFn).googleUrl('https://app.example'))
      .rejects.toMatchObject({ code: 'bad-request' });
  });
});

describe('checking the session', () => {
  const METHODS = { email: true, google: true };
  /** An API whose `me` answers per token: an account, or an error code. */
  const answering = (answers: Record<string, 'account' | 'none' | 'signed-out' | 'sign-in-needed'>) => ({
    me: async (token: string | null) => {
      const answer = answers[token ?? 'none'];
      if (answer === 'signed-out' || answer === 'sign-in-needed') throw new AuthError(answer, 401);
      return { account: answer === 'account' ? ACCOUNT : null, methods: METHODS };
    },
  }) as unknown as AuthApi;

  it('keeps a session that stands', async () => {
    expect(await checkSession(answering({ [TOKEN]: 'account' }), TOKEN))
      .toEqual({ account: ACCOUNT, methods: METHODS, ended: false, newGuest: false });
  });

  it("notices a session that ended, and whether this device's guest ID is still usable", async () => {
    // Deleted account: its guest IDs are guests again.
    expect(await checkSession(answering({ [TOKEN]: 'signed-out', none: 'none' }), TOKEN))
      .toEqual({ account: null, methods: METHODS, ended: true, newGuest: false });
    // Signed out elsewhere or lapsed: the guest ID is still the account's.
    expect(await checkSession(answering({ [TOKEN]: 'signed-out', none: 'sign-in-needed' }), TOKEN))
      .toEqual({ account: null, methods: null, ended: true, newGuest: true });
  });

  it("gives a device whose guest ID is an account's, with no session, a new guest ID", async () => {
    expect(await checkSession(answering({ none: 'sign-in-needed' }), null))
      .toEqual({ account: null, methods: null, ended: false, newGuest: true });
  });
});

describe('identity headers', () => {
  it('carry the guest ID, and the session once signed in', () => {
    expect(identityHeaders({ guestId: GUEST, token: null })).toEqual({ 'x-guest-id': GUEST });
    expect(identityHeaders({ guestId: GUEST, token: TOKEN }))
      .toEqual({ 'x-guest-id': GUEST, authorization: `Bearer ${TOKEN}` });
  });
});
