/*
 * A tapped turn notification opens its game (issues #132 and #169). The
 * service worker (`public/sw.js`) asks an open page to show it, but on an
 * iPhone the home-screen app's page may still be waking up and miss that, or
 * the app may have been closed and open on its title screen. So the service
 * worker also keeps the game's link in Cache Storage for a short while, and
 * the page takes it from there when it opens or comes back to the front.
 */

/** Must match public/sw.js. */
const TAP_CACHE = 'word-mastermind-tap';
const TAP_KEY = '/tapped-notification';

/** A tap older than this was missed for good (the app was opened some other way since). */
export const TAP_FRESH_MS = 2 * 60_000;

/** The link a saved tap names, if it's this app's and still fresh at `now` (ms). */
export function freshTap(saved: unknown, now: number, origin: string): string | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { url, at } = saved as { url?: unknown; at?: unknown };
  if (typeof url !== 'string' || typeof at !== 'number' || now - at > TAP_FRESH_MS || at - now > TAP_FRESH_MS) return null;
  try {
    const target = new URL(url, origin);
    return target.origin === origin ? target.href : null;
  } catch {
    return null;
  }
}

/** Takes the tapped notification's link, once: null if there's none, or it's stale. */
export async function takeTappedLink(now: number = Date.now()): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(TAP_CACHE);
    const response = await cache.match(TAP_KEY);
    if (!response) return null;
    await cache.delete(TAP_KEY);
    return freshTap(await response.json(), now, location.origin);
  } catch {
    return null;
  }
}

/** Forgets a tap already handled (the page answered the service worker's message). */
export async function forgetTappedLink(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    await (await caches.open(TAP_CACHE)).delete(TAP_KEY);
  } catch {
    // Nothing to forget.
  }
}

/**
 * When the app comes back to the front the service worker may not have saved
 * the tap yet, so the page looks again shortly after.
 */
export const TAP_LOOKS_MS = [0, 800, 2500] as const;
