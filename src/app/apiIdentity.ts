import { isObject } from '../game';

/**
 * Who the app is when it calls the server: this device's guest ID (the
 * profile's `deviceId`), and, once signed in, its session token (README
 * "Accounts"). A signed-in device plays as its account.
 */
export interface ApiIdentity {
  guestId: string;
  token: string | null;
}

/** The headers every request to the server carries. */
export const identityHeaders = ({ guestId, token }: ApiIdentity): Record<string, string> =>
  token ? { 'x-guest-id': guestId, authorization: `Bearer ${token}` } : { 'x-guest-id': guestId };

/**
 * How long a request may take before it's given up as unreachable: a
 * stalled connection would otherwise keep a sync or a pull busy, so none
 * other starts, until the page reloads.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** A signal that aborts after `REQUEST_TIMEOUT_MS`, where the browser has `AbortSignal.timeout`. */
export const requestTimeout = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;

/**
 * Makes JSON requests to the worker at `apiUrl` as `identity`, answering
 * with the body. Rejects with `fail(code, status)`: `unreachable` (status 0)
 * if the server can't be reached or doesn't answer in time, or the server's
 * error code (`bad-request` if it gave none) if it refused. Each API passes
 * its own error class.
 */
export function apiRequester(
  apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch, fail: (code: string, status: number) => Error,
): (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown> {
  const base = apiUrl.replace(/\/$/, '');
  return async (method, path, body) => {
    let response: Response;
    try {
      response = await fetchFn(`${base}${path}`, {
        method,
        headers: { ...identityHeaders(identity), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: requestTimeout(),
      });
    } catch {
      throw fail('unreachable', 0);
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) throw fail(isObject(data) && typeof data.error === 'string' ? data.error : 'bad-request', response.status);
    return data;
  };
}
