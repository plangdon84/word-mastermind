import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { historyCount, seedHistory, soloWin, unlockingGames, type Entry } from './helpers';

/*
 * History at both ends (docs/test-plan.md "Boundary tests" and
 * "Performance"): empty, 5,000 games on a phone-speed CPU, and the 1.0
 * backup (src/app/fixtures/1.0) restored through the profile.
 */

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const openProfile = (page: Page) => page.getByRole('button', { name: /^Profile/ }).click();

/**
 * How much to slow this machine's CPU to stand in for a slow phone. A fixed
 * piece of work takes about 115 ms on one (4x what it took on the machine
 * the targets were set on), so the test means the same on a fast laptop and
 * on GitHub's slower runners.
 */
async function slowPhoneRate(page: Page): Promise<number> {
  const PHONE_MS = 115;
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    runs.push(await page.evaluate(() => {
      const started = performance.now();
      let h = 0;
      for (let n = 0; n < 2e7; n++) h = (Math.imul(h, 31) + n) | 0;
      return h === 0.5 ? 0 : performance.now() - started;
    }));
  }
  return Math.min(8, Math.max(1, Math.round(PHONE_MS / Math.min(...runs))));
}

/** 5,000 finished games, a mix of modes, over about two years. */
function manyGames(): Entry[] {
  const start = Date.UTC(2024, 9, 1);
  const games: Entry[] = unlockingGames(start - 86_400_000);
  const more = 5_000 - games.length;
  for (let i = 0; i < more; i++) {
    const at = start + i * 3 * 3_600_000;
    if (i % 3 === 0) games.push(soloWin(`many-${i}`, at, ['crane', 'bunny', 'storm', 'beach'].slice(i % 4)));
    else if (i % 3 === 1) games.push({ ...unlockingGames(at)[1], id: `many-${i}` });
    else games.push({ ...unlockingGames(at)[2], id: `many-${i}` });
  }
  return games;
}

test('an empty history: every profile page says so, with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await openProfile(page);
  await button(page, /^Game history/).click();
  await expect(page.getByText('No games yet. Finished games appear here.')).toBeVisible();
  await button(page, 'Back to profile').click();
  await button(page, /^Stats/).click();
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await button(page, 'Back to profile').click();
  await button(page, /^Achievements/).click();
  await expect(page.getByText(/0 of \d+/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('5,000 games: each profile page opens within a second on a slow phone, once the history has loaded', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CPU slowdown is a Chromium feature');
  test.setTimeout(180_000);
  await page.goto('/');
  await seedHistory(page, manyGames());
  expect(await historyCount(page)).toBe(5_000);
  const cdp = await page.context().newCDPSession(page);
  const rate = await slowPhoneRate(page);
  console.log(`CPU slowed ${rate}x`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });

  const timed = async (what: string, open: () => Promise<void>, shown: () => Promise<void>) => {
    const started = Date.now();
    await open();
    await shown();
    const ms = Date.now() - started;
    console.log(`${what}: ${ms} ms`);
    return ms;
  };
  const gamesRow = () => expect(page.getByText(/5,?000 games/)).toBeVisible({ timeout: 30_000 });
  // Opening the app reads and replays every game once (for the unlocked modes); the profile reuses them.
  const load = await timed('history loaded after opening the app', async () => {
    await page.reload();
    await openProfile(page);
  }, gamesRow);
  await button(page, 'Back').click();
  const times = {
    profile: await timed('profile', () => openProfile(page), gamesRow),
    stats: await timed('stats', () => button(page, /^Stats/).click(), () => expect(page.locator('.stat-row').first()).toBeVisible()),
  };
  await button(page, 'Back to profile').click();
  Object.assign(times, {
    achievements: await timed('achievements', () => button(page, /^Achievements/).click(), () => expect(page.locator('.badge-grid li').first()).toBeVisible()),
  });
  await button(page, 'Back to profile').click();
  Object.assign(times, {
    history: await timed('history', () => button(page, /^Game history/).click(), () => expect(page.locator('.history-row').first()).toBeVisible()),
  });
  // About 2 s on a slow phone; this only guards against it getting much worse (Dev Plan item 17d speeds it up).
  expect(load, `loading took ${load} ms`).toBeLessThan(4_000);
  for (const [what, ms] of Object.entries(times)) expect(ms, `${what} took ${ms} ms`).toBeLessThan(1_000);
});

test('the 1.0 backup restores through the profile, every game included', async ({ page }) => {
  await page.goto('/');
  await openProfile(page);
  await button(page, /^Your data/).click();
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Restore a backup').click();
  await (await chooser).setFiles(join(import.meta.dirname, '..', 'src', 'app', 'fixtures', '1.0', 'backup.json'));
  await expect(page.getByRole('heading', { name: 'Restore 13 games?' })).toBeVisible();
  await button(page, 'Restore').click();
  await expect.poll(() => historyCount(page)).toBe(13);
  await button(page, 'Back to profile').click();
  await expect(page.getByText('Fixture Player')).toBeVisible();
  await button(page, /^Game history/).click();
  await expect(page.locator('.history-row')).toHaveCount(13);
});
