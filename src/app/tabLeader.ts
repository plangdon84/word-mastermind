import { useEffect, useState } from 'preact/hooks';

/*
 * One tab leads (Dev Plan item 19d): with the same game open in two tabs,
 * only the leader makes the moves that aren't yours (the computer's
 * guesses), so the tabs never make two different ones. The other tabs
 * follow its saves. The tab you're looking at takes the lead: it holds a
 * Web Lock, taken from whichever tab had it when it's shown. Without Web
 * Locks (an old browser), every tab leads, as before.
 */

/** Whether this tab leads for `name`, while `enabled`. */
export function useTabLeader(name: string, enabled = true): boolean {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  const [leading, setLeading] = useState(!locks);
  useEffect(() => {
    if (!locks || !enabled) return undefined;
    let live = true;
    let held = false;
    let release: (() => void) | null = null;
    const take = () => {
      if (held || document.visibilityState !== 'visible') return;
      held = true;
      // Stealing ends the other tab's hold: its request rejects, and it stops leading.
      locks.request(name, { steal: true }, () => new Promise<void>((resolve) => {
        if (!live) {
          resolve();
          return;
        }
        release = resolve;
        setLeading(true);
      })).catch(() => {}).finally(() => {
        held = false;
        release = null;
        if (live) setLeading(false);
      });
    };
    take();
    document.addEventListener('visibilitychange', take);
    window.addEventListener('focus', take);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', take);
      window.removeEventListener('focus', take);
      release?.();
      setLeading(false);
    };
  }, [locks, name, enabled]);
  return leading;
}
