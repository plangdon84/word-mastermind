// Lighthouse on the built app (Dev Plan item 17, docs/test-plan.md
// "Performance"): serves `dist/` with `vite preview`, runs Lighthouse's
// mobile profile (a mid-range phone on a slow 4G connection) three times,
// and reports the median scores, saving the median run's report to
// `lighthouse/`. Run after `npm run build`.
// Usage: npm run lighthouse              reports, warning below the target
//        npm run lighthouse -- --strict  fails below the target
// Set CHROME_PATH to use a particular Chrome or Chromium.
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse, { type RunnerResult } from 'lighthouse';
import { preview } from 'vite';

const TARGET = { performance: 0.9 };
const RUNS = 3;
const CATEGORIES = ['performance', 'accessibility', 'best-practices'] as const;

const root = join(import.meta.dirname, '..');
const server = await preview({ root, preview: { port: 4173, strictPort: true }, logLevel: 'warn' });
const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
let failed = false;
try {
  const runs: RunnerResult[] = [];
  for (let i = 0; i < RUNS; i++) {
    const result = await lighthouse('http://localhost:4173/', { port: chrome.port, output: 'html', logLevel: 'error', onlyCategories: [...CATEGORIES] });
    if (!result) throw new Error('Lighthouse returned nothing');
    runs.push(result);
  }
  const score = (run: RunnerResult, category: string) => run.lhr.categories[category]?.score ?? 0;
  runs.sort((a, b) => score(a, 'performance') - score(b, 'performance'));
  const median = runs[Math.floor(RUNS / 2)];

  const dir = join(root, 'lighthouse');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.html'), median.report as string);
  for (const category of CATEGORIES) console.log(`${category.padEnd(16)} ${Math.round(score(median, category) * 100)}`);
  for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift']) {
    console.log(`${id.padEnd(28)} ${median.lhr.audits[id]?.displayValue ?? '?'}`);
  }
  console.log(`Report: lighthouse/report.html`);

  if (score(median, 'performance') < TARGET.performance) {
    const message = `performance ${Math.round(score(median, 'performance') * 100)} is under the target of ${TARGET.performance * 100}`;
    if (process.argv.includes('--strict')) {
      console.error(`✗ ${message}`);
      failed = true;
    } else console.warn(`! ${message}`);
  }
} finally {
  await chrome.kill();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
}
process.exit(failed ? 1 : 0);
