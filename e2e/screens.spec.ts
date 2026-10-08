import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { layoutProblems } from './layout';
import { SCREENS, settle } from './screens';

/*
 * Every screen at every size (docs/test-plan.md "Responsive layouts" and
 * "Accessibility"): the layout checks at each size, axe once per screen,
 * and a screenshot of each for the gallery (e2e/gallery.ts).
 */

export const SIZES = [
  { name: 'small-phone', width: 320, height: 568 },
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone', width: 390, height: 844 },
  { name: 'android', width: 412, height: 915 },
  { name: 'phone-landscape', width: 844, height: 390 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'tablet-landscape', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  // A laptop's browser window (1366×768 screen), short enough that the title screen scrolls.
  { name: 'laptop', width: 1366, height: 625 },
  // A desktop browser zoomed to 200%: what WCAG's "resize text" asks of a page.
  { name: 'text-200', width: 640, height: 400 },
  // A phone with its own keyboard open, which leaves this much of the screen.
  { name: 'keyboard-open', width: 390, height: 450 },
];

export const GALLERY = join(import.meta.dirname, '..', 'e2e-gallery');

/** axe's findings that fail a test: serious or critical, against WCAG 2.2 A and AA. */
async function accessibilityProblems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 5).map((n) => n.target.join(' ')).join('\n    ')}`);
}

for (const screen of SCREENS) {
  test(`${screen.name} fits every size and passes axe`, async ({ page, browserName }) => {
    // Two axe runs and a full-page screenshot at each of 10 sizes: a long page
    // (Achievements) took 40 to 60 seconds in WebKit on CI, so 3 times the usual limit.
    test.slow();
    await page.setViewportSize({ width: SIZES[2].width, height: SIZES[2].height });
    await screen.open(page);
    await settle(page);
    expect(await accessibilityProblems(page), 'axe findings').toEqual([]);
    await page.emulateMedia({ colorScheme: 'dark' });
    await settle(page);
    expect(await accessibilityProblems(page), 'axe findings in dark mode').toEqual([]);
    await page.emulateMedia({ colorScheme: 'light' });

    const failures: string[] = [];
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await settle(page);
      const dir = join(GALLERY, browserName, size.name);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${screen.name}.jpg`), fullPage: true, type: 'jpeg', quality: 70 });
      for (const problem of await layoutProblems(page)) {
        failures.push(`${size.name}: ${problem.kind} ${problem.what} (${problem.detail})`);
      }
    }
    expect(failures, 'layout problems').toEqual([]);
  });
}
