import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/*
 * Screens most players don't open first load when they're first needed
 * (Dev Plan item 19m), so the app starts sooner; once the page has loaded,
 * `preloadScreens` fetches them all quietly, so a tap seldom waits.
 */

const preloads: (() => Promise<unknown>)[] = [];

/** A component of `T` that loads `load()` when it's first needed, then renders it like the original. */
export function lazy<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { preload: () => Promise<unknown> } {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () => pending ??= load().then((component) => (loaded = component), (error: unknown) => {
    // A later try loads it again (offline for a moment, say).
    pending = null;
    throw error;
  });
  preloads.push(preload);
  function Lazy(props: P) {
    const [, setLoaded] = useState(0);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
      if (loaded || failed) return undefined;
      let live = true;
      preload().then(() => live && setLoaded((n) => n + 1), () => live && setFailed(true));
      return () => {
        live = false;
      };
    }, [failed]);
    if (loaded) {
      const Loaded = loaded;
      return <Loaded {...props} />;
    }
    if (failed) return <LoadFailed onRetry={() => setFailed(false)} />;
    // Shown only if loading takes a moment (styles.css), so a quick load doesn't flash it.
    return <p class="field-note lazy-loading" role="status">Loading…</p>;
  }
  return Object.assign(Lazy, { preload });
}

/** A screen that didn't load: offline, or (after a new version went out) its file is gone, which a reload fixes. */
function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <section class="lazy-failed" role="alert">
      <p>This part of the game didn't load. Check your connection, then try again.</p>
      <div class="lazy-failed-actions">
        <button type="button" class="btn primary" onClick={onRetry}>Try again</button>
        <button type="button" class="btn" onClick={() => location.reload()}>Reload</button>
      </div>
    </section>
  );
}

/**
 * Fetches every lazy screen one after another once the page has loaded, so
 * they're there when tapped (and a new version going out meanwhile can't
 * take their files away). It starts at once rather than after a delay: the
 * page has started by then, and a timer could wait behind a busy page. A
 * failure is left for the screen to try again when it's opened.
 */
export function preloadScreens(): void {
  const start = () => {
    void preloads.reduce<Promise<unknown>>((done, preload) => done.then(() => preload().catch(() => {})), Promise.resolve());
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
