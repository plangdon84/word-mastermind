// Checks what a phone downloads before the app can start (Dev Plan item 17,
// docs/test-plan.md "Performance"): the scripts and styles `dist/index.html`
// loads, gzipped, against budgets, and that the word definitions aren't among
// them (they load when ⓘ is first tapped). Run after `npm run build`.
// Usage: npm run check:size
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGETS = { script: 140 * KB, style: 12 * KB };

const dist = join(import.meta.dirname, '..', 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
// Every script, preloaded module and stylesheet the page asks for up front.
const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(js|css))"/g)].map(([, path, ext]) => ({ path, ext }));

const gzipped = (path: string) => gzipSync(readFileSync(join(dist, path)), { level: 9 }).length;
const total = { script: 0, style: 0 };
for (const { path, ext } of assets) {
  const size = gzipped(path);
  total[ext === 'js' ? 'script' : 'style'] += size;
  console.log(`${path.padEnd(40)} ${(size / KB).toFixed(1).padStart(6)} KB gzipped`);
}

const problems: string[] = [];
if (total.script === 0) problems.push('no scripts found in dist/index.html: run npm run build first');
for (const kind of ['script', 'style'] as const) {
  const line = `${kind}s: ${(total[kind] / KB).toFixed(1)} KB of ${BUDGETS[kind] / KB} KB`;
  console.log(line);
  if (total[kind] > BUDGETS[kind]) problems.push(`over budget, ${line}`);
}
if (assets.some(({ path }) => path.includes('definitions'))) problems.push('the definitions load up front; they should wait for ⓘ');

if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log('✓ within budget');
