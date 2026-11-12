import { errorResponse } from './http';

/**
 * Runs one request or alarm with the object's others held back
 * (`blockConcurrencyWhile`, Dev Plan item 19zl), without letting an error
 * inside reset the whole object: Cloudflare resets a Durable Object whose
 * `blockConcurrencyWhile` callback throws, which for the day's daily games
 * would fail every player's request waiting at that moment, and in a game
 * room drop both players' live pages. The error comes back instead, caught
 * inside the lock (2.7.2 review, round 1).
 */
export async function whole<T>(
  state: Pick<DurableObjectState, 'blockConcurrencyWhile'>, work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  return state.blockConcurrencyWhile(async () => {
    try {
      return { ok: true as const, value: await work() };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
}

/**
 * A request handled whole: its answer, or, if it threw, a 500
 * `server-error` for this request alone (what Cloudflare answered for a
 * throw before, without the reset).
 */
export async function wholeRequest<T>(
  state: Pick<DurableObjectState, 'blockConcurrencyWhile'>, work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  const done = await whole(state, work);
  if (done.ok) return done;
  console.error('request failed', done.error);
  return { ok: false, response: errorResponse(500, 'server-error') };
}

/**
 * An alarm handled whole. An error is thrown again outside the lock, so
 * Cloudflare still retries the alarm (a time-out, a retried save) without
 * resetting the object.
 */
export async function wholeAlarm(state: Pick<DurableObjectState, 'blockConcurrencyWhile'>, work: () => Promise<void>): Promise<void> {
  const done = await whole(state, work);
  if (!done.ok) throw done.error;
}
