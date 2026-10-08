import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The service worker (`public/sw.js`) is plain JavaScript run by the
 * browser; this runs it against a stand-in for its global scope.
 */

const ORIGIN = 'https://word-mastermind.pages.dev';

/** Taps a notification carrying `url`, and returns where the service worker opened. */
async function tap(url: unknown, windows: unknown[] = [], caches?: unknown): Promise<string> {
  const listeners = new Map<string, (event: unknown) => void>();
  const opened: string[] = [];
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    clients: { matchAll: async () => windows, openWindow: async (to: string) => opened.push(to), claim: async () => {} },
    registration: { showNotification: async () => {} },
    skipWaiting: () => {},
    caches,
  };
  new Function('self', readFileSync(join(import.meta.dirname, '../../public/sw.js'), 'utf8'))(self);
  let done: Promise<unknown> = Promise.resolve();
  listeners.get('notificationclick')!({
    notification: { close: () => {}, data: { url } },
    waitUntil: (p: Promise<unknown>) => { done = p; },
  });
  await done;
  return opened[0];
}

describe('tapping a turn notification', () => {
  it("opens the app's page it names", async () => {
    expect(await tap('/?game=abc')).toBe(`${ORIGIN}/?game=abc`);
    expect(await tap(undefined)).toBe(`${ORIGIN}/`);
  });

  it('never opens another site', async () => {
    expect(await tap('https://evil.example/phish')).toBe(`${ORIGIN}/`);
    expect(await tap('//evil.example/phish')).toBe(`${ORIGIN}/`);
  });

  it('has an open copy of the app switch to the game, without reloading it', async () => {
    const calls: unknown[] = [];
    const open = {
      url: `${ORIGIN}/`,
      focus: async () => calls.push('focus'),
      postMessage: (message: unknown, [port]: MessagePort[]) => {
        calls.push(message);
        port.postMessage('opened');
      },
      navigate: async () => calls.push('navigate'),
    };
    expect(await tap('/?game=abc', [open])).toBeUndefined();
    expect(calls).toEqual(['focus', { type: 'open', url: `${ORIGIN}/?game=abc` }]);
  });

  it('loads the page afresh when the open page doesn\'t answer', async () => {
    const calls: unknown[] = [];
    const open = {
      url: `${ORIGIN}/privacy.html`,
      focus: async () => calls.push('focus'),
      postMessage: () => calls.push('message'),
      navigate: async (to: string) => calls.push(`navigate ${to}`),
    };
    expect(await tap('/?game=abc', [open])).toBeUndefined();
    expect(calls).toEqual(['focus', 'message', `navigate ${ORIGIN}/?game=abc`]);
  });

  it("keeps going when focusing the open page is refused (iOS)", async () => {
    const calls: unknown[] = [];
    const open = {
      url: `${ORIGIN}/`,
      focus: async () => {
        throw new Error('not allowed');
      },
      postMessage: (message: unknown, [port]: MessagePort[]) => {
        calls.push(message);
        port.postMessage('opened');
      },
      navigate: async () => calls.push('navigate'),
    };
    await tap('/?game=abc', [open]);
    expect(calls).toEqual([{ type: 'open', url: `${ORIGIN}/?game=abc` }]);
  });

  it('keeps the tapped game for a page that misses the message, and forgets it once one answers', async () => {
    const store = new Map<string, Response>();
    const caches = {
      open: async () => ({
        put: async (key: string, response: Response) => void store.set(key, response),
        delete: async (key: string) => store.delete(key),
      }),
    };
    const asleep = { url: `${ORIGIN}/`, focus: async () => {}, postMessage: () => {}, navigate: async () => {} };
    await tap('/?game=abc', [asleep], caches);
    const kept = await store.get('/tapped-notification')!.json() as { url: string; at: number };
    expect(kept.url).toBe(`${ORIGIN}/?game=abc`);

    const awake = { ...asleep, postMessage: (_: unknown, [port]: MessagePort[]) => port.postMessage('opened') };
    await tap('/?game=def', [awake], caches);
    expect(store.has('/tapped-notification')).toBe(false);
  });
});
