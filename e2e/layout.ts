import type { Page } from '@playwright/test';

/*
 * What docs/test-plan.md "Responsive layouts" checks on each screen at each
 * size, worked out in the page.
 */

export interface LayoutProblem {
  kind: 'sideways-scroll' | 'off-screen' | 'small-target' | 'covered' | 'clipped';
  what: string;
  detail: string;
}

/**
 * The smallest button, in CSS pixels (Dev Plan item 17b; `--tap` in
 * styles.css). A row of letters (the keyboard's keys, a guess's letter
 * bubbles) can't be 44 px a letter across a phone, so those need only be 44
 * tall and WCAG 2.2's 24 across, filling their row.
 */
export const MIN_TARGET = 44;
export const LETTER_WIDTH = 24;

export function layoutProblems(page: Page): Promise<LayoutProblem[]> {
  return page.evaluate(([minTarget, letterWidth]) => {
    const problems: { kind: string; what: string; detail: string }[] = [];
    const width = document.documentElement.clientWidth;
    const describe = (el: Element) => {
      const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} "${label}"`;
    };
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0
        && !el.closest('.visually-hidden, [aria-hidden="true"], [inert]');
    };

    const scroller = document.scrollingElement!;
    if (scroller.scrollWidth > width + 1) {
      problems.push({ kind: 'sideways-scroll', what: 'page', detail: `${scroller.scrollWidth}px wide in a ${width}px screen` });
    }
    // Nor anything that scrolls inside the page: a vertical scrollbar
    // (Windows) mustn't bring a sideways one with it.
    for (const el of document.body.querySelectorAll('*')) {
      const { overflowX } = getComputedStyle(el);
      if ((overflowX === 'auto' || overflowX === 'scroll') && visible(el) && el.scrollWidth > el.clientWidth + 1) {
        problems.push({ kind: 'sideways-scroll', what: describe(el), detail: `${el.scrollWidth}px wide in ${el.clientWidth}px` });
      }
    }

    // The top layer: an open dialog or the ☰ menu covers the rest.
    const layer = [...document.querySelectorAll('[role="dialog"]')].at(-1) ?? document.querySelector('#menu') ?? document.body;
    const controls = [...layer.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')]
      .filter(visible);
    for (const el of controls) {
      // A checkbox or radio button is tapped anywhere on its label.
      const label = el.matches('input[type="checkbox"], input[type="radio"]') ? el.closest('label') : null;
      const box = (label ?? el).getBoundingClientRect();
      if (box.left < -1 || box.right > width + 1) {
        problems.push({ kind: 'off-screen', what: describe(el), detail: `from ${Math.round(box.left)} to ${Math.round(box.right)} of ${width}` });
      }
      // Links inside a sentence are exempt, as in WCAG's target size rule.
      const inline = getComputedStyle(el).display === 'inline';
      const letter = el.matches('.krow > .key, .letters > .bubble');
      const small = box.height + 0.5 < minTarget || box.width + 0.5 < (letter ? letterWidth : minTarget);
      if (!inline && small) {
        problems.push({ kind: 'small-target', what: describe(el), detail: `${Math.round(box.width)}×${Math.round(box.height)}` });
      }
      // On screen and not hidden under something else (only what's in view can be tested).
      const x = Math.min(Math.max(box.left + box.width / 2, 0), width - 1);
      const y = box.top + box.height / 2;
      if (y >= 0 && y < window.innerHeight) {
        const hit = document.elementFromPoint(x, y);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          problems.push({ kind: 'covered', what: describe(el), detail: `under ${describe(hit)}` });
        }
      }
    }

    // Text cut off: a box whose content is wider than it, with the overflow hidden and no ellipsis.
    for (const el of layer.querySelectorAll('*')) {
      if (!visible(el) || el.children.length > 0 || !(el.textContent ?? '').trim()) continue;
      const style = getComputedStyle(el);
      const hides = ['hidden', 'clip'].includes(style.overflowX);
      if (hides && style.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
        problems.push({ kind: 'clipped', what: describe(el), detail: `${el.scrollWidth}px of text in ${el.clientWidth}px` });
      }
    }
    return problems as never;
  }, [MIN_TARGET, LETTER_WIDTH] as const);
}
