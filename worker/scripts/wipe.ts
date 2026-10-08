// Wipes game history and leaderboards from one environment's D1 database.
// Usage: npm run wipe -- <local|staging|production>
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { confirmed, ENVIRONMENTS, isEnvironment, WIPE_TABLES, wranglerArgs } from '../src/wipe.ts';

const environment = process.argv[2];
if (!isEnvironment(environment)) {
  console.error(`Usage: npm run wipe -- <${ENVIRONMENTS.join('|')}>`);
  process.exit(2);
}

console.log(`This deletes every row from ${WIPE_TABLES.join(', ')} in the ${environment} D1 database.`);
console.log('It cannot be undone. Players (guests) are kept.');
const readline = createInterface({ input: process.stdin, output: process.stdout });
const typed = await readline.question(`Type "${environment}" to go ahead: `);
readline.close();
if (!confirmed(environment, typed)) {
  console.log('Not confirmed; nothing was wiped.');
  process.exit(1);
}

const config = join(import.meta.dirname, '..', 'wrangler.toml');
const result = spawnSync('npx', ['wrangler', ...wranglerArgs(environment, config)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
