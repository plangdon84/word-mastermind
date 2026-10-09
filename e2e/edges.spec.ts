import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { layoutProblems } from './layout';
import { getStorage, guess, listening, loginLink, loginLinkCount, modeButton, newPlayer, startSolo, trackSockets, unlockAll } from './helpers';

/*
 * Edge cases (docs/test-plan.md "Edge cases"): going offline and back, two
 * tabs or devices at once, signing in or out mid-game, and a page coming
 * back after a long time away.
 */

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });

/** A guess in the list on screen (each has a definition button). */
const shown = (page: Page, word: string) => page.getByRole('button', { name: `Definition of ${word}`, exact: true });

/** Makes the page think it was hidden (the phone locked, another app opened) or shown again. */
async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** A correspondence game between two browsers; returns both pages, the host's first. */
async function friendGame(page: Page, browser: Parameters<typeof newPlayer>[0]) {
  await trackSockets(page.context());
  await unlockAll(page);
  await modeButton(page, 'Two player').click();
  await modeButton(page, 'A friend').click();
  await button(page, /1 day a guess/).click();
  await button(page, /^Medium/).click();
  await button(page, 'Next: your word').click();
  await guess(page, 'storm');
  const link = await page.locator('#invite-link').inputValue();
  // The host hears of the friend joining over its live socket.
  await listening(page);
  const friend = await newPlayer(browser, page);
  await friend.goto(link);
  await expect(friend.getByText(/challenges you/)).toBeVisible();
  await guess(friend, 'beach');
  // The friend's own answer first, so a join that never happened isn't taken for a slow host.
  await expect(friend.getByText(/Your turn|Their turn/)).toBeVisible();
  await expect(page.getByText(/Your turn|Their turn/)).toBeVisible();
  await listening(friend);
  const hostFirst = await page.getByText('Your turn').isVisible();
  return { host: page, friend, mover: hostFirst ? page : friend, waiter: hostFirst ? friend : page };
}

/**
 * Signs in with the emailed link, which comes back to the profile's Account
 * page. Each browser has its own address for `name`: the server sends one
 * link an address a minute, and Chromium and WebKit can run a test at once.
 */
async function signIn(page: Page, name: string): Promise<string> {
  const email = name.replace('@', `.${test.info().project.name}@`);
  await page.getByRole('button', { name: /^Profile/ }).click();
  await button(page, /^Account/).click();
  await page.getByLabel('Email address').fill(email);
  const before = loginLinkCount(email);
  await button(page, 'Email me a link').click();
  await page.goto(await loginLink(email, before));
  // An emailed link asks first, so one someone else made can't sign you in to their account unnoticed.
  await expect(page.getByRole('heading', { name: `Sign in as ${email}?` })).toBeVisible();
  await button(page, 'Sign in').click();
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  return email;
}

/** A reload goes back into the game in progress; the home page offers Continue. Either way, into the game. */
async function resume(page: Page) {
  await expect(page.getByRole('button', { name: /^Profile/ })).toBeVisible();
  const again = modeButton(page, 'Continue');
  if (await again.count()) await again.click();
}

test('single player carries on offline, and keeps its guesses when back online', async ({ page, context }) => {
  await unlockAll(page);
  const secret = await startSolo(page);
  await context.setOffline(true);
  const misses = ['crane', 'storm', 'house'].filter((w) => w !== secret).slice(0, 2);
  for (const word of misses) await guess(page, word);
  await expect(shown(page, misses[1])).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await resume(page);
  for (const word of misses) await expect(shown(page, word)).toBeVisible();
});

test('a friend game catches up after going offline and coming back', async ({ page, browser }) => {
  const { mover, waiter } = await friendGame(page, browser);
  await waiter.context().setOffline(true);
  await setHidden(waiter, true);
  await guess(mover, 'crane');
  await expect(mover.getByText('Their turn')).toBeVisible();
  await waiter.context().setOffline(false);
  await setHidden(waiter, false);
  await expect(waiter.getByText('Your turn')).toBeVisible({ timeout: 20_000 });
});

test('two tabs of one friend game both show each move', async ({ page, browser }) => {
  const { mover } = await friendGame(page, browser);
  const id = ((await getStorage(mover, 'friend-games')) as unknown as { id: string }[])[0].id;
  const second = await mover.context().newPage();
  await second.goto(`/?game=${id}`);
  await expect(second.getByText('Your turn')).toBeVisible();
  await listening(second);
  await guess(mover, 'crane');
  await expect(second.getByText('Their turn')).toBeVisible({ timeout: 20_000 });
});

test('two tabs of one single player game keep every guess', async ({ page, context }) => {
  await unlockAll(page);
  const secret = await startSolo(page);
  const second = await context.newPage();
  await second.goto('/');
  await resume(second);
  const [a, b] = ['crane', 'storm', 'house'].filter((w) => w !== secret);
  await guess(page, a);
  await expect(shown(page, a)).toBeVisible();
  // The other tab catches up rather than saving over the first tab's guess.
  await expect(shown(second, a)).toBeVisible();
  await guess(second, b);
  await page.reload();
  await resume(page);
  for (const word of [a, b]) await expect(shown(page, word)).toBeVisible();
});

test('signing in mid-game keeps the game; signing out starts a new guest', async ({ page }) => {
  await unlockAll(page);
  const secret = await startSolo(page);
  const miss = secret === 'crane' ? 'storm' : 'crane';
  await guess(page, miss);
  await signIn(page, `solo-${Date.now()}@example.com`);
  await page.goto('/');
  await resume(page);
  await expect(shown(page, miss)).toBeVisible();

  const guestBefore = ((await getStorage(page, 'profile')) as { deviceId: string }).deviceId;
  await page.getByRole('button', { name: /^Profile/ }).click();
  await button(page, /^Account/).click();
  await button(page, 'Sign out').click();
  await expect(button(page, 'Email me a link')).toBeVisible();
  // The new profile is saved just after the screen changes.
  await expect.poll(async () => ((await getStorage(page, 'profile')) as { deviceId: string }).deviceId).not.toBe(guestBefore);
});

test('signing in during a friend game keeps playing it', async ({ page, browser }) => {
  const { host, friend } = await friendGame(page, browser);
  const id = ((await getStorage(host, 'friend-games')) as unknown as { id: string }[])[0].id;
  await host.goto('/');
  await signIn(host, `friend-${Date.now()}@example.com`);
  await host.goto(`/?game=${id}`);
  await expect(host.getByText(/Your turn|Their turn/)).toBeVisible();
  await listening(host);
  const [mover, waiter] = (await host.getByText('Your turn').isVisible()) ? [host, friend] : [friend, host];
  await guess(mover, 'crane');
  await expect(waiter.getByText('Your turn')).toBeVisible({ timeout: 20_000 });
});

test("Solo Rush's stopwatch leaves out hours away from the page", async ({ page }) => {
  await page.clock.install();
  await unlockAll(page);
  await modeButton(page, 'Word Sets').click();
  await modeButton(page, 'Solo').click();
  await button(page, /^Medium/).click();
  await button(page, 'Start game').click();
  await guess(page, 'crane');
  await setHidden(page, true);
  await page.clock.fastForward('03:00:00');
  await setHidden(page, false);
  await page.clock.fastForward('00:05');
  // Seconds, not hours: the time away isn't counted.
  await expect(page.getByRole('timer')).toHaveText(/^0:\d\d$/);
  const moves = ((await getStorage(page, 'rush'))!.record as { moves: { kind: string }[] }).moves.map((m) => m.kind);
  expect(moves).toEqual(expect.arrayContaining(['pause', 'resume']));
});

test('the profile refuses a name that is too long or offensive, and keeps a good one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^Profile/ }).click();
  const name = page.getByLabel('Your name');
  await button(page, 'Set your name').click();
  await name.fill('A'.repeat(21));
  await button(page, 'Save').click();
  await expect(page.getByRole('alert')).toHaveText('Use at most 20 characters.');
  await name.fill('Load 455');
  await button(page, 'Save').click();
  await expect(page.getByRole('alert')).toHaveText("Choose another name: this one can't be shown to other players.");
  await name.fill('A'.repeat(20));
  await button(page, 'Save').click();
  await expect(page.getByText('A'.repeat(20), { exact: true })).toBeVisible();
});

test('the longest game: 200 guesses still load, and the newest stays in view above the keyboard', async ({ page }) => {
  await unlockAll(page);
  await startSolo(page);
  const saved = (await getStorage(page, 'solo'))!;
  const record = saved.record as { secret: string; startedAt: number };
  const words = ['crane', 'bunny', 'storm', 'house', 'plumb', 'light'].filter((w) => w !== record.secret);
  const moves = Array.from({ length: 200 }, (_, i) => ({ kind: 'guess', word: words[i % words.length], at: record.startedAt + (i + 1) * 1000 }));
  await page.evaluate((value) => localStorage.setItem('word-mastermind:solo:v1', value), JSON.stringify({ ...saved, record: { ...record, moves } }));
  await page.reload();
  await resume(page);
  const newest = page.getByRole('button', { name: `Definition of ${moves[199].word}` }).last();
  await expect(newest).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Enter' })).toBeInViewport();
});

test('two devices on one account: a game finished on one reaches the other', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const email = `devices-${Date.now()}@example.com`;
  await unlockAll(page);
  await signIn(page, email);
  const other = await newPlayer(browser, page);
  await other.goto('/');
  // One sign-in email per address a minute (EMAIL_GAP_MS in worker/src/accounts.ts).
  await other.waitForTimeout(61_000);
  await signIn(other, email);

  await page.goto('/');
  const secret = await startSolo(page);
  await guess(page, secret);
  await expect(page.getByRole('heading', { name: 'You found it in 1 guess.' })).toBeVisible();

  // The other device syncs when its page comes back into view.
  await setHidden(other, true);
  await setHidden(other, false);
  await other.goto('/');
  await other.getByRole('button', { name: /^Profile/ }).click();
  await expect(other.getByRole('button', { name: /^Game history/ })).toContainText(/4 games/, { timeout: 20_000 });
});

test("a sign-in link someone else sent you asks first, and Not me leaves you signed out", async ({ page, browser }) => {
  const email = `sender-${Date.now()}@example.com`;
  const sender = await newPlayer(browser, page);
  await unlockAll(sender);
  await sender.getByRole('button', { name: /^Profile/ }).click();
  await button(sender, /^Account/).click();
  await sender.getByLabel('Email address').fill(email);
  const before = loginLinkCount(email);
  await button(sender, 'Email me a link').click();
  const link = await loginLink(email, before);

  await unlockAll(page);
  await page.goto(link);
  // The question takes focus, so a keyboard or screen reader user knows a choice is waiting.
  await expect(page.getByRole('heading', { name: `Sign in as ${email}?` })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Email me a link' })).toHaveCount(0);
  await button(page, 'Not me').click();
  await expect(page.getByText("You didn't sign in.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Profile/ }).click();
  await button(page, /^Account/).click();
  await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
});

test("signed in, a link for another account says you'll be signed out of yours, then switches", async ({ page, browser }) => {
  const theirs = `theirs-${Date.now()}@example.com`;
  await unlockAll(page);
  const mine = await signIn(page, `mine-${Date.now()}@example.com`);
  const sender = await newPlayer(browser, page);
  await unlockAll(sender);
  await sender.getByRole('button', { name: /^Profile/ }).click();
  await button(sender, /^Account/).click();
  await sender.getByLabel('Email address').fill(theirs);
  const before = loginLinkCount(theirs);
  await button(sender, 'Email me a link').click();

  await page.goto(await loginLink(theirs, before));
  await expect(page.getByRole('heading', { name: `Sign in as ${theirs}?` })).toBeVisible();
  await expect(page.getByText(`You'll be signed out of ${mine} on this device.`)).toBeVisible();
  await button(page, 'Sign in').click();
  await expect(page.locator('section[aria-label="Account"]')).toContainText(`Signed in as ${theirs}`);
});

test("a refused secret word never turns up as a guess, nor letters typed while waiting for a friend", async ({ page, browser }) => {
  const empty = (p: Page) => p.getByRole('img', { name: 'Current guess: empty' });
  await unlockAll(page);
  await modeButton(page, 'Two player').click();
  await modeButton(page, 'A friend').click();
  await button(page, /1 day a guess/).click();
  await button(page, /^Medium/).click();
  await button(page, 'Next: your word').click();
  // GEESE repeats letters, so it can't be a secret word.
  await guess(page, 'geese');
  await expect(page.locator('.message.error')).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await guess(page, 'storm');
  const link = await page.locator('#invite-link').inputValue();
  // Waiting for the friend, the keyboard types nothing.
  await page.keyboard.type('norse');

  const friend = await newPlayer(browser, page);
  await friend.goto(link);
  await expect(friend.getByText(/challenges you/)).toBeVisible();
  await guess(friend, 'geese');
  await expect(friend.locator('.message.error')).toBeVisible();
  for (let i = 0; i < 5; i++) await friend.keyboard.press('Backspace');
  await guess(friend, 'beach');
  for (const p of [page, friend]) {
    await expect(p.getByText(/Your turn|Their turn/)).toBeVisible();
    await expect(empty(p)).toBeVisible();
  }
  const id = ((await getStorage(page, 'friend-games')) as unknown as { id: string }[])[0].id;
  await page.goto(`/?game=${id}`);
  await expect(page.getByText(/Your turn|Their turn/)).toBeVisible();
  await expect(empty(page)).toBeVisible();
});

test('content screens scroll from the side margins and the header, and a pop-up holds the page still', async ({ browser }) => {
  // A mouse wheel, so a desktop browser: mobile WebKit has none.
  const page = await (await browser.newContext({ isMobile: false, hasTouch: false })).newPage();
  await unlockAll(page);
  for (const size of [{ width: 844, height: 390 }, { width: 1280, height: 500 }]) {
    await page.setViewportSize(size);
    await page.evaluate(() => window.scrollTo(0, 0));
    // The left margin, outside the 520px column, then the title at the top.
    for (const [x, y] of [[8, size.height / 2], [size.width / 2, 30]]) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, 200);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }
  }
  await button(page, 'How to play').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.move(8, 200);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test("a new version's notes show once to a returning device, never to a new one", async ({ page }) => {
  const popup = page.getByRole('heading', { name: /^What's new in / });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Version .* What's new$/ })).toBeVisible();
  await expect(popup).toHaveCount(0);
  // Last here on an older version: the popup, once.
  await page.evaluate(() => localStorage.setItem('word-mastermind:seen-version:v1', '0.9.0'));
  await page.reload();
  await expect(popup).toBeVisible();
  await button(page, 'Got it').click();
  await expect(popup).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Version .* What's new$/ })).toBeVisible();
  await expect(popup).toHaveCount(0);
  // The version opens every version's notes, and Back returns to the title screen.
  await page.getByRole('button', { name: /^Version .* What's new$/ }).click();
  await expect(page.getByRole('heading', { name: "What's new", exact: true })).toBeVisible();
  await button(page, 'Back').click();
  await expect(page.getByRole('button', { name: 'Leaderboards' })).toBeVisible();
});

test('a declined rematch says so, and either player can ask again from the last game', async ({ page, browser }) => {
  const { host, friend, mover, waiter } = await friendGame(page, browser);
  await guess(mover, mover === host ? 'beach' : 'storm');
  // The other player's last chance has come round before they take it.
  await expect(waiter.getByText(/final guess|last guess/i)).toBeVisible();
  await guess(waiter, 'crane');
  await expect(host.getByRole('button', { name: 'Rematch', exact: true })).toBeVisible();

  // The host asks; the friend turns it down from their result screen.
  await button(host, 'Rematch').click();
  await guess(host, 'crane');
  await friend.getByRole('button', { name: /wants a rematch/ }).click();
  await button(friend, 'Decline rematch').click();
  await expect(friend.getByRole('heading', { name: 'This rematch was declined.' })).toBeVisible();
  await expect(host.getByRole('heading', { name: /declined your rematch/ })).toBeVisible();

  // Back on the last game, Rematch is offered again.
  await button(host, 'Back to your last game').click();
  await button(host, 'Rematch').click();
  await guess(host, 'plant');
  await expect(host.getByRole('heading', { name: /Rematch sent to/ })).toBeVisible();
});

test("a challenge from the friends list keeps the whole keyboard on screen at every phone size (issue 191)", async ({ page, browser }) => {
  await unlockAll(page);
  await signIn(page, 'challenger@example.com');
  await button(page, 'Back to profile').click();
  await button(page, /^Friends/).click();
  const link = await page.locator('#friend-link').inputValue();

  // Their invite link makes them friends at once.
  const friend = await newPlayer(browser, page);
  await unlockAll(friend);
  await signIn(friend, 'challenged@example.com');
  await friend.goto(link);
  await button(friend, 'Add').click();
  // The longest the settings get: past words to offer, and Rated moving an Easy game to Medium.
  await friend.evaluate(() => localStorage.setItem('word-mastermind:recent-secrets:v1',
    JSON.stringify(['storm', 'beach', 'crane', 'plant', 'house', 'light', 'brick', 'chair', 'dream', 'flute'])));
  await button(friend, 'Challenge').click();
  await button(friend, 'Easy').click();
  await friend.getByLabel(/Rated game/).check();
  await expect(friend.getByText(/so this one is at Medium/)).toBeVisible();

  const phones = [
    { width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 },
    { width: 412, height: 915 }, { width: 844, height: 390 },
  ];
  for (const size of phones) {
    await friend.setViewportSize(size);
    const bottom = await friend.locator('.keyboard').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom, `the keyboard's bottom at ${size.width}×${size.height}`).toBeLessThanOrEqual(size.height);
    // The word's slots stay in view above the keyboard, the settings scrolling behind them.
    const [slotsTop, slotsBottom, keysTop] = await friend.evaluate(() => {
      const slots = document.querySelector('.slots')!.getBoundingClientRect();
      return [slots.top, slots.bottom, document.querySelector('.keyboard')!.getBoundingClientRect().top];
    });
    expect(slotsTop, `the word's slots at ${size.width}×${size.height}`).toBeGreaterThanOrEqual(0);
    expect(slotsBottom, `the word's slots at ${size.width}×${size.height}`).toBeLessThanOrEqual(keysTop);
  }
});

test('at Extreme, the latest guess stays at the top while the scores scroll under it (issue 194)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await unlockAll(page);
  await startSolo(page, 'Extreme');
  const saved = (await getStorage(page, 'solo'))!;
  const record = saved.record as { secret: string; startedAt: number };
  const words = ['crane', 'bunny', 'storm', 'house', 'plumb', 'light'].filter((w) => w !== record.secret);
  const moves = Array.from({ length: 40 }, (_, i) => ({ kind: 'guess', word: words[i % words.length], at: record.startedAt + (i + 1) * 1000 }));
  await page.evaluate((value) => localStorage.setItem('word-mastermind:solo:v1', value), JSON.stringify({ ...saved, record: { ...record, moves } }));
  await page.reload();
  await resume(page);
  const latest = page.getByLabel(`Last guess: ${moves[39].word.toUpperCase()}`);
  await expect(latest).toBeInViewport();
  // Back to the first scores, and the latest guess hasn't moved.
  const scores = page.getByRole('list', { name: 'Your scores' });
  await scores.locator('li').first().scrollIntoViewIfNeeded();
  await expect(scores.locator('li').first()).toBeInViewport();
  await expect(latest).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Enter' })).toBeInViewport();
});

test.describe(() => {
  // WebKit doesn't let a test stand in for the server's answers on a page its
  // service worker controls (as in updates.spec.ts), and the server is another
  // origin, so the stand-in answer carries its CORS header too.
  test.use({ serviceWorkers: 'block' });

  test("the stats headline's provisional rating stays inside its tile at every phone size (issue 182)", async ({ page }) => {
    await unlockAll(page);
    // A provisional rating with the widest digits, in the pool with the longest name.
    await page.route('**/api/ratings', (route) => route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { ratings: [{ pool: 'correspondence', rating: 1888, provisional: true, games: 3 }] },
    }));
    await signIn(page, 'rated@example.com');
    await button(page, 'Back to profile').click();
    await button(page, /^Stats/).click();
    await expect(page.locator('.rating-pool')).toHaveText('Corresp.');
    for (const width of [320, 375, 390, 412]) {
      await page.setViewportSize({ width, height: 800 });
      const [tile, rating, pool] = await page.evaluate(() => {
        const box = (el: Element | Range) => { const r = el.getBoundingClientRect(); return [r.left, r.right] as const; };
        const dd = document.querySelector('.headline dd.rating')!;
        const digits = document.createRange();
        digits.selectNodeContents(dd.firstChild!);
        return [box(document.querySelector('.rating-tile')!), box(digits), box(document.querySelector('.rating-pool')!)];
      });
      for (const [what, [left, right]] of [['1888?', rating], ['Corresp.', pool]] as const) {
        expect(left, `${what}'s left at ${width}px`).toBeGreaterThanOrEqual(tile[0]);
        expect(right, `${what}'s right at ${width}px`).toBeLessThanOrEqual(tile[1]);
      }
    }
  });
});

test("a friend's profile: their stats, badges and games, and your record against them (Dev Plan item 18c)", async ({ page, browser }) => {
  await unlockAll(page);
  await signIn(page, 'profile-viewer@example.com');
  await button(page, 'Back to profile').click();
  await button(page, /^Friends/).click();
  const link = await page.locator('#friend-link').inputValue();

  // A friend with games of their own, synced to their account, adds you by your link.
  const friend = await newPlayer(browser, page);
  await unlockAll(friend);
  await signIn(friend, 'profile-viewed@example.com');
  await expect.poll(async () => {
    const sync = await getStorage(friend, 'sync');
    return sync && Array.isArray(sync.pending) ? sync.pending.length : -1;
  }, { message: "the friend's games were synced" }).toBe(0);
  await friend.goto(link);
  await button(friend, 'Add').click();
  await expect(friend.getByText(/are friends\./)).toBeVisible();

  // Their name on your list opens their profile.
  await button(page, 'Back to profile').click();
  await button(page, /^Friends/).click();
  await page.getByRole('button', { name: /'s profile$/ }).click();
  const rows = page.getByRole('navigation', { name: /'s profile$/ });
  await expect(rows.getByRole('button', { name: /^Game history \d+ games$/ })).toBeVisible();

  const check = async (what: string) => {
    for (const size of [{ width: 320, height: 568 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(size);
      expect(await layoutProblems(page), `${what} at ${size.width}×${size.height}`).toEqual([]);
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id), what).toEqual([]);
  };
  await check('the hub');

  await rows.getByRole('button', { name: /^Stats/ }).click();
  await expect(page.getByRole('heading', { name: /^You vs\. / })).toBeVisible();
  await expect(page.getByText(/^You haven't played /)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Their top guesses' })).toBeVisible();
  await check('their stats');
  await page.getByRole('button', { name: /^Back to .*'s profile$/ }).click();

  await rows.getByRole('button', { name: /^Achievements/ }).click();
  await expect(page.locator('.badge-item:not(.locked)').first()).toBeVisible();
  await check('their achievements');
  await page.getByRole('button', { name: /^Back to .*'s profile$/ }).click();

  // One of their games opens read-only, its tag naming them, and goes back to their history.
  await rows.getByRole('button', { name: /^Game history/ }).click();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
  await check('their history');
  await page.locator('.history-row').first().click();
  await page.getByRole('button', { name: /'s game, .*: back to .*'s history$/ }).click();
  await expect(page.locator('.history-row').first()).toBeVisible();
});

test("a friend's name in a game opens their profile over it, and Back comes back to the game (Dev Plan item 18ca)", async ({ page, browser }) => {
  await unlockAll(page);
  await signIn(page, 'name-tapper@example.com');
  await button(page, 'Back to profile').click();
  await button(page, /^Friends/).click();
  const link = await page.locator('#friend-link').inputValue();
  const friend = await newPlayer(browser, page);
  await unlockAll(friend);
  await signIn(friend, 'name-tapped@example.com');
  await friend.goto(link);
  await button(friend, 'Add').click();
  await expect(friend.getByText(/are friends\./)).toBeVisible();

  // The friend sends a game by link, and you take it.
  await friend.goto('/');
  await modeButton(friend, 'Two player').click();
  await modeButton(friend, 'A friend').click();
  await button(friend, /1 day a guess/).click();
  await button(friend, /^Medium/).click();
  await button(friend, 'Next: your word').click();
  await guess(friend, 'storm');
  await page.goto(await friend.locator('#invite-link').inputValue());
  await expect(page.getByText(/challenges you/)).toBeVisible();
  await guess(page, 'beach');
  await expect(page.getByText(/Your turn|Their turn/)).toBeVisible();

  // Their name in the header is a friend's, so it opens their profile; a stranger's would be text.
  const name = page.locator('.matchup .friend-name');
  await expect(name).toBeVisible();
  const theirName = await name.innerText();
  await name.click();
  const rows = page.getByRole('navigation', { name: `${theirName}'s profile` });
  await expect(rows.getByRole('button', { name: /^Game history/ })).toBeVisible();
  await expect(button(page, 'Back')).toBeFocused();
  // Typing goes nowhere while their profile covers the game.
  await page.keyboard.type('crane');
  for (const size of [{ width: 320, height: 568 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    expect(await layoutProblems(page), `their profile at ${size.width}×${size.height}`).toEqual([]);
  }
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);

  await button(page, 'Back').click();
  await expect(page.getByText(/Your turn|Their turn/)).toBeVisible();
  await expect(name).toBeFocused();
  await expect(page.locator('.slot.filled')).toHaveCount(0);
});
