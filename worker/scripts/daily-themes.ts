// Loads the Daily Rush's themes into one environment's D1 database
// (`daily_themes`, Dev Plan item 18ua). The themes and calendar are kept in
// a private repo, never this one, which is public:
//
//   npm run daily-themes -- <staging|production> <folder with daily-rush-themes.json and daily-rush-calendar.json>
//   npm run daily-themes -- local --test     made-up sets around today, for `npm run worker:dev`
//
// New days and days to come are loaded; today and the days before it are
// never changed (`themeDaysSql`). Runs with Node's built-in TypeScript
// support (Node 22.18 or later).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dailyDay } from '../../src/game/dailyDays.ts';
import { calendarDays, themeDayProblems, themeDaysSql, type ThemeDay } from '../src/themeDays.ts';
import { testThemeDays } from '../src/testThemes.ts';
import { ENVIRONMENTS, isEnvironment } from '../src/wipe.ts';

const [environment, source] = process.argv.slice(2);
if (!isEnvironment(environment) || !source) {
  console.error(`Usage: npm run daily-themes -- <${ENVIRONMENTS.join('|')}> <folder>, or: npm run daily-themes -- local --test`);
  process.exit(2);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const today = dailyDay(Date.now());
let days: ThemeDay[];
if (source === '--test') {
  // Made-up sets must never reach a server players use.
  if (environment !== 'local') {
    console.error('The test sets are for a local server only.');
    process.exit(2);
  }
  days = testThemeDays(new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10), 400);
} else {
  const read = (file: string) => JSON.parse(readFileSync(join(source, file), 'utf8'));
  days = calendarDays({ themes: read('daily-rush-themes.json'), calendar: read('daily-rush-calendar.json') });
}

// The same rule as the game's secret words (src/game/words.ts), on the list the app ships.
const secret = new Set(readFileSync(join(import.meta.dirname, '..', '..', 'wordlist', 'lists', 'secret.txt'), 'utf8').split(/\s+/));
const isSecretWord = (word: string) => secret.has(word) && /^[a-z]{5}$/.test(word) && new Set(word).size === 5;
const problems = themeDayProblems(days, isSecretWord);
if (problems.length) {
  console.error(`Nothing loaded. Fix these first:\n${problems.join('\n')}`);
  process.exit(1);
}

const sorted = days.map((d) => d.day).sort();
console.log(`Loading ${days.length} days (${sorted[0]} to ${sorted.at(-1)}) into ${environment}; today (${today}) and earlier days stay as they are.`);
const folder = mkdtempSync(join(tmpdir(), 'daily-themes-'));
const file = join(folder, 'daily-themes.sql');
try {
  writeFileSync(file, themeDaysSql(days, today));
  const config = join(import.meta.dirname, '..', 'wrangler.toml');
  const target = environment === 'local' ? ['--local', '--env='] : ['--remote', `--env=${environment}`];
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--config', config, ...target, '--file', file], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  // The SQL holds the answers: never leave it lying around.
  rmSync(folder, { recursive: true, force: true });
}
