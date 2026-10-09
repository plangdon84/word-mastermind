import { expect, type Page } from '@playwright/test';
import { guess, loginLink, loginLinkCount, modeButton, startSolo, unlockAll } from './helpers';

/*
 * Every screen a player can reach on their own (docs/test-plan.md
 * "Responsive layouts"), each as the taps that get there from a fresh
 * browser. Screens that need a second player (a friend game, a lobby with
 * others) are checked in modes.spec.ts.
 */

export interface Screen {
  name: string;
  open: (page: Page) => Promise<void>;
}

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
const back = (page: Page) => button(page, 'Back').first().click();

async function profilePage(page: Page, row: string) {
  await unlockAll(page);
  await page.getByRole('button', { name: /^Profile/ }).click();
  await button(page, new RegExp(`^${row}`)).click();
}

async function twoPlayerSetup(page: Page) {
  await unlockAll(page);
  await modeButton(page, 'Two player').click();
}

/** A two player game against the computer, given up after a guess: the result card, their word still hidden. */
async function twoPlayerOver(page: Page) {
  await twoPlayerSetup(page);
  await modeButton(page, 'Computer').click();
  await page.getByRole('group').getByRole('button').first().click();
  await button(page, /^Medium/).click();
  await button(page, 'Start game').click();
  await guess(page, 'storm'); // your secret word
  // One guess, then give up. The computer may go first, and its random
  // guesses find STORM about once in 2,000, which ends the game by itself
  // (or leaves you a last chance) rather than coming back to your turn.
  const turn = page.getByText('Your turn');
  const lastChance = page.getByText('Last chance', { exact: true });
  const result = page.locator('.panel.result');
  let guessed = false;
  for (;;) {
    await expect(turn.or(lastChance).or(result)).toBeVisible({ timeout: 20_000 });
    if (await result.isVisible()) break;
    if (guessed && await turn.isVisible()) {
      await button(page, 'Menu').click();
      await button(page, 'Give up').click();
      await button(page, 'Give up').click();
      break;
    }
    // Repeated letters, so never the computer's word: guessing it would win instead.
    await guess(page, guessed ? 'puppy' : 'hello');
    guessed = true;
  }
  await expect(button(page, 'Fold the result')).toBeVisible();
}

export const SCREENS: Screen[] = [
  { name: 'title-new-player', open: async (page) => { await page.goto('/'); } },
  { name: 'title', open: unlockAll },
  {
    // A Practice game left part-way: Games in progress opens with it.
    name: 'title-in-progress',
    open: async (page) => {
      await unlockAll(page);
      await startSolo(page);
      await guess(page, 'crane');
      await button(page, 'Menu').click();
      await button(page, 'Main menu').click();
      await expect(page.getByRole('button', { name: 'Continue Practice' })).toBeVisible();
    },
  },
  { name: 'how-to-play', open: async (page) => { await unlockAll(page); await button(page, 'How to play').click(); } },
  { name: 'tutorial', open: async (page) => { await unlockAll(page); await button(page, 'Tutorial').click(); } },
  { name: 'whats-new', open: async (page) => { await unlockAll(page); await button(page, /^Version .* What's new$/).click(); } },
  {
    // A device last here on an older version sees the new one's notes once.
    name: 'release-popup',
    open: async (page) => {
      await unlockAll(page);
      await page.evaluate(() => localStorage.setItem('word-mastermind:seen-version:v1', '0.9.0'));
      await page.reload();
      await expect(page.getByRole('heading', { name: /^What's new in / })).toBeVisible();
    },
  },
  { name: 'report-issue', open: async (page) => { await unlockAll(page); await button(page, 'Report an issue').click(); } },
  {
    name: 'single-difficulty',
    open: async (page) => { await unlockAll(page); await modeButton(page, 'Practice').click(); },
  },
  {
    name: 'single-game',
    open: async (page) => {
      await unlockAll(page);
      await startSolo(page);
      for (const word of ['crane', 'bunny', 'storm']) await guess(page, word);
    },
  },
  {
    name: 'single-menu',
    open: async (page) => {
      await unlockAll(page);
      await startSolo(page);
      await guess(page, 'crane');
      await button(page, 'Menu').click();
    },
  },
  {
    name: 'single-easy',
    open: async (page) => {
      await unlockAll(page);
      await startSolo(page, 'Easy');
      for (const word of ['crane', 'bunny']) await guess(page, word);
    },
  },
  { name: 'two-opponent', open: twoPlayerSetup },
  { name: 'two-strength', open: async (page) => { await twoPlayerSetup(page); await modeButton(page, 'Computer').click(); } },
  {
    name: 'two-game',
    open: async (page) => {
      await twoPlayerSetup(page);
      await modeButton(page, 'Computer').click();
      await page.getByRole('group').getByRole('button').first().click();
      await button(page, /^Medium/).click();
      await button(page, 'Start game').click();
    },
  },
  { name: 'two-over', open: twoPlayerOver },
  {
    // After a loss, Keep guessing plays on for practice on the same board.
    name: 'two-practice',
    open: async (page) => {
      await twoPlayerOver(page);
      await button(page, 'Keep guessing').click();
      await guess(page, 'bunny');
      await expect(page.getByText("Practice: these don't count")).toBeVisible();
    },
  },
  {
    // × folds the result card to one line: their word, once you've chosen to see it.
    name: 'two-over-folded',
    open: async (page) => {
      await twoPlayerOver(page);
      await button(page, 'Show their word').click();
      await button(page, 'Fold the result').click();
      await expect(button(page, /^The computer's word: [A-Z]{5}\. Show the result$/)).toBeVisible();
    },
  },
  {
    // A past game from the history: the Past game tag in the header.
    name: 'two-review',
    open: async (page) => {
      await profilePage(page, 'Game history');
      await page.locator('.history-row').filter({ hasText: 'vs. Computer' }).first().click();
      await expect(button(page, /^Past game, .*: back to history$/)).toBeVisible();
    },
  },
  {
    name: 'friend-timing',
    open: async (page) => { await twoPlayerSetup(page); await modeButton(page, 'A friend').click(); },
  },
  { name: 'rush-kind', open: async (page) => { await unlockAll(page); await modeButton(page, 'Word Sets').click(); } },
  {
    // The Rush · fastest / Crush · fewest switch above the difficulty.
    name: 'solo-rush-difficulty',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Word Sets').click();
      await modeButton(page, 'Solo').click();
    },
  },
  {
    name: 'solo-rush',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Word Sets').click();
      await modeButton(page, 'Solo').click();
      await button(page, /^Medium/).click();
      await button(page, 'Start game').click();
      await guess(page, 'crane');
    },
  },
  {
    name: 'daily-rush',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Daily Set').click();
    },
  },
  {
    name: 'daily-rush-paused',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Daily Set').click();
      await button(page, /^Medium/).click();
      await button(page, 'Start Daily Set').click();
      await button(page, 'Pause').click();
      await page.getByRole('heading', { name: 'Paused' }).waitFor();
    },
  },
  {
    name: 'daily-word',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Daily Word').click();
      await button(page, /^Medium/).click();
      await button(page, 'Start Daily Word').click();
      await guess(page, 'storm');
    },
  },
  {
    name: 'lobby-setup',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Word Sets').click();
      await modeButton(page, 'With friends').click();
    },
  },
  {
    name: 'lobby-close',
    open: async (page) => {
      await unlockAll(page);
      await modeButton(page, 'Word Sets').click();
      await modeButton(page, 'With friends').click();
      await button(page, 'Open a lobby').click();
      await button(page, /^Medium/).click();
      await button(page, 'Open lobby').click();
      await button(page, 'Close lobby').click();
    },
  },
  { name: 'leaderboards', open: async (page) => { await unlockAll(page); await button(page, 'Leaderboards').click(); } },
  { name: 'profile', open: async (page) => { await unlockAll(page); await page.getByRole('button', { name: /^Profile/ }).click(); } },
  { name: 'profile-account', open: (page) => profilePage(page, 'Account') },
  {
    // An emailed link asks "Sign in as …?" first; a new, long address each time, since each gets 5 links an hour.
    name: 'profile-account-ask',
    open: async (page) => {
      await profilePage(page, 'Account');
      const email = `someone.with.a.long.address.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
      await page.getByLabel('Email address').fill(email);
      const before = loginLinkCount(email);
      await button(page, 'Email me a link').click();
      await page.goto(await loginLink(email, before));
      await expect(page.getByRole('heading', { name: `Sign in as ${email}?` })).toBeVisible();
    },
  },
  { name: 'profile-stats', open: (page) => profilePage(page, 'Stats') },
  { name: 'profile-achievements', open: (page) => profilePage(page, 'Achievements') },
  { name: 'profile-history', open: (page) => profilePage(page, 'Game history') },
  { name: 'profile-settings', open: (page) => profilePage(page, 'Settings') },
  { name: 'profile-help', open: (page) => profilePage(page, 'Help') },
  { name: 'profile-data', open: (page) => profilePage(page, 'Your data') },
  // The static pages (Dev Plan item 18j), each opened from the title screen's footer.
  ...[['how-to-play', 'Full rules'], ['strategy', 'Strategy'], ['jotto-and-wordle', 'Jotto and Wordle']].map(([path, link]) => ({
    name: `page-${path}`,
    open: async (page: Page) => {
      await page.goto('/');
      await page.getByRole('link', { name: link, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${path}$`));
    },
  })),
];

/** Waits for a screen to settle: fonts loaded and nothing still animating in. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await expect(page.locator('body')).toBeVisible();
}

export { back };
