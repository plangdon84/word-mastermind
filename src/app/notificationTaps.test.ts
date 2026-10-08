import { describe, expect, it } from 'vitest';
import { freshTap, TAP_FRESH_MS } from './notificationTaps';

const ORIGIN = 'https://wordmastermind.app';
const NOW = Date.UTC(2026, 9, 7, 12);

describe('a tapped notification the page missed', () => {
  it("gives the game's link while it's fresh", () => {
    expect(freshTap({ url: `${ORIGIN}/?game=abc`, at: NOW - 5_000 }, NOW, ORIGIN)).toBe(`${ORIGIN}/?game=abc`);
  });

  it('gives nothing once stale', () => {
    expect(freshTap({ url: `${ORIGIN}/?game=abc`, at: NOW - TAP_FRESH_MS - 1 }, NOW, ORIGIN)).toBeNull();
  });

  it("never gives another site's address, or anything malformed", () => {
    expect(freshTap({ url: 'https://evil.example/?game=abc', at: NOW }, NOW, ORIGIN)).toBeNull();
    expect(freshTap({ url: 42, at: NOW }, NOW, ORIGIN)).toBeNull();
    expect(freshTap({ url: `${ORIGIN}/` }, NOW, ORIGIN)).toBeNull();
    expect(freshTap(null, NOW, ORIGIN)).toBeNull();
  });
});
