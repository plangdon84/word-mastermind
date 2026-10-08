import { describe, expect, it } from 'vitest';
import { APP_VERSION, compareVersions, parseVersion, RELEASES, releasePopupDue } from './releases';

describe('release notes', () => {
  it('lists valid versions, newest first, with the app on the newest', () => {
    expect(APP_VERSION).toBe(RELEASES[0].version);
    for (const r of RELEASES) expect(parseVersion(r.version), r.version).not.toBeNull();
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version), RELEASES[i].version).toBeGreaterThan(0);
    }
  });

  it('gives every version notes of one line each', () => {
    for (const r of RELEASES) {
      expect(r.notes.length, r.version).toBeGreaterThan(0);
      for (const n of r.notes) {
        expect(n.text.trim(), r.version).toBe(n.text);
        expect(n.text).not.toMatch(/\n/);
        expect(n.text.length, n.text).toBeLessThanOrEqual(180);
      }
    }
  });

  it('compares versions by number, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(parseVersion('1.0')).toBeNull();
    expect(parseVersion('01.0.0')).toBeNull();
  });

  it('shows the popup once per newer version, never for an older one', () => {
    expect(releasePopupDue(null, '1.0.0')).toBe(true);
    expect(releasePopupDue('1.0.0', '1.0.0')).toBe(false);
    expect(releasePopupDue('1.0.0', '1.1.0')).toBe(true);
    // Back on an older build (a rollback): nothing new to tell.
    expect(releasePopupDue('1.1.0', '1.0.1')).toBe(false);
  });
});
