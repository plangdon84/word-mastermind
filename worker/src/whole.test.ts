import { describe, expect, it } from 'vitest';
import { whole, wholeAlarm, wholeRequest } from './whole';

/** A stand-in for a Durable Object's state that notes whether a callback threw out of the lock (which resets the object). */
function lockedState() {
  const seen = { threwOut: false };
  const state = {
    blockConcurrencyWhile: async <T>(callback: () => Promise<T>): Promise<T> => {
      try {
        return await callback();
      } catch (error) {
        seen.threwOut = true;
        throw error;
      }
    },
  };
  return { state, seen };
}

describe('whole (2.7.2 review, round 1)', () => {
  it('passes the answer through', async () => {
    const { state, seen } = lockedState();
    expect(await whole(state, async () => 7)).toEqual({ ok: true, value: 7 });
    expect(seen.threwOut).toBe(false);
  });

  it('answers a request that throws with a 500 for that request alone, never throwing out of the lock', async () => {
    const { state, seen } = lockedState();
    const log = console.error;
    console.error = () => {};
    try {
      const done = await wholeRequest(state, async () => { throw new Error('D1 hiccup'); });
      expect(done.ok).toBe(false);
      if (done.ok) return;
      expect(done.response.status).toBe(500);
      expect(await done.response.json()).toEqual({ error: 'server-error' });
    } finally {
      console.error = log;
    }
    expect(seen.threwOut).toBe(false);
  });

  it('throws an alarm\'s error again outside the lock, so Cloudflare retries the alarm', async () => {
    const { state, seen } = lockedState();
    await expect(wholeAlarm(state, async () => { throw new Error('save failed'); })).rejects.toThrow('save failed');
    expect(seen.threwOut).toBe(false);
  });
});
