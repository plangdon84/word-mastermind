/*
 * Draws public/og-image.png, the 1200×630 picture a shared link shows in
 * Messages, WhatsApp and Discord (Dev Plan item 18j), from the logo and the
 * app's own fonts and colours. Run it again only when the logo or the look
 * changes: `node scripts/og-image.ts`. PLAYWRIGHT_CHROMIUM_PATH runs Chromium
 * from somewhere other than Playwright's own download.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dirname, '..');
const logo = readFileSync(join(root, 'src/assets/logo.svg'), 'utf8');
const font = (weight: number) =>
  readFileSync(join(root, `node_modules/@fontsource/rubik/files/rubik-latin-${weight}-normal.woff2`)).toString('base64');

// A sample guess, CRANE scoring 2, with two letters marked in and two out.
const bubbles = [['c', 'out'], ['r', 'in'], ['a', 'plain'], ['n', 'out'], ['e', 'in']]
  .map(([letter, mark]) => `<span class="b ${mark}">${letter}</span>`).join('');

const html = `<!doctype html><html><head><style>
@font-face { font-family: Rubik; font-weight: 400; src: url(data:font/woff2;base64,${font(400)}) format('woff2'); }
@font-face { font-family: Rubik; font-weight: 700; src: url(data:font/woff2;base64,${font(700)}) format('woff2'); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; background: #EDF0F3; color: #16191D; font-family: Rubik, sans-serif;
  display: flex; align-items: center; gap: 64px; padding: 0 80px; box-sizing: border-box; }
.logo { width: 330px; flex: none; }
.logo svg { display: block; width: 100%; height: auto; }
h1 { font-size: 76px; line-height: 1.05; margin: 0 0 18px; font-weight: 700; }
p { font-size: 32px; line-height: 1.35; margin: 0 0 40px; color: #3E4752; }
.row { display: flex; align-items: center; gap: 14px; }
.b { width: 72px; height: 72px; border-radius: 50%; display: grid; place-items: center; font-size: 38px;
  font-weight: 700; text-transform: uppercase; }
.plain { background: #111315; color: #fff; }
.in { background: #2E7D32; color: #fff; }
.out { background: #BDBDBD; color: #000; }
.dash { font-size: 40px; color: #5B6570; margin: 0 6px; }
.score { font-size: 48px; font-weight: 700; }
</style></head><body>
<div class="logo">${logo}</div>
<div>
  <h1>Word Mastermind</h1>
  <p>Find the secret word from how many letters each guess shares with it.</p>
  <div class="row">${bubbles}<span class="dash">–</span><span class="score">2</span></div>
</div>
</body></html>`;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, 'public/og-image.png') });
await browser.close();
console.log('Wrote public/og-image.png');
