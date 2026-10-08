import { isObject, isTime } from '../game';
import { apiRequester } from './apiIdentity';

/*
 * Accounts (README "Accounts"): signing in with an email link or Google, so
 * your games against friends follow you to any device. The server keeps the
 * account; this browser keeps its session token, apart from the profile so a
 * backup file never holds it.
 */

export interface AccountInfo {
  /** The account's player ID: the guest ID of the device that made it. */
  id: string;
  email: string;
  /** Signed in with Google at least once. */
  google: boolean;
  createdAt: number;
}

/** This browser signed in: the token sent with each request, and whose it is. */
export interface Session {
  token: string;
  account: AccountInfo;
}

/** The ways this server lets you sign in. */
export interface SignInMethods {
  email: boolean;
  google: boolean;
}

/** The server's reasons for refusing, as `worker/src/authRoutes.ts` gives them. */
export type AuthErrorCode =
  | 'bad-email' | 'bad-login' | 'bad-request' | 'bad-guest-id' | 'email-off' | 'google-off' | 'too-many-emails'
  | 'email-failed' | 'signed-out' | 'sign-in-needed' | 'unreachable';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

const SESSION_KEY = 'word-mastermind:session:v1';

export function parseAccount(value: unknown): AccountInfo | null {
  if (!isObject(value)) return null;
  const { id, email, google, createdAt } = value;
  if (typeof id !== 'string' || typeof email !== 'string' || typeof google !== 'boolean' || !isTime(createdAt)) return null;
  return { id, email, google, createdAt };
}

export function parseSession(value: unknown): Session | null {
  if (!isObject(value) || typeof value.token !== 'string' || !/^[\w-]{43}$/.test(value.token)) return null;
  const account = parseAccount(value.account);
  return account && { token: value.token, account };
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? parseSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Saves the session, or forgets it (null) on signing out. */
export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage is a convenience; you'd just sign in again.
  }
}

/** The sign-in link's token, from an emailed link or the end of Google's round trip (`?login=…`). */
export function loginTokenFromUrl(search: string): string | null {
  const token = new URLSearchParams(search).get('login');
  return token && /^[\w-]{43}$/.test(token) ? token : null;
}

/** Google's round trip came back without a sign-in: cancelled, or refused. */
export const loginFailedInUrl = (search: string) => new URLSearchParams(search).has('login-error');

/** Who a sign-in link would sign this device in as. */
export interface LinkCheck {
  email: string;
  /** Ask before using it: it was emailed, so it may be someone else's sent to you. */
  confirm: boolean;
}

export interface AuthApi {
  /** Who this session is (null without one), and the ways to sign in. Rejects with `signed-out` if the session ended. */
  me(token: string | null): Promise<{ account: AccountInfo | null; methods: SignInMethods }>;
  /** Emails a sign-in link that comes back to `returnTo`, the app's origin. */
  sendLink(email: string, returnTo: string): Promise<void>;
  /** The address of Google's sign-in page, which comes back to `returnTo`. */
  googleUrl(returnTo: string): Promise<string>;
  /**
   * Who a sign-in link is for, without using it, and whether to ask "Sign in
   * as …?" first (an emailed link; a Google one is this device's own).
   */
  checkLink(loginToken: string): Promise<LinkCheck>;
  /** Trades a sign-in link's token for a session on this device. */
  signIn(loginToken: string): Promise<Session>;
  signOut(token: string): Promise<void>;
  /** Deletes the account, signing out every device. */
  deleteAccount(token: string): Promise<void>;
}

/** Talks to the worker at `apiUrl` as this device (`guestId`, the profile's `deviceId`). Rejects with an `AuthError`. */
export function authApi(apiUrl: string, guestId: string, fetchFn: typeof fetch = fetch): AuthApi {
  const call = (method: 'GET' | 'POST', path: string, body?: unknown, token: string | null = null): Promise<unknown> =>
    apiRequester(apiUrl, { guestId, token }, fetchFn, (code, status) => new AuthError(code as AuthErrorCode, status))(method, path, body);
  return {
    me: async (token) => {
      const data = await call('GET', '/api/auth/me', undefined, token);
      const methods = isObject(data) && isObject(data.methods) ? data.methods : {};
      return {
        account: isObject(data) ? parseAccount(data.account) : null,
        methods: { email: methods.email === true, google: methods.google === true },
      };
    },
    sendLink: async (email, returnTo) => {
      await call('POST', '/api/auth/email', { email, returnTo });
    },
    googleUrl: async (returnTo) => {
      const data = await call('POST', '/api/auth/google', { returnTo });
      if (!isObject(data) || typeof data.url !== 'string' || !data.url.startsWith('https://')) {
        throw new AuthError('bad-request', 200);
      }
      return data.url;
    },
    checkLink: async (loginToken) => {
      const data = await call('POST', '/api/auth/link', { token: loginToken });
      if (!isObject(data) || typeof data.email !== 'string' || typeof data.confirm !== 'boolean') {
        throw new AuthError('bad-request', 200);
      }
      return { email: data.email, confirm: data.confirm };
    },
    signIn: async (loginToken) => {
      const session = parseSession(await call('POST', '/api/auth/session', { token: loginToken }));
      if (!session) throw new AuthError('bad-request', 200);
      return session;
    },
    signOut: async (token) => {
      await call('POST', '/api/auth/logout', {}, token);
    },
    deleteAccount: async (token) => {
      await call('POST', '/api/auth/delete', {}, token);
    },
  };
}

/** Where this device stands with the server. */
export interface SessionCheck {
  /** The signed-in account, up to date; null if nobody is. */
  account: AccountInfo | null;
  /** The ways to sign in, or null if the server hasn't said yet. */
  methods: SignInMethods | null;
  /** The session this browser held has ended (signed out elsewhere, lapsed, or the account deleted). */
  ended: boolean;
  /**
   * This device's guest ID belongs to an account it's no longer signed in
   * to, so it must play as a new guest (a new `deviceId`).
   */
  newGuest: boolean;
}

/** Asks the server whether this browser's session (if any) still stands. Rejects if it can't be reached. */
export async function checkSession(api: AuthApi, token: string | null): Promise<SessionCheck> {
  const ask = async (withToken: string | null): Promise<SessionCheck> => {
    try {
      return { ...await api.me(withToken), ended: token !== null && withToken === null, newGuest: false };
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      if (e.code === 'sign-in-needed') return { account: null, methods: null, ended: token !== null, newGuest: true };
      // The session ended; is this device's guest ID still usable on its own?
      if (e.code === 'signed-out' && withToken !== null) return ask(null);
      throw e;
    }
  };
  return ask(token);
}

/** What to tell someone when signing in didn't work. */
export function authErrorMessage(code: AuthErrorCode): string {
  switch (code) {
    case 'bad-email':
      return "That doesn't look like an email address.";
    case 'bad-login':
      return 'That sign-in link has expired or was already used. Send yourself a new one.';
    case 'too-many-emails':
      return "We've sent that address several links already. Check your inbox (and spam), or wait a few minutes.";
    case 'email-off':
      return "This server can't send sign-in emails.";
    case 'google-off':
      return "This server isn't set up for Google sign-in.";
    case 'email-failed':
      return "Couldn't send the email. Try again in a moment.";
    case 'signed-out':
    case 'sign-in-needed':
      return 'You were signed out. Sign in again to get your games back.';
    case 'unreachable':
      return "Can't reach the game server. Check your connection and try again.";
    case 'bad-request':
    case 'bad-guest-id':
      return 'Something went wrong. Reload the page and try again.';
  }
}
