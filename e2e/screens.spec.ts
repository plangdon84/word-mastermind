import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { layoutProblems, SIZES } from './layout';
import { SCREENS, settle } from './screens';

/*
 * Every screen at every size (docs/test-plan.md "Responsive layouts" and
 * "Accessibility"): the layout checks at each size, axe once per screen,
 * and a screenshot of each for the gallery (e2e/gallery.ts).
 */

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
      // A browser can't take a picture over 32,767 pixels tall (device pixels): What's new outgrew it in WebKit's
      // iPhone at 3x. The gallery keeps the top of so long a page; the layout checks below still cover all of it.
      const shape = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, ratio: devicePixelRatio }));
      const tallest = Math.floor(32_000 / shape.ratio);
      const clip = shape.height > tallest ? { clip: { x: 0, y: 0, width: size.width, height: tallest } } : {};
      await page.screenshot({ path: join(dir, `${screen.name}.jpg`), fullPage: true, type: 'jpeg', quality: 70, ...clip });
      for (const problem of await layoutProblems(page)) {
        failures.push(`${size.name}: ${problem.kind} ${problem.what} (${problem.detail})`);
      }
    }
    expect(failures, 'layout problems').toEqual([]);
  });
}
