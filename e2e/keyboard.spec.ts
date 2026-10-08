import { expect, test, type Page } from '@playwright/test';
import { savedGame, unlockAll } from './helpers';

/*
 * The keyboard alone (docs/test-plan.md "Accessibility"): Tab to each
 * control, Enter to press it, Escape to close the menu, letters and Enter
 * to guess, with the focus always visible.
 */

/** The focused control's name, and whether it shows a focus ring; null on the page itself. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
    const label = el.getAttribute('aria-label') ?? el.textContent ?? '';
    return { label: label.trim().replace(/\s+/g, ' '), ring };
  });
}

/**
 * Tabs forward until the focused control's name matches, checking each stop
 * shows its focus. WebKit can draw the ring (:focus-visible) a moment after
 * the Tab, so each stop is looked at until it does (issue #148).
 */
async function tabTo(page: Page, name: RegExp) {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const stop = await focused(page);
    if (!stop) continue;
    await expect.poll(async () => (await focused(page))?.ring, { message: `focus ring on "${stop.label}"`, timeout: 2_000 }).toBe(true);
    if (name.test(stop.label)) return;
  }
  throw new Error(`Tab never reached ${name}`);
}

/** Opens every mode, then waits for the title screen, so the first Tab lands on it. */
async function title(page: Page) {
  await unlockAll(page);
  await expect(page.getByRole('button', { name: /^Profile/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Single player/ })).toBeVisible();
}

async function typeWord(page: Page, word: string) {
  await page.keyboard.type(word);
  await page.keyboard.press('Enter');
}

test('a whole single player game with the keyboard alone', async ({ page }) => {
  await title(page);
  await tabTo(page, /^Single player/);
  await page.keyboard.press('Enter');
  await tabTo(page, /^Hard/);
  await page.keyboard.press('Enter');
  await tabTo(page, /^Start game$/);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/No guesses yet/)).toBeVisible();
  const secret = (await savedGame(page, 'solo')).secret as string;

  // The menu opens with Enter and closes with Escape, giving focus back.
  await tabTo(page, /^Menu$/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();

  await typeWord(page, secret === 'crane' ? 'storm' : 'crane');
  await typeWord(page, secret);
  await expect(page.getByRole('heading', { name: 'You found it in 2 guesses.' })).toBeVisible();
});

test('a Solo Rush with the keyboard alone', async ({ page }) => {
  await title(page);
  await tabTo(page, /^Rush/);
  await page.keyboard.press('Enter');
  await tabTo(page, /^Solo Rush/);
  await page.keyboard.press('Enter');
  await tabTo(page, /^Medium/);
  await page.keyboard.press('Enter');
  await tabTo(page, /^Start game$/);
  await page.keyboard.press('Enter');
  await expect(page.getByText(/No guesses yet/)).toBeVisible();
  const words = (await savedGame(page, 'rush')).words as string[];
  for (const word of words) await typeWord(page, word);
  await expect(page.locator('.rush-result')).toBeVisible();
});
