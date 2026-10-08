import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/*
 * Shared steps for the browser tests. Tests set things up the way a player's
 * browser would hold them (history in IndexedDB, saves in localStorage), so
 * nothing test-only ships in the app.
 */

const PREFIX = 'word-mastermind:';
const STEP = 10_000;

/** Finished games, as the app saves them (src/game/history.ts). */
export type Entry = Record<string, unknown> & { id: string; record: Record<string, unknown> & { startedAt: number } };

export function soloWin(id: string, startedAt: number, guesses: readonly string[] = ['crane', 'beach']): Entry {
  return {
    id, version: 1, mode: 'single', marks: {},
    record: {
      secret: 'beach', startedAt, difficulty: 'medium',
      moves: guesses.map((word, i) => ({ kind: 'guess', word, at: startedAt + (i + 1) * STEP })),
    },
  };
}

/** One game for each unlock step (src/game/unlocks.ts): every mode is open after these. */
export function unlockingGames(start = Date.UTC(2026, 8, 1)): Entry[] {
  return [
    soloWin('unlock-single', start),
    {
      id: 'unlock-computer', version: 1, mode: 'computer', marks: {},
      record: {
        humanSecret: 'storm', computerSecret: 'beach', first: 'human', startedAt: start + 60_000, difficulty: 'medium', strength: 'casual',
        moves: [
          { side: 'human', kind: 'guess', word: 'beach', at: start + 70_000 },
          { side: 'computer', kind: 'guess', word: 'crane', at: start + 80_000 },
        ],
      },
    },
    {
      id: 'unlock-rush', version: 1, mode: 'rush', marks: [{}, {}, {}, {}],
      record: {
        words: ['beach', 'crane', 'storm', 'house'], startedAt: start + 120_000, timeLimitMs: null, pausable: true, difficulty: 'medium',
        moves: ['beach', 'crane', 'storm', 'house'].map((word, i) => ({ kind: 'guess', word, at: start + 130_000 + i * STEP })),
      },
    },
  ];
}

/** Puts games into this browser's history, then reloads so the app reads them. */
export async function seedHistory(page: Page, entries: readonly Entry[]): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.evaluate(async (games) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('word-mastermind', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('games', { keyPath: 'id' }).createIndex('startedAt', 'record.startedAt');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('games', 'readwrite');
    for (const game of games) tx.objectStore('games').put(game);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, entries);
  await page.reload();
}

/** Opens every mode, and skips the tutorial card. */
export async function unlockAll(page: Page): Promise<void> {
  await page.goto('/');
  await setStorage(page, 'settings', { ...(await getStorage(page, 'settings')), showTutorial: false });
  await seedHistory(page, unlockingGames());
}

export async function getStorage(page: Page, key: string): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), `${PREFIX}${key}:v1`);
  return raw ? JSON.parse(raw) : null;
}

/** A game just started, once the app has saved it: the save lands just after the screen first shows. */
export async function savedGame(page: Page, key: string): Promise<Record<string, unknown>> {
  await expect.poll(() => getStorage(page, key), { message: `the ${key} game was saved` }).not.toBeNull();
  return (await getStorage(page, key))!.record as Record<string, unknown>;
}

export async function setStorage(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`${PREFIX}${key}:v1`, JSON.stringify(value)] as const);
}

/** Types a word on the physical keyboard and submits it. */
export async function guess(page: Page, word: string): Promise<void> {
  await page.keyboard.type(word);
  await page.keyboard.press('Enter');
}

/** The title screen's mode buttons, by name. */
export const modeButton = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name}`) });

/** From the title screen: a single player game at a difficulty. Returns its secret word. */
export async function startSolo(page: Page, difficulty = 'Medium'): Promise<string> {
  await modeButton(page, 'Single player').click();
  await page.getByRole('button', { name: new RegExp(`^${difficulty}`) }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.getByText(/No guesses yet/)).toBeVisible();
  return (await savedGame(page, 'solo')).secret as string;
}

/** A new browser with its own storage: another device, or another player. */
export async function newPlayer(browser: Browser, page: Page): Promise<Page> {
  const context = await browser.newContext({ ...pageOptions(page) });
  await trackSockets(context);
  return context.newPage();
}

/**
 * Counts each page's open WebSockets in this browser, from its next page
 * load: a friend game's page keeps one open to hear each move at once
 * (src/app/liveSocket.ts), and polls only every 10 seconds without it.
 */
export async function trackSockets(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const Native = window.WebSocket;
    let open = 0;
    Object.defineProperty(window, 'openSockets', { get: () => open });
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        let opened = false;
        this.addEventListener('open', () => {
          opened = true;
          open++;
        });
        this.addEventListener('close', () => {
          if (opened) open--;
        });
      }
    };
  });
}

/**
 * Waits until a friend game's page is listening for moves (trackSockets),
 * so a move made next shows there at once rather than racing its 10-second
 * check (issue #148).
 */
export async function listening(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => (window as unknown as { openSockets?: number }).openSockets ?? 0),
    { message: "the game's live socket opened" },
  ).toBeGreaterThan(0);
}

function pageOptions(page: Page) {
  const size = page.viewportSize();
  return size ? { viewport: size, hasTouch: true, isMobile: page.context().browser()?.browserType().name() !== 'firefox' } : {};
}

const workerLog = () => readFileSync(join(import.meta.dirname, '.state', 'worker.log'), 'utf8');

/** How many sign-in emails the local server has printed for this address. */
export const loginLinkCount = (email: string) => workerLog().split(`Email to ${email}`).length - 1;

/**
 * The sign-in link the local server prints for this address (LOG_LOGIN_LINKS,
 * worker/src/mail.ts) once there are more than `before` of them, so an older,
 * used link is never taken for the new one.
 */
export async function loginLink(email: string, before: number): Promise<string> {
  let link: string | undefined;
  await expect.poll(() => {
    if (loginLinkCount(email) <= before) return undefined;
    const text = workerLog();
    link = text.slice(text.lastIndexOf(`Email to ${email}`)).match(/https?:\/\/\S+/)?.[0];
    return link;
  }, { timeout: 15_000 }).toBeTruthy();
  return link!;
}

/** How many finished games this browser's history holds. */
export function historyCount(page: Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('word-mastermind', 1);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('games')) return resolve(0);
      const count = db.transaction('games').objectStore('games').count();
      count.onsuccess = () => { resolve(count.result); db.close(); };
      count.onerror = () => reject(count.error);
    };
    request.onerror = () => reject(request.error);
  }));
}
