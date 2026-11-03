// Measures the ladder computers' ratings (Dev Plan item 19o, README
// "Computer ratings"): 20,000 solves of random secret-list words at each
// recall from Expert's 0.38, and 0.40 to 1.00 in steps of 0.05, then a
// rating for each from every pair's head-to-head score (the fewer guesses
// win, the same count draws), Expert pinned at 1500. Copy the rows for the
// table's recalls into COMPUTER_RATINGS in src/game/computerRatings.ts.
// Run by hand after a word-list change; it's not part of `npm test`.
// Usage: npm run calibrate [-- --solves 20000 --seed 1]
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { register } from 'node:module';
import { parseArgs } from 'node:util';

register('./gameLoader.ts', import.meta.url);

const { values } = parseArgs({ options: { solves: { type: 'string', default: '20000' }, seed: { type: 'string', default: '1' } } });
const solves = Number(values.solves);
const seed = Number(values.seed);
if (!(solves > 0) || !Number.isInteger(seed)) throw new Error('--solves must be a positive number and --seed a whole number');

const { averageOf, COMPUTER_RATINGS, COMPUTER_RECALL_FLOOR, expectedScore, fitRatings, guessCounts, seededRandom } =
  await import('../src/game/computerRatings.ts');

const recalls = [COMPUTER_RECALL_FLOOR];
for (let step = 8; step <= 20; step++) recalls.push(step / 20);

const counts = recalls.map((recall, i) => {
  const started = Date.now();
  const spread = guessCounts(recall, solves, seededRandom(seed + i));
  console.error(`recall ${recall.toFixed(2)}: ${solves} solves in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return spread;
});
const expected = counts.map((a) => counts.map((b) => expectedScore(a, b)));
const ratings = fitRatings(expected, 0);

const expert = counts[0];
console.log('recall  average  rating  vs Expert  in table');
recalls.forEach((recall, i) => {
  const inTable = COMPUTER_RATINGS.some((c) => c.recall === recall) ? 'yes' : '';
  console.log(`${recall.toFixed(2).padStart(6)}  ${averageOf(counts[i]).toFixed(2).padStart(7)}  ${ratings[i].toFixed(0).padStart(6)}  ${(expectedScore(counts[i], expert) * 100).toFixed(1).padStart(8)}%  ${inTable}`);
});
