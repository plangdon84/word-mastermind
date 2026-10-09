// The local game server for the browser tests (playwright.config.ts):
// `wrangler dev` with a fresh database in e2e/.state, so every run starts
// empty. The rate limits (worker/src/limits.ts) are raised in a copy of the
// config, since one test run makes far more guests and games from one
// address than a player would; their own tests are in limits.test.ts. The
// Daily Rush gets the made-up test sets, and the Daily Word a known word
// (worker/src/testThemes.ts).
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { themeDaysSql } from '../worker/src/themeDays.ts';
import { testDailyWordsSql, testThemeDays } from '../worker/src/testThemes.ts';

const root = join(import.meta.dirname, '..');
const state = join(root, 'e2e', '.state');
const config = join(root, 'worker', 'wrangler.e2e.toml');

const base = readFileSync(join(root, 'worker', 'wrangler.toml'), 'utf8');
// Only the top-level (local) section: everything before the first [env.…].
const local = base.slice(0, base.search(/^\[env\./m));
writeFileSync(config, `# Made by e2e/worker.ts for the browser tests; not committed.\n${local.replace(/limit = \d+/g, 'limit = 100000')}`);

rmSync(state, { recursive: true, force: true });
const wrangler = (...args: string[]) => ['wrangler', ...args, '--config', config, '--persist-to', state];
const migrate = spawnSync('npx', wrangler('d1', 'migrations', 'apply', 'DB', '--local'), { cwd: root, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const themes = join(state, 'daily-themes.sql');
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
writeFileSync(themes, `${themeDaysSql(testThemeDays(yesterday, 3), '0000-00-00')}\n${testDailyWordsSql(yesterday, 3)}`);
const load = spawnSync('npx', wrangler('d1', 'execute', 'DB', '--local', '--file', themes), { cwd: root, stdio: 'inherit' });
if (load.status !== 0) process.exit(load.status ?? 1);

// Sign-in links are printed here (LOG_LOGIN_LINKS); e2e/helpers.ts reads them from this log.
const log = join(state, 'worker.log');
writeFileSync(log, '');
const server = spawn('npx', [...wrangler('dev', '--port', '8787', '--ip', '127.0.0.1'), '--show-interactive-dev-session=false'], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
});
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    writeFileSync(log, chunk, { flag: 'a' });
  });
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
