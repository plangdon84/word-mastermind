// Re-rates every rated two player game under today's rules (Dev Plan item
// 19zh): a draw is a plain Glicko-2 result. Run once rated play is paused
// and no rated game is in progress, on staging first, then production:
//
//   npm run rerate -- <local|staging|production>            checks, and shows what would change
//   npm run rerate -- <local|staging|production> --write    then writes it, once you type the name
//
// Add --new-rule-from=<time> (e.g. 2026-11-12T20:00:00Z), the deploy's
// time, if a rated game may have ended between the deploy and the run:
// games rated from then were rated by the new rules.
//
// It replays every rated game as it was rated first and stops unless that
// gives back every stored rating exactly (`checkRerate` in
// worker/src/rerate.ts). Before writing, it saves SQL that puts every row
// back as it was, and afterwards it reads everything again to check.
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { confirmed, ENVIRONMENTS, isEnvironment, wranglerTarget, type Environment } from '../src/wipe.ts';

// src/game imports the word lists as Vite does (`?raw`) and without extensions.
register('../../scripts/gameLoader.ts', import.meta.url);
const { checkRerate, rerateSql, RUSH_POOL } = await import('../src/rerate.ts');
type Check = ReturnType<typeof checkRerate>;

/** A failure that stops the script, with what to tell the operator. */
class Stop extends Error {}

const usage = `Usage: npm run rerate -- <${ENVIRONMENTS.join('|')}> [--write] [--new-rule-from=<time>]`;
const { positionals, values } = parseArgs({
  allowPositionals: true, options: { write: { type: 'boolean' }, 'new-rule-from': { type: 'string' } },
});
const [named] = positionals;
const newRuleFrom = values['new-rule-from'] === undefined ? Infinity : Date.parse(values['new-rule-from']);
if (!isEnvironment(named) || positionals.length !== 1 || Number.isNaN(newRuleFrom)) {
  console.error(usage);
  process.exit(2);
}
const environment = named as Environment;

const config = join(import.meta.dirname, '..', 'wrangler.toml');

/** Runs `wrangler d1 execute` on the environment, returning its JSON output. */
function wrangler(args: string[]): string {
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--config', config, ...wranglerTarget(environment), '--yes', '--json', ...args], {
    encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (result.status !== 0) throw new Stop('wrangler failed.');
  return result.stdout;
}

function query<T>(sql: string): T[] {
  const out = JSON.parse(wrangler(['--command', sql])) as { results: T[] }[];
  return out.flatMap((r) => r.results);
}

function read(): Check {
  const rush = `'${RUSH_POOL}'`;
  const rows = query<Parameters<typeof checkRerate>[0][number]>(
    `SELECT game_id, account_id, pool, rating_before, rd_before, rating_after, rd_after, rated_at, computer_recall, score
     FROM rated_games WHERE pool <> ${rush}`,
  );
  const ratings = query<Parameters<typeof checkRerate>[1][number]>(
    `SELECT account_id, pool, rating, rd, volatility, games, rated_at, computer_games FROM ratings WHERE pool <> ${rush}`,
  );
  const records = new Map(query<{ id: string; record: string }>(
    `SELECT id, record FROM games WHERE id IN (SELECT game_id FROM rated_games WHERE pool <> ${rush})`,
  ).map((g) => [g.id, g.record]));
  return checkRerate(rows, ratings, records, newRuleFrom);
}

/** What changes, in numbers only: never a player's ID, which is a credential. */
function summary(check: Check) {
  const moves = check.ratings.map(({ row, rating }) => rating.rating - row.rating).sort((a, b) => a - b);
  const round = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1);
  console.log(`${check.games} rated games, ${check.draws} of them draws.`);
  console.log(`${check.ratings.length} ratings and ${check.rows.length} games' changes to rewrite.`);
  if (check.alreadyNew > 0) console.log(`${check.alreadyNew} rows already hold the new rules' values.`);
  if (moves.length > 0) console.log(`Each rating's move, lowest first: ${moves.map(round).join(', ')}`);
}

async function main(): Promise<number> {
  const check = read();
  if (check.problems.length > 0) {
    console.error(`Nothing was written. Fix these first:\n${check.problems.join('\n')}`);
    return 1;
  }
  console.log(`In ${environment}, every stored rating is what replaying the rated games gives.`);
  summary(check);
  if (check.ratings.length === 0 && check.rows.length === 0) {
    console.log('Nothing to write.');
    return 0;
  }
  if (!values.write) {
    console.log('Nothing was written. Run again with --write to write it.');
    return 0;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const typed = await readline.question(`Rated play must be paused, with no rated game in progress. Type "${environment}" to write: `);
  readline.close();
  if (!confirmed(environment, typed)) {
    console.log('Not confirmed; nothing was written.');
    return 1;
  }

  const folder = mkdtempSync(join(tmpdir(), 'rerate-'));
  // The SQL holds players' IDs, which are credentials: only this user may read it.
  const restore = join(folder, `restore-${environment}.sql`);
  writeFileSync(restore, rerateSql(check, true), { mode: 0o600 });
  const undo = `To put every row back as it was: npx wrangler d1 execute DB --config ${config} ${wranglerTarget(environment).join(' ')} --file ${restore}`;
  console.log(undo);
  console.log(`Delete ${folder} once you're sure; it holds players' IDs.`);
  const file = join(folder, 'rerate.sql');
  writeFileSync(file, rerateSql(check), { mode: 0o600 });
  try {
    wrangler(['--file', file]);
  } catch (e) {
    console.error(`The write may have run in part. Run the check again, and if it can't finish, undo it.\n${undo}`);
    throw e;
  } finally {
    rmSync(file, { force: true });
  }

  const after = read();
  if (after.problems.length > 0 || after.ratings.length > 0 || after.rows.length > 0) {
    console.error(`Written, but the check afterwards found ${after.ratings.length} ratings and ${after.rows.length} games' changes `
      + `still to rewrite${after.problems.length ? `, and these problems:\n${after.problems.join('\n')}` : ''}.`);
    console.error(`A game rated meanwhile? Run it again (with --new-rule-from), or undo it.\n${undo}`);
    return 1;
  }
  console.log('Done: every rated game now has the new rules\' ratings.');
  return 0;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.error(e.message);
  process.exitCode = 1;
}
