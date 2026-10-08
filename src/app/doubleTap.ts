/**
 * No double-tap zoom (issue #39). `touch-action: manipulation` in styles.css
 * should be enough, but iOS Safari still zooms when a second tap lands soon
 * after the first on the board. So a second tap within a moment of the first
 * has its touchend cancelled, which stops the zoom (and the browser's own
 * click), and gets its click back from `click()`. Pinch-zoom is untouched,
 * and fields and definitions keep their own double tap (selecting a word).
 */

/**
 * How soon a second tap counts as a double tap. iOS waits about 300 ms, but
 * iPadOS zoomed on slower double taps than that (manual checklist finding
 * 17), and a tap the guard catches is clicked anyway, so it errs long.
 */
export const DOUBLE_TAP_MS = 500;
/** How far a finger may move during a tap and still be a tap. */
const MOVE_PX = 30;
/** How far apart two taps may land and still be a double tap (an iPad's bigger targets). */
const GAP_PX = 60;
/** Two fingers landing this close together are a pinch; a palm settles longer before. */
const PINCH_MS = 150;

export interface Tap {
  at: number;
  x: number;
  y: number;
}

/** Whether `next` is the second tap of a double tap after `prev`. */
export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  return prev !== null && next.at - prev.at < DOUBLE_TAP_MS
    && Math.abs(next.x - prev.x) < GAP_PX && Math.abs(next.y - prev.y) < GAP_PX;
}

/** Elements whose double tap does something of its own. */
const KEEP = 'input, textarea, select, [contenteditable], .definition';
/**
 * What a tap clicks: the nearest of these around the element touched. An
 * icon inside a button is an SVG drawing, which has no `click()` of its own.
 */
const CLICKABLE = 'button, a, label, [role="button"]';

interface TouchPoint { identifier: number; clientX: number; clientY: number }
interface Start { point: TouchPoint; at: number }
interface TouchLike extends Event {
  touches: { length: number };
  changedTouches: { length: number; [i: number]: TouchPoint };
}

export function preventDoubleTapZoom(target: EventTarget): void {
  /**
   * Where each finger now down landed, or null for one that can't be a tap:
   * it was down when another landed, as in a pinch. A finger or palm resting
   * on the screen (holding an iPad) doesn't stop the next finger's taps.
   */
  const starts = new Map<number, Start | null>();
  let last: Tap | null = null;
  target.addEventListener('touchstart', (event) => {
    const e = event as TouchLike;
    // A finger landing just after one that could still be a tap makes a pinch: no double
    // tap spans it. A palm that settled earlier, even between two taps, doesn't.
    if ([...starts.values()].some((s) => s !== null && e.timeStamp - s.at < PINCH_MS)) last = null;
    for (const id of starts.keys()) starts.set(id, null);
    const together = e.changedTouches.length > 1;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      starts.set(touch.identifier, together ? null : { point: touch, at: e.timeStamp });
    }
  }, { passive: true });
  target.addEventListener('touchcancel', (event) => {
    const e = event as TouchLike;
    for (let i = 0; i < e.changedTouches.length; i++) starts.delete(e.changedTouches[i].identifier);
  }, { passive: true });
  target.addEventListener('touchend', (event) => {
    const e = event as TouchLike;
    const point = e.changedTouches[0];
    const start = e.changedTouches.length === 1 ? starts.get(point.identifier)?.point : null;
    for (let i = 0; i < e.changedTouches.length; i++) starts.delete(e.changedTouches[i].identifier);
    if (e.touches.length === 0) starts.clear();
    const moved = !start
      || Math.abs(point.clientX - start.clientX) >= MOVE_PX || Math.abs(point.clientY - start.clientY) >= MOVE_PX;
    if (moved) {
      last = null;
      return;
    }
    const tap = { at: e.timeStamp, x: point.clientX, y: point.clientY };
    const element = e.target as Element | null;
    if (isDoubleTap(last, tap) && element && typeof element.closest === 'function' && !element.closest(KEEP)) {
      e.preventDefault();
      const target = (element.closest(CLICKABLE) ?? element) as HTMLElement;
      target.click?.();
    }
    // Each tap starts the next double tap, so quick taps in a row (cycling a
    // letter's mark) never zoom either.
    last = tap;
  }, { passive: false });
}
