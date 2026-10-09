import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { dailyDay } from '../src/game/dailyDays';
import { TEST_DAILY_WORD, testThemeFor } from '../worker/src/testThemes';
import { getStorage, guess, historyCount, listening, modeButton, newPlayer, savedGame, startSolo, trackSockets, unlockAll } from './helpers';

/*
 * Every mode played to the end in the real app (docs/test-plan.md): the
 * server modes against the local game server, the friend game and the
 * largest lobby with a browser per player.
 */

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });

/** axe on a screen only reachable with other players (screens.spec.ts has the rest). */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary ?? ''}`).join('; ')}`)).toEqual([]);
}

test('Practice: refuses bad words, then a win is saved to the history', async ({ page }) => {
  await unlockAll(page);
  const secret = await startSolo(page);
  const before = await historyCount(page);

  // Too short, not a word, then a repeat: none of them is played.
  await guess(page, 'abc');
  await expect(page.getByText('No guesses yet', { exact: false })).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await guess(page, 'qqqqq');
  await expect(page.getByText("QQQQQ isn't in the word list.")).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  const miss = secret === 'crane' ? 'storm' : 'crane';
  await guess(page, miss);
  // The guess is saved. (Its score line clears itself after 2.6 seconds, which a slow WebKit run can miss.)
  const guessed = async () => ((await savedGame(page, 'solo')).moves as { kind: string; word?: string }[])
    .filter((m) => m.kind === 'guess').map((m) => m.word);
  await expect.poll(guessed).toEqual([miss]);
  await guess(page, miss);
  await expect(page.getByText(/already guessed/i)).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');

  await guess(page, secret);
  await expect(page.getByRole('heading', { name: 'You found it in 2 guesses.' })).toBeVisible();
  await expect.poll(() => historyCount(page)).toBe(before + 1);
});

test('two player vs. the computer: finding its word ends the game', async ({ page }) => {
  await unlockAll(page);
  await modeButton(page, 'Two player').click();
  await modeButton(page, 'Computer').click();
  await button(page, /^Casual/).click();
  await button(page, /^Medium/).click();
  await button(page, 'Start game').click();
  await guess(page, 'storm');
  // The game is saved once a move lands: the computer may be first, and still thinking.
  await expect.poll(() => getStorage(page, 'two-player'), { timeout: 20_000 }).not.toBeNull();
  const saved = await getStorage(page, 'two-player');
  const target = (saved!.record as { computerSecret: string }).computerSecret;
  // Wait for your turn (the computer may have the first guess), then find its word.
  await expect(page.getByText('Your turn')).toBeVisible({ timeout: 20_000 });
  await guess(page, target);
  await expect(page.locator('.panel.result')).toBeVisible({ timeout: 20_000 });
});

test('Solo Crush: four words in a row, then the result', async ({ page }) => {
  await unlockAll(page);
  await modeButton(page, 'Word Sets').click();
  await modeButton(page, 'Solo').click();
  await button(page, /^Medium/).click();
  await button(page, 'Start game').click();
  await expect(page.getByText(/No guesses yet/)).toBeVisible();
  const words = (await savedGame(page, 'rush')).words as string[];
  for (const word of words) await guess(page, word);
  await expect(page.locator('.rush-result')).toBeVisible();
});

test("Daily Set: today's words, once a day", async ({ page }) => {
  // e2e/worker.ts loads the made-up test sets.
  const words: string[] = [...testThemeFor(dailyDay(Date.now())).words];

  await unlockAll(page);
  await modeButton(page, 'Daily Set').click();
  await button(page, /^Medium/).click();
  await button(page, 'Start Daily Set').click();
  await expect(page.getByText(/Type a 5-letter word/)).toBeVisible();
  // Pause covers the board until Resume.
  await button(page, 'Pause').click();
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await expect(page.getByText(/Type a 5-letter word/)).toBeHidden();
  await expectAccessible(page);
  await page.locator('section.panel').getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText(/Type a 5-letter word/)).toBeVisible();
  // Each player gets the words in their own order: try the ones not yet found in turn, each guess
  // after the server's answer to the last, so none is typed while one is on its way.
  const result = page.locator('.rush-result');
  const remaining = [...words];
  for (let tries = 0; remaining.length > 0 && tries < words.length * words.length; tries++) {
    const word = remaining[tries % remaining.length];
    const reply = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/daily/guess');
    await guess(page, word);
    const { run } = await (await reply).json() as { run: { words: { guesses: { guess: string; isWin: boolean }[] }[] } };
    if (run.words.some((w) => w.guesses.some((g) => g.isWin && g.guess === word))) remaining.splice(remaining.indexOf(word), 1);
  }
  await expect(result).toBeVisible();
  // Your place: other browsers' runs share the local server's board, so not always 1st.
  await expect(page.getByText(/\b\d+(st|nd|rd|th)\b/).first()).toBeVisible();
  await expectAccessible(page);

  // Once a day: the title screen's Daily card greys today's row, which opens your result, not a new run.
  await page.goto('/');
  const daily = page.getByRole('region', { name: 'Daily' });
  await expect(daily.getByText('Played')).toBeVisible();
  await daily.getByRole('button', { name: /Your place ›/ }).click();
  await expect(result).toBeVisible();
});

test('Daily Word: one word for everyone, once a day, on its own board', async ({ page }) => {
  await unlockAll(page);
  await modeButton(page, 'Daily Word').click();
  await button(page, /^Medium/).click();
  await button(page, 'Start Daily Word').click();
  await expect(page.getByText(/word: type a 5-letter word/)).toBeVisible();
  // One word, and no Pause.
  await expect(button(page, 'Pause')).toHaveCount(0);
  // Each guess after the server's answer to the last, so none is typed while one is on its way.
  const reply = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/daily/word/guess');
  await guess(page, 'storm');
  await reply;
  // e2e/worker.ts sets the test Daily Word.
  await guess(page, TEST_DAILY_WORD);
  const result = page.locator('.rush-result');
  await expect(result.getByRole('heading', { name: /^Found in 2 guesses/ })).toBeVisible();
  await expect(result.getByRole('button', { name: 'Your place: open the board' })).toHaveText(/\d+(st|nd|rd|th) ›/);
  await expectAccessible(page);
  await result.getByRole('button', { name: 'Your place: open the board' }).click();
  await expect(page.getByRole('region', { name: 'Daily Word leaderboard' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Ranked by' })).toHaveCount(0);

  // Once a day, apart from the Daily Set, whose row still plays.
  await page.goto('/');
  const daily = page.getByRole('region', { name: 'Daily' });
  await expect(daily.getByRole('button', { name: /^Daily Word.*Played/ })).toBeVisible();
  await expect(daily.getByRole('button', { name: /^Daily Set/ })).toContainText('Play');
  await daily.getByRole('button', { name: /^Daily Word/ }).click();
  await expect(result).toBeVisible();
});

test('two player vs. a friend: an invite link, live moves both ways, and the result on both screens', async ({ page, browser }) => {
  await trackSockets(page.context());
  await unlockAll(page);
  await modeButton(page, 'Two player').click();
  await modeButton(page, 'A friend').click();
  await button(page, /1 day a guess/).click();
  await button(page, /^Medium/).click();
  await button(page, 'Next: your word').click();
  await guess(page, 'storm');
  const link = await page.locator('#invite-link').inputValue();
  await listening(page);

  const friend = await newPlayer(browser, page);
  await friend.goto(link);
  await expect(friend.getByText(/challenges you/)).toBeVisible();
  await guess(friend, 'beach');
  await expect(friend.getByText(/Your turn|Their turn/)).toBeVisible();
  await expect(page.getByText(/Your turn|Their turn/)).toBeVisible();
  await listening(friend);
  await expectAccessible(friend);

  // Whoever goes first finds the word; the other's final guess misses.
  const hostFirst = await page.getByText('Your turn').isVisible();
  const [first, second] = hostFirst ? [page, friend] : [friend, page];
  await guess(first, hostFirst ? 'beach' : 'storm');
  await expect(second.getByText(/final guess|last guess/i)).toBeVisible();
  await guess(second, 'crane');
  await expect(first.getByRole('heading', { name: 'You win!' })).toBeVisible();
  await expect(second.getByRole('heading', { name: /wins\.$/ })).toBeVisible();

  // The loser plays on for practice: their word stays hidden until found, and the result stands.
  await button(second, 'Keep guessing').click();
  await guess(second, 'plant');
  await guess(second, hostFirst ? 'storm' : 'beach');
  await expect(second.getByText(/^Found it after 2 practice guesses\. The game counted/)).toBeVisible();
  await expect(second.getByRole('heading', { name: /wins\.$/ })).toBeVisible();

  // Rematch: the loser asks with a new word, the winner sees it on their result at once and accepts.
  await button(second, 'Rematch').click();
  await guess(second, 'crane');
  await expect(second.getByRole('heading', { name: /Rematch sent to/ })).toBeVisible();
  await first.getByRole('button', { name: /wants a rematch/ }).click();
  await expect(first.getByRole('heading', { name: /wants a rematch/ })).toBeVisible();
  await guess(first, 'plant');
  await expect(first.getByText(/Your turn|Their turn/)).toBeVisible();
  await expect(second.getByText(/Your turn|Their turn/)).toBeVisible();
});

test('Rush with Friends: the largest lobby, 5 players, ranked by time, plays to the end', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await unlockAll(page);
  await modeButton(page, 'Word Sets').click();
  await modeButton(page, 'With friends').click();
  await button(page, 'Open a lobby').click();
  // Ranked by time: the lobby opens on the host's pick.
  await button(page, 'Rush · fastest').click();
  await button(page, /^Medium/).click();
  await button(page, 'Open lobby').click();
  await expect(page.getByRole('button', { name: 'Rush · fastest' })).toHaveAttribute('aria-pressed', 'true');
  const code = (await page.locator('.lobby-code').textContent())!.trim();
  const link = `/?lobby=${code}`;

  const players = [page];
  for (let i = 0; i < 4; i++) {
    const player = await newPlayer(browser, page);
    await player.goto(link);
    await button(player, 'Join').click();
    // Each join has landed (the Join button is gone) before the next player opens the link.
    await expect(button(player, 'Join')).toHaveCount(0);
    players.push(player);
  }
  await expect(page.locator('.lobby-seats li:not(.empty)')).toHaveCount(5);
  await expect(page.locator('.lobby-seats li.empty')).toHaveCount(0);
  await button(page, 'Start the Rush').click();
  for (const player of players) await expect(player.getByRole('list', { name: 'Your guesses at word 1' })).toBeVisible();
  await expectAccessible(players[1]);

  // Everyone gives up the rest, which ends it.
  for (const player of players) {
    await button(player, 'Menu').click();
    await button(player, 'Give up the rest of this Rush').click();
    await button(player, 'Give up the rest').click();
  }
  for (const player of players) await expect(player.locator('.rush-result')).toBeVisible();
});
