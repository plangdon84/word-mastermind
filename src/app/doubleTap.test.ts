import { describe, expect, it, vi } from 'vitest';
import { DOUBLE_TAP_MS, isDoubleTap, preventDoubleTapZoom } from './doubleTap';

describe('isDoubleTap', () => {
  const first = { at: 1000, x: 100, y: 200 };

  it('is a second tap soon after and close to the first', () => {
    expect(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS - 1, x: 110, y: 190 })).toBe(true);
    expect(isDoubleTap(null, first)).toBe(false);
    expect(isDoubleTap(first, { at: 1000 + DOUBLE_TAP_MS, x: 100, y: 200 })).toBe(false);
    expect(isDoubleTap(first, { at: 1100, x: 200, y: 200 })).toBe(false);
  });

  it("allows an iPad's slower and wider double taps", () => {
    expect(isDoubleTap(first, { at: 1450, x: 100, y: 200 })).toBe(true);
    expect(isDoubleTap(first, { at: 1100, x: 150, y: 245 })).toBe(true);
  });
});

/** An element on the page: `closest` finds a field when it is one, or the button it's inside. */
function element(field = false, button: object | null = null) {
  return {
    click: vi.fn(),
    closest: (selector: string) => (field && selector.includes('input') ? {} : selector.includes('button') ? button : null),
  };
}

function touch(root: EventTarget, type: 'touchstart' | 'touchend', at: number, target: object, x = 50, y = 50,
  touches = type === 'touchstart' ? 1 : 0, identifier = 0) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    timeStamp: { value: at },
    target: { value: target },
    touches: { value: { length: touches } },
    changedTouches: { value: { length: 1, 0: { identifier, clientX: x, clientY: y } } },
  });
  root.dispatchEvent(event);
  return event;
}

function tap(root: EventTarget, at: number, target: object, x = 50, y = 50, identifier = 0, resting = 0) {
  touch(root, 'touchstart', at, target, x, y, 1 + resting, identifier);
  return touch(root, 'touchend', at + 40, target, x, y, resting, identifier);
}

describe('preventDoubleTapZoom', () => {
  it('cancels the second tap of a double tap and clicks it instead', () => {
    const root = new EventTarget();
    preventDoubleTapZoom(root);
    const letter = element();
    expect(tap(root, 0, letter).defaultPrevented).toBe(false);
    expect(tap(root, 200, letter).defaultPrevented).toBe(true);
    expect(letter.click).toHaveBeenCalledTimes(1);
    // A third quick tap is handled too.
    expect(tap(root, 400, letter).defaultPrevented).toBe(true);
    expect(letter.click).toHaveBeenCalledTimes(2);
    // After a pause, taps are the browser's again.
    expect(tap(root, 2000, letter).defaultPrevented).toBe(false);
  });

  it("clicks the button around an icon, which can't be clicked itself", () => {
    const root = new EventTarget();
    preventDoubleTapZoom(root);
    const button = { click: vi.fn() };
    const icon = element(false, button);
    tap(root, 0, icon);
    expect(tap(root, 200, icon).defaultPrevented).toBe(true);
    expect(button.click).toHaveBeenCalledTimes(1);
    expect(icon.click).not.toHaveBeenCalled();
  });

  it('leaves fields, drags and pinches alone', () => {
    const root = new EventTarget();
    preventDoubleTapZoom(root);
    const field = element(true);
    tap(root, 0, field);
    expect(tap(root, 200, field).defaultPrevented).toBe(false);
    expect(field.click).not.toHaveBeenCalled();

    const board = element();
    tap(root, 1000, board);
    touch(root, 'touchstart', 1100, board, 50, 50);
    expect(touch(root, 'touchend', 1150, board, 50, 150).defaultPrevented).toBe(false);

    // A pinch: two fingers land and spread apart.
    tap(root, 3000, board);
    touch(root, 'touchstart', 3100, board, 50, 50, 1, 1);
    touch(root, 'touchstart', 3110, board, 100, 100, 2, 2);
    expect(touch(root, 'touchend', 3300, board, 10, 10, 1, 1).defaultPrevented).toBe(false);
    expect(touch(root, 'touchend', 3310, board, 160, 160, 0, 2).defaultPrevented).toBe(false);
    expect(board.click).not.toHaveBeenCalled();
  });

  it("doesn't take a tap then a pinch for a double tap", () => {
    const root = new EventTarget();
    preventDoubleTapZoom(root);
    const bubble = element();
    tap(root, 0, bubble);
    // The first finger lands, the second beside it, and the second lifts first without moving.
    touch(root, 'touchstart', 100, bubble, 50, 50, 1, 1);
    touch(root, 'touchstart', 110, bubble, 90, 90, 2, 2);
    expect(touch(root, 'touchend', 200, bubble, 90, 90, 1, 2).defaultPrevented).toBe(false);
    expect(bubble.click).not.toHaveBeenCalled();
  });

  it('still catches a double tap with another finger or a palm resting on the screen', () => {
    const root = new EventTarget();
    preventDoubleTapZoom(root);
    const bubble = element();
    // The palm lands first and stays down.
    touch(root, 'touchstart', 0, bubble, 300, 600, 1, 9);
    expect(tap(root, 100, bubble, 50, 50, 1, 1).defaultPrevented).toBe(false);
    expect(tap(root, 400, bubble, 50, 50, 2, 1).defaultPrevented).toBe(true);
    expect(bubble.click).toHaveBeenCalledTimes(1);
  });

  it('still catches a double tap when a palm settles between the two taps', () => {
    const root = new EventTarget();
    preventDoubleTapZoom(root);
    const bubble = element();
    expect(tap(root, 0, bubble, 50, 50, 1).defaultPrevented).toBe(false);
    touch(root, 'touchstart', 150, bubble, 300, 600, 1, 9);
    expect(tap(root, 400, bubble, 50, 50, 2, 1).defaultPrevented).toBe(true);
    expect(bubble.click).toHaveBeenCalledTimes(1);
  });
});
