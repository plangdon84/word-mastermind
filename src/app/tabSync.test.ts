import { afterEach, describe, expect, it, vi } from 'vitest';
import { onOtherTabSaveAt, sameRecord, savedSinceAt } from './tabSync';

/*
 * The same game in two tabs (Dev Plan item 19d): reading another tab's
 * saves. The screens' use of them is covered by the browser tests
 * (e2e/edges.spec.ts).
 */

const parse = (raw: string | null) => (raw && raw.startsWith('{') ? JSON.parse(raw) as { n: number } : null);

afterEach(() => vi.unstubAllGlobals());

describe('another tab\'s saves', () => {
  it('are read on coming back only if they changed since this page wrote', () => {
    const store = new Map<string, string>([['k', '{"n":2}']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null });
    expect(savedSinceAt('k', '{"n":2}', parse)).toBeNull();
    expect(savedSinceAt('k', '{"n":1}', parse)).toEqual({ n: 2 });
    expect(savedSinceAt('missing', null, parse)).toBeNull();
    store.set('k', 'garbled');
    expect(savedSinceAt('k', null, parse)).toBeNull();
  });

  it('come to a listener as they happen, for that key only and when they read', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const heard: unknown[] = [];
    const stop = onOtherTabSaveAt('k', parse, (s) => heard.push(s));
    const send = (key: string, newValue: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key, newValue }));
    send('k', '{"n":3}');
    send('other', '{"n":4}');
    send('k', null);
    stop();
    send('k', '{"n":5}');
    expect(heard).toEqual([{ n: 3 }]);
  });

  it('compare records as saved', () => {
    expect(sameRecord({ a: [1] }, { a: [1] })).toBe(true);
    expect(sameRecord({ a: [1] }, { a: [2] })).toBe(false);
  });
});
