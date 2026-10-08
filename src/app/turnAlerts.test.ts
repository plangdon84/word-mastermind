import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiIdentity } from './apiIdentity';
import { alertsPromptDismissed, alertsState, disableAlerts, dismissAlertsPrompt, enableAlerts } from './turnAlerts';

const API = 'https://api.example';
const identity: ApiIdentity = { guestId: 'guest-1', token: null };

/** A browser with push: a service worker whose subscription can go missing, as it sometimes does on iOS. */
function fakeBrowser() {
  const data = new Map<string, string>();
  const key = new Uint8Array([1, 2, 3]);
  const subscription = {
    endpoint: 'https://push.example/1',
    options: { applicationServerKey: key.buffer },
    toJSON: () => ({ endpoint: 'https://push.example/1' }),
    unsubscribe: vi.fn(async () => {
      browser.subscribed = false;
      return true;
    }),
  };
  const browser = {
    permission: 'default' as NotificationPermission,
    subscribed: false,
    /** `getRegistration` finds nothing: what iOS did in issue #32. */
    lostRegistration: false,
    /** The server has no key pair, so it can't send alerts. */
    serverOff: false,
  };
  const pushManager = {
    getSubscription: async () => (browser.subscribed ? subscription : null),
    subscribe: async () => {
      browser.subscribed = true;
      return subscription;
    },
  };
  const registration = { pushManager };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  vi.stubGlobal('navigator', {
    userAgent: 'test',
    serviceWorker: {
      register: async () => registration,
      ready: Promise.resolve(registration),
      getRegistration: async () => (browser.lostRegistration ? undefined : registration),
    },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('window', { PushManager: class {}, Notification: {} });
  vi.stubGlobal('Notification', {
    get permission() {
      return browser.permission;
    },
    requestPermission: async () => {
      browser.permission = 'granted';
      return browser.permission;
    },
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.endsWith('/api/push/key')) return new Response('{}');
    return browser.serverOff
      ? new Response(JSON.stringify({ error: 'push-off' }), { status: 404 })
      : new Response(JSON.stringify({ publicKey: 'AQID' }));
  }));
  return browser;
}

describe('turn alerts', () => {
  let browser: ReturnType<typeof fakeBrowser>;
  beforeEach(() => {
    browser = fakeBrowser();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers alerts until they are turned on', async () => {
    expect(await alertsState()).toBe('off');
    expect(alertsPromptDismissed()).toBe(false);
    expect(await enableAlerts(API, identity)).toBe('on');
    expect(alertsPromptDismissed()).toBe(true);
  });

  it('finds the subscription through the ready service worker', async () => {
    await enableAlerts(API, identity);
    browser.lostRegistration = true;
    expect(await alertsState()).toBe('on');
  });

  it("keeps the offer away once turned on, even when the subscription can't be found", async () => {
    await enableAlerts(API, identity);
    browser.subscribed = false;
    expect(await alertsState()).toBe('off');
    expect(alertsPromptDismissed()).toBe(true);
  });

  it('offers alerts again if the browser stops allowing them', async () => {
    await enableAlerts(API, identity);
    browser.permission = 'default';
    expect(alertsPromptDismissed()).toBe(false);
  });

  it('offers alerts again after they are turned off', async () => {
    await enableAlerts(API, identity);
    expect(await disableAlerts(API, identity)).toBe('off');
    expect(alertsPromptDismissed()).toBe(false);
  });

  it('keeps the offer away after "Not now"', () => {
    dismissAlertsPrompt();
    expect(alertsPromptDismissed()).toBe(true);
  });

  it("says when the server can't send alerts, before and after asking", async () => {
    browser.serverOff = true;
    expect(await alertsState(API)).toBe('server-off');
    expect(await enableAlerts(API, identity)).toBe('server-off');
    expect(alertsPromptDismissed()).toBe(false);
  });

  it('takes a server it cannot reach as able to send them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    expect(await alertsState(API)).toBe('off');
  });
});
