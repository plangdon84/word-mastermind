import { useEffect, useRef, useState } from 'preact/hooks';
import { isObject } from '../game';
import { APP_VERSION, compareVersions, parseVersion } from './releases';

/*
 * Getting the new version (issue #136). A page left open, above all a
 * home-screen app on an iPhone, which comes back to the front without
 * reloading, keeps running the build it first loaded. Each build writes its
 * version and commit to `/version.json` (vite.config.ts); the app reads it
 * on opening and whenever it comes back to the front. A newer build reloads
 * the app quietly on the title screen; mid-game a bar offers it instead,
 * once the version number itself is newer (a build players see a change in).
 */

/** What a build says about itself, as `/version.json` holds it. */
export interface BuildInfo {
  version: string;
  build: string;
}

/** This page's build: Cloudflare Pages' commit, or "dev" (vite.config.ts). */
export const RUNNING: BuildInfo = {
  version: APP_VERSION,
  build: (import.meta.env.VITE_APP_BUILD as string | undefined) || 'dev',
};

export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (!isObject(value) || typeof value.version !== 'string' || typeof value.build !== 'string') return null;
  if (!parseVersion(value.version) || !/^[\w.-]{1,40}$/.test(value.build)) return null;
  return { version: value.version, build: value.build };
}

/**
 * What the latest build means for this page: `none` (the same build),
 * `quiet` (another build, safe to reload into where nothing is lost) or
 * `offer` (a newer version number, worth a bar mid-game too).
 */
export type UpdateKind = 'none' | 'quiet' | 'offer';

export function updateKind(running: BuildInfo, latest: BuildInfo | null): UpdateKind {
  if (!latest || latest.build === running.build) return 'none';
  return compareVersions(latest.version, running.version) > 0 ? 'offer' : 'quiet';
}

/** The latest build, read past every cache; null if it can't be read (offline, or `npm run dev`). */
export async function fetchLatestBuild(fetcher: typeof fetch = fetch): Promise<BuildInfo | null> {
  try {
    const response = await fetcher(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? parseBuildInfo(await response.json()) : null;
  } catch {
    return null;
  }
}

/**
 * The build this tab last reloaded to get, so a reload that still comes back
 * on the old build (a cache in the way) never reloads again and again
 * (issue #163 looked for a loop like that).
 */
const TRIED_KEY = 'word-mastermind:update-tried:v1';

export function triedReloadFor(build: string): boolean {
  try {
    return sessionStorage.getItem(TRIED_KEY) === build;
  } catch {
    // Without storage there's no telling, so never reload on our own.
    return true;
  }
}

export function noteReloadFor(build: string): void {
  try {
    sessionStorage.setItem(TRIED_KEY, build);
  } catch {
    // triedReloadFor says yes without storage, so this is never reached in a loop.
  }
}

/** Looks again at most this often, however often the app comes back to the front. */
export const CHECK_GAP_MS = 60_000;

/**
 * The latest build once it's newer than this page's, checked on opening
 * (unless `skipFirst`) and on coming back to the front.
 */
export function useLatestBuild(skipFirst: boolean): { latest: BuildInfo | null; kind: UpdateKind } {
  const [latest, setLatest] = useState<BuildInfo | null>(null);
  const lastCheck = useRef(skipFirst ? Date.now() : 0);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck.current < CHECK_GAP_MS) return;
      lastCheck.current = Date.now();
      void fetchLatestBuild().then((found) => {
        if (updateKind(RUNNING, found) !== 'none') setLatest(found);
      });
    };
    check();
    document.addEventListener('visibilitychange', check);
    // A page brought back from the back-forward cache shows no visibility change.
    window.addEventListener('pageshow', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('pageshow', check);
    };
  }, []);
  return { latest, kind: updateKind(RUNNING, latest) };
}
