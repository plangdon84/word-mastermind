// The service worker: shows turn notifications (Web Push) for games against
// a friend, and opens the game when one is tapped. It doesn't cache
// anything; the app loads from the network as before.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    // Not ours to read; show a plain notification rather than nothing.
  }
  const url = typeof message.url === 'string' ? message.url : '/';
  event.waitUntil((async () => {
    await self.registration.showNotification(message.title || 'Word Mastermind', {
      body: message.body || '',
      // A newer notification about the same game replaces the older one.
      tag: message.tag,
      renotify: Boolean(message.tag),
      icon: '/icon-192.png',
      badge: '/badge-96.png',
      data: { url },
    });
    // An open copy of the app checks the game at once instead of waiting for its next look.
    for (const client of await self.clients.matchAll({ type: 'window' })) {
      client.postMessage({ type: 'game-changed', url });
    }
  })());
});

/*
 * The game a tapped notification is for, kept for a minute or two where the
 * app's page can read it too (Cache Storage; issues #132 and #169). On an
 * iPhone, the home-screen app comes back to the front on a tap, but its page
 * may still be waking up and miss the message below, or the app may have
 * been closed and open on the title screen; either way the page finds the
 * game here when it opens or comes back (src/app/notificationTaps.ts).
 */
const TAP_CACHE = 'word-mastermind-tap';
const TAP_KEY = '/tapped-notification';

async function rememberTap(url) {
  try {
    const cache = await self.caches.open(TAP_CACHE);
    await cache.put(TAP_KEY, new Response(JSON.stringify({ url, at: Date.now() }), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch {
    // Without Cache Storage the message below is all there is.
  }
}

async function forgetTap() {
  try {
    await (await self.caches.open(TAP_CACHE)).delete(TAP_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Asks an open page of the app to show `url`'s screen; true once it says it has. */
function askToOpen(client, url) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    // Short: Firefox lets a notification open a window only within about a second of the tap.
    const timer = setTimeout(() => resolve(false), 500);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve(true);
    };
    client.postMessage({ type: 'open', url }, [channel.port2]);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever this app's own pages.
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil((async () => {
    await rememberTap(url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      // The open app switches to the game itself, without reloading (issue
      // #87: navigate() fails on a page the worker doesn't control, which
      // left the app on whatever screen it was showing). A page that doesn't
      // answer within half a second (an older app, not the app, or one still
      // waking up) is loaded afresh instead, or a new window opened; a page
      // that wakes up later still finds the game it was tapped for.
      // focus() can refuse (iOS), which mustn't stop the rest.
      await open.focus().catch(() => {});
      if (await askToOpen(open, url)) {
        await forgetTap();
      } else {
        await open.navigate(url).catch(() => self.clients.openWindow(url)).catch(() => {});
      }
    } else {
      await self.clients.openWindow(url).catch(() => {});
    }
  })());
});
