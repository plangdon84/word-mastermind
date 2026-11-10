// Re-rates every rated two player game under today's rules (Dev Plan item
// 19zh): a draw is a plain Glicko-2 result. Run once rated play is paused
// and no rated game is in progress, on staging first, then production:
//
//   npm run rerate -- <local|staging|production>            checks, and shows what would change
//   npm run rerate -- <local|staging|production> --write    then writes it, once you type the name
//
// It replays every rated game under the old rules first and stops unless
// that gives back every stored rating exactly (`checkRerate` in
// worker/src/rerate.ts). Before writing, it saves SQL that puts every row
// back as it was, and afterwards it reads everything again to check.
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ENVIRONMENTS, isEnvironment, type Environment } from '../src/wipe.ts';

// src/game imports the word lists as Vite does (`?raw`) and without extensions.
register('../../scripts/gameLoader.ts', import.meta.url);
const { checkRerate, rerateSql, RUSH_POOL } = await import('../src/rerate.ts');
type Check = ReturnType<typeof checkRerate>;

const [environment, flag] = process.argv.slice(2);
if (!isEnvironment(environment) || (flag !== undefined && flag !== '--write')) {
  console.error(`Usage: npm run rerate -- <${ENVIRONMENTS.join('|')}> [--write]`);
  process.exit(2);
}

const config = join(import.meta.dirname, '..', 'wrangler.toml');
const target = (env: Environment) => (env === 'local' ? ['--local', '--env='] : ['--remote', `--env=${env}`]);

/** Runs `wrangler d1 execute` on the environment, returning what it prints (its JSON with `--json`). */
function wrangler(args: string[]) {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--config', config, ...target(environment as Environment), '--yes', ...args], {
    encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) {
    console.error('wrangler failed; nothing more was done.');
    process.exit(1);
  }
  return result.stdout;
}

function query<T>(sql: string): T[] {
  const out = JSON.parse(wrangler(['--json', '--command', sql])) as { results: T[] }[];
  return out.flatMap((r) => r.results);
}

function read() {
  const rush = `'${RUSH_POOL}'`;
  const rows = query<Parameters<typeof checkRerate>[0][number]>(
    `SELECT game_id, account_id, pool, rating_before, rd_before, rating_after, rd_after, rated_at, computer_recall FROM rated_games WHERE pool <> ${rush}`,
  );
  const ratings = query<Parameters<typeof checkRerate>[1][number]>(
    `SELECT account_id, pool, rating, rd, volatility, games, rated_at, computer_games FROM ratings WHERE pool <> ${rush}`,
  );
  const records = new Map(query<{ id: string; record: string }>(
    `SELECT id, record FROM games WHERE id IN (SELECT game_id FROM rated_games WHERE pool <> ${rush})`,
  ).map((g) => [g.id, g.record]));
  return checkRerate(rows, ratings, records);
}

const stopIfProblems = (check: Check) => {
  if (check.problems.length === 0) return;
  console.error(`Nothing was written. Fix these first:\n${check.problems.join('\n')}`);
  process.exit(1);
};

/** What changes, in numbers only: never a player's ID, which is a credential. */
function summary(check: Check) {
  const moves = check.ratings.map(({ row, rating }) => rating.rating - row.rating).sort((a, b) => a - b);
  const round = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1);
  console.log(`${check.games} rated games, ${check.draws} of them draws.`);
  console.log(`${check.ratings.length} ratings and ${check.rows.length} games' changes to rewrite.`);
  if (check.alreadyNew > 0) console.log(`${check.alreadyNew} rows already hold the new rules' values, from an earlier write.`);
  if (moves.length > 0) console.log(`Each rating's move, lowest first: ${moves.map(round).join(', ')}`);
}

const check = read();
stopIfProblems(check);
console.log(check.alreadyNew > 0
  ? `In ${environment}, every stored rating is what the old rules or the new ones give.`
  : `In ${environment}, replaying every rated game under the old rules gives back every stored rating.`);
summary(check);
if (check.ratings.length === 0 && check.rows.length === 0) {
  console.log('Nothing to write.');
  process.exit(0);
}
if (flag !== '--write') {
  console.log('Nothing was written. Run again with --write to write it.');
  process.exit(0);
}

const readline = createInterface({ input: process.stdin, output: process.stdout });
const typed = await readline.question(`Rated play must be paused, with no rated game in progress. Type "${environment}" to write: `);
readline.close();
if (typed.trim() !== environment) {
  console.log('Not confirmed; nothing was written.');
  process.exit(1);
}

const folder = mkdtempSync(join(tmpdir(), 'rerate-'));
// The SQL holds players' IDs, which are credentials: only this user may read it.
const restore = join(folder, `restore-${environment}.sql`);
writeFileSync(restore, rerateSql(check, true), { mode: 0o600 });
console.log(`To put every row back as it was: npx wrangler d1 execute DB --config ${config} ${target(environment).join(' ')} --file ${restore}`);
const file = join(folder, 'rerate.sql');
writeFileSync(file, rerateSql(check), { mode: 0o600 });
try {
  wrangler(['--json', '--file', file]);
} finally {
  rmSync(file, { force: true });
}

const after = read();
stopIfProblems(after);
if (after.ratings.length > 0 || after.rows.length > 0) {
  console.error(`Written, but ${after.ratings.length} ratings and ${after.rows.length} games' changes still differ (a game rated meanwhile?). Run it again.`);
  process.exit(1);
}
console.log('Done: every rated game now has the new rules\' ratings.');
console.log(`Delete ${folder} once you're sure; it holds players' IDs.`);

