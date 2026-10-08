import { identityHeaders, type ApiIdentity } from './apiIdentity';

/*
 * Turn alerts (README "Two player vs. a friend"): Web Push notifications for
 * games against a friend. The browser subscribes with the server's public
 * key, and the server (`worker/src/push.ts`) sends to that subscription.
 * The service worker (`public/sw.js`) shows them.
 */

/** Where this device stands. */
export type AlertsState =
  /** This browser can't receive them. */
  | 'unsupported'
  /** An iPhone or iPad: only a Home Screen web app gets them. */
  | 'needs-home-screen'
  /** Notifications are blocked for this site, which only the browser's settings can undo. */
  | 'blocked'
  /** The server has no push keys (a local server without `worker/.dev.vars`, say). */
  | 'server-off'
  | 'off'
  | 'on';

const DISMISSED_KEY = 'word-mastermind:alerts-dismissed:v1';
/** Set once alerts were turned on here, so the in-game offer doesn't come back (issue #32). */
const ENABLED_KEY = 'word-mastermind:alerts-enabled:v1';

// iPadOS says it's a Mac; its touch screen gives it away. `navigator.platform`
// is deprecated, but nothing has replaced it for this.
const isAppleMobile = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const hasPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Registers the service worker, which shows the notifications. Harmless where it isn't supported. */
export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

/** How long to wait for the service worker before settling for `getRegistration`. */
const READY_TIMEOUT_MS = 3_000;

/**
 * The service worker's registration. `ready` is what `enableAlerts`
 * subscribed through, and iOS doesn't always hand back the same registration
 * from `getRegistration`; but `ready` never settles without a service worker,
 * hence the timeout.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), READY_TIMEOUT_MS);
  });
  const ready = await Promise.race([navigator.serviceWorker.ready, timeout]).finally(() => clearTimeout(timer));
  return ready ?? navigator.serviceWorker.getRegistration();
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await activeRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/**
 * Whether the server can send alerts: it answers 404 `push-off` for its key
 * when it has no key pair. Any other failure (offline, say) isn't taken as a no.
 */
async function serverOff(apiUrl: string): Promise<boolean> {
  try {
    return (await fetch(`${apiUrl.replace(/\/$/, '')}/api/push/key`)).status === 404;
  } catch {
    return false;
  }
}

/** Where this device stands; given the server's address, also whether the server can send them. */
export async function alertsState(apiUrl?: string): Promise<AlertsState> {
  if (!hasPush()) return isAppleMobile() && !isStandalone() ? 'needs-home-screen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (apiUrl !== undefined && await serverOff(apiUrl)) return 'server-off';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription().catch(() => null)) ? 'on' : 'off';
}

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const sameBytes = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

function post(apiUrl: string, identity: ApiIdentity, path: string, body: unknown): Promise<Response> {
  return fetch(`${apiUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...identityHeaders(identity) },
    body: JSON.stringify(body),
  });
}

/**
 * Turns alerts on for this device: asks the browser's permission (call it
 * straight from a tap), subscribes, and tells the server. Returns the new state.
 */
export async function enableAlerts(apiUrl: string, identity: ApiIdentity): Promise<AlertsState> {
  if (!hasPush()) return alertsState();
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const keyResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/api/push/key`);
  if (keyResponse.status === 404) return 'server-off';
  if (!keyResponse.ok) return 'off';
  const { publicKey } = await keyResponse.json() as { publicKey: string };
  const key = fromBase64Url(publicKey);

  registerServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another server key (another environment) can't be used.
  if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const saved = await post(apiUrl, identity, '/api/push/subscribe', subscription.toJSON());
  if (!saved.ok) return 'off';
  store(ENABLED_KEY, true);
  return 'on';
}

/** Turns alerts off for this device, here and on the server. */
export async function disableAlerts(apiUrl: string, identity: ApiIdentity): Promise<AlertsState> {
  store(ENABLED_KEY, false);
  const subscription = await currentSubscription().catch(() => null);
  if (subscription) {
    await post(apiUrl, identity, '/api/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
    await subscription.unsubscribe();
  }
  return alertsState();
}

/**
 * Sends this device's subscription to the server again, in case it lost it
 * (a reset profile, or signing out, gives the device a new guest ID). Cheap,
 * and harmless when nothing changed.
 */
export async function resyncAlerts(apiUrl: string, identity: ApiIdentity): Promise<void> {
  if (!hasPush() || Notification.permission !== 'granted') return;
  const subscription = await currentSubscription().catch(() => null);
  if (subscription) await post(apiUrl, identity, '/api/push/subscribe', subscription.toJSON()).catch(() => {});
}

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function store(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, 'true');
    else localStorage.removeItem(key);
  } catch {
    // Storage is a convenience; the prompt just comes back.
  }
}

/**
 * Whether the in-game offer should stay away: you said "Not now", or you
 * turned alerts on here and the browser still allows them. The second holds
 * even when a check can't find the subscription (iOS sometimes loses track of
 * it), so the offer doesn't come back straight after you accepted it. The
 * profile setting still shows what `alertsState` finds.
 */
export function alertsPromptDismissed(): boolean {
  if (stored(DISMISSED_KEY)) return true;
  return stored(ENABLED_KEY) && hasPush() && Notification.permission === 'granted';
}

/** "Not now" on the in-game prompt: it stays away, and the profile setting still works. */
export function dismissAlertsPrompt(): void {
  store(DISMISSED_KEY, true);
}
