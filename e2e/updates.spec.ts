import { expect, test, type Page } from '@playwright/test';
import { getStorage, guess, setStorage, startSolo, unlockAll } from './helpers';

/*
 * Dev Plan item 18q: getting the new version (issue #136), a tapped
 * notification the page missed (#132, #169), and a page that slept catching
 * up on the single player game (#163).
 */

// WebKit doesn't let a test stand in for the server's answers on a page its
// service worker controls; none of these tests need it (Cache Storage works without).
test.use({ serviceWorkers: 'block' });

const shown = (page: Page, word: string) => page.getByRole('button', { name: `Definition of ${word}`, exact: true });

/** The server has a newer build than the one this page runs ("dev"). */
async function newerBuildOut(page: Page, version = '9.9.9') {
  await page.route('**/version.json*', (route) => route.fulfill({ json: { version, build: 'newer01' } }));
}

/** Counts this page's loads from now (each reload asks for the page again, even one cut short). */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') loads++;
  });
  return () => loads;
}

/** Makes the page think it was hidden and then shown again (the app came back to the front). */
async function comeBack(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test('the title screen reloads into a newer build quietly, and only once', async ({ page }) => {
  await unlockAll(page);
  const loads = countLoads(page);
  await newerBuildOut(page);
  await page.reload();
  // The reload, then the one into the "new" build, which here is still the old one.
  await expect.poll(loads).toBe(2);
  await expect(page.getByRole('button', { name: /^Profile/ })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(loads()).toBe(2);
  await expect(page.getByText('A new version is ready')).toHaveCount(0);
});

test('mid-game a bar offers the new version, and Update comes back into the game', async ({ page }) => {
  await unlockAll(page);
  const secret = await startSolo(page);
  const miss = secret === 'crane' ? 'storm' : 'crane';
  await guess(page, miss);
  await expect(shown(page, miss)).toBeVisible();

  await newerBuildOut(page);
  await page.reload();
  await expect(shown(page, miss)).toBeVisible();
  await expect(page.getByText('A new version is ready')).toBeVisible();
  const loads = countLoads(page);
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect.poll(loads).toBe(1);
  await expect(shown(page, miss)).toBeVisible();
  // This tab already tried: the bar doesn't come back to offer what it can't get.
  await page.waitForTimeout(1000);
  await expect(page.getByText('A new version is ready')).toHaveCount(0);
});

test('a build players see no change in waits for the title screen', async ({ page }) => {
  await unlockAll(page);
  await startSolo(page);
  await newerBuildOut(page, '1.0.0');
  await page.reload();
  await expect(page.getByText(/No guesses yet/)).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByText('A new version is ready')).toHaveCount(0);
});

test('a tapped notification the page missed opens its screen when the app comes back', async ({ page }) => {
  await unlockAll(page);
  await startSolo(page);
  // What public/sw.js keeps on a tap, as an iPhone's app wakes up too late for its message.
  await page.evaluate(async () => {
    const cache = await caches.open('word-mastermind-tap');
    await cache.put('/tapped-notification', Response.json({ url: `${location.origin}/?friends`, at: Date.now() }));
  });
  await comeBack(page);
  await expect(page.getByRole('heading', { name: 'Friends' })).toBeVisible();
  // Taken once: coming back again stays where you are.
  await page.getByRole('button', { name: 'Back' }).first().click();
  await comeBack(page);
  await page.waitForTimeout(3000);
  await expect(page.getByRole('heading', { name: 'Friends' })).toHaveCount(0);
});

test('single player that slept catches up on the game saved meanwhile, not saving its old one over it', async ({ page }) => {
  await unlockAll(page);
  const secret = await startSolo(page);
  const [first, other] = ['crane', 'storm', 'house'].filter((w) => w !== secret);
  await guess(page, first);
  await expect(shown(page, first)).toBeVisible();

  // Another page saved a newer game while this one slept, and this page heard nothing of it.
  const saved = await getStorage(page, 'solo') as { id: string; record: { secret: string; startedAt: number; difficulty: string } };
  const newer = secret === 'beach' ? 'night' : 'beach';
  await setStorage(page, 'solo', {
    id: 'newer-game', marks: {}, draft: '',
    record: { ...saved.record, secret: newer, moves: [{ kind: 'guess', word: other, at: saved.record.startedAt + 1000 }] },
  });
  await comeBack(page);
  await expect(shown(page, other)).toBeVisible();
  await expect(shown(page, first)).toHaveCount(0);
  const next = ['plant', 'mouse'].find((w) => w !== newer)!;
  await guess(page, next);
  await expect(shown(page, next)).toBeVisible();
  // The save lands just after the guess shows, so wait for it.
  type Saved = { id: string; record: { secret: string; moves: { word: string }[] } };
  await expect.poll(async () => ((await getStorage(page, 'solo')) as Saved).record.moves.length).toBe(2);
  const after = await getStorage(page, 'solo') as Saved;
  expect(after.id).toBe('newer-game');
  expect(after.record.secret).toBe(newer);
  expect(after.record.moves.map((m) => m.word)).toEqual([other, next]);
});
