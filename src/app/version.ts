/*
 * This version's number and the checks on it (Dev Plan item 18g, README
 * "Version and release notes"). The number is `RELEASES[0]`'s in
 * `releases.ts`, put here by the build (vite.config.ts), so the app starts
 * without loading every release's notes, which load when they're shown.
 */

import { writeStored } from './localStore';

/** This version: the newest in `RELEASES` (releases.test.ts checks they agree). */
export const APP_VERSION: string = (import.meta.env?.VITE_APP_VERSION as string | undefined) ?? '0.0.0';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A version's numbers, or null if it isn't major.minor.patch. */
export function parseVersion(version: string): [number, number, number] | null {
  const m = VERSION.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative if a is older than b, positive if newer, 0 if the same. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a) ?? [0, 0, 0];
  const y = parseVersion(b) ?? [0, 0, 0];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * Whether the popup shows, given the last version this device was told
 * about: only for a newer one. A device that's never been told (null) was
 * here before versions began, since a new device is marked on its first
 * visit (`noteFirstVisit`).
 */
export const releasePopupDue = (seen: string | null, current: string = APP_VERSION): boolean =>
  seen === null || compareVersions(current, seen) > 0;

export const SEEN_KEY = 'word-mastermind:seen-version:v1';

/** The last version this device was told about. Browser storage can be blocked. */
export function readSeenVersion(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    // Blocked: as if seen, so the popup doesn't show on every visit.
    return APP_VERSION;
  }
}

export function markVersionSeen(version: string = APP_VERSION): void {
  writeStored(SEEN_KEY, version);
}

/**
 * Run once at start-up, before the app makes a profile: a device on its
 * first visit (no profile yet) has nothing to catch up on, so it's marked as
 * having seen this version and gets no popup.
 */
export function noteFirstVisit(profileKey: string): void {
  try {
    if (localStorage.getItem(SEEN_KEY) === null && localStorage.getItem(profileKey) === null) markVersionSeen();
  } catch {
    // Blocked storage: readSeenVersion says seen, so no popup either way.
  }
}
