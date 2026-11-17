// Benchmarks the experimental human-like computer (src/game/humanLike.ts)
// against the ladder's recall computers: every computer solves the same
// secret-list words, then each pair's head-to-head score (the fewer guesses
// win, the same count draws) gives ratings on the ladder's scale (Expert's
// 0.38 pinned at 1500), and the results are split by how many anagrams a
// word has on the secret list (REAPS has many; most words have none).
// Run by hand; it's not part of `npm test`.
// Usage: npm run benchmark-human [-- --games 2000 --seed 1 --styles novice,intermediate,expert]
// Runs with Node's built-in TypeScript support (Node 22.18 or later).
import { register } from 'node:module';
import { parseArgs } from 'node:util';

register('./gameLoader.ts', import.meta.url);

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '2000' },
    seed: { type: 'string', default: '1' },
    styles: { type: 'string', default: 'novice,intermediate,expert' },
    words: { type: 'string', default: '' },
  },
});
const games = Number(values.games);
const seed = Number(values.seed);
if (!(games > 0) || !Number.isInteger(seed)) throw new Error('--games must be a positive number and --seed a whole number');

const { averageOf, COMPUTER_RATINGS, expectedScore, fitRatings, seededRandom } = await import('../src/game/computerRatings.ts');
const { pickGuessWithRecall } = await import('../src/game/computer.ts');
const { HUMAN_STYLES, pickHumanLikeGuess } = await import('../src/game/humanLike.ts');
const { evaluateGuess } = await import('../src/game/scoring.ts');
const { SECRET_WORDS } = await import('../src/game/wordLists.ts');
type GuessResult = import('../src/game/scoring.ts').GuessResult;

// The same words for every computer.
const pick = seededRandom(seed);
const secrets = values.words
  ? values.words.split(',').map((w) => w.trim().toLowerCase())
  : Array.from({ length: games }, () => SECRET_WORDS[Math.floor(pick() * SECRET_WORDS.length)]);

// How many secret-list words share each word's letters (itself included).
const sorted = (w: string) => [...w].sort().join('');
const anagramCount = new Map<string, number>();
for (const w of SECRET_WORDS) anagramCount.set(sorted(w), (anagramCount.get(sorted(w)) ?? 0) + 1);
const bucketOf = (w: string) => {
  const n = anagramCount.get(sorted(w)) ?? 1;
  return n === 1 ? 'no anagrams' : n <= 3 ? '1-2 anagrams' : '3+ anagrams';
};
const BUCKETS = ['no anagrams', '1-2 anagrams', '3+ anagrams'];

type Picker = (history: readonly GuessResult[], random: () => number) => string;
interface Computer { name: string; rating?: number; picker: Picker }
const computers: Computer[] = [
  ...COMPUTER_RATINGS.map((c) => ({
    name: `recall ${c.recall.toFixed(2)}`, rating: c.rating,
    picker: ((h, r) => pickGuessWithRecall(h, c.recall, r)) as Picker,
  })),
  ...values.styles.split(',').filter(Boolean).map((style) => {
    const s = HUMAN_STYLES[style as keyof typeof HUMAN_STYLES];
    if (!s) throw new Error(`No style ${style}`);
    return { name: `human ${style}`, picker: ((h, r) => pickHumanLikeGuess(h, s, r)) as Picker };
  }),
];

function solve(secret: string, picker: Picker, random: () => number): number {
  const history: GuessResult[] = [];
  for (;;) {
    const result = evaluateGuess(picker(history, random), secret);
    history.push(result);
    if (result.isWin) return history.length;
    if (history.length > 200) throw new Error(`No solve of ${secret} in 200 guesses`);
  }
}

// guesses[c][g]: computer c's guesses at secret g.
const guesses = computers.map((computer, c) => {
  const started = Date.now();
  const random = seededRandom(seed * 1000 + c + 1);
  const row = secrets.map((secret) => solve(secret, computer.picker, random));
  console.error(`${computer.name}: ${secrets.length} solves in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  return row;
});

const spreadOf = (row: readonly number[], keep: (g: number) => boolean = () => true) => {
  const counts: number[] = [];
  row.forEach((n, g) => { if (keep(g)) counts[n] = (counts[n] ?? 0) + 1; });
  return counts;
};
const spreads = guesses.map((row) => spreadOf(row));
const ratings = fitRatings(spreads.map((a) => spreads.map((b) => expectedScore(a, b))), 0);

// Head to head on the same word, game by game: a's score against b.
const headToHead = (a: number, b: number, keep: (g: number) => boolean = () => true) => {
  let score = 0;
  let n = 0;
  guesses[a].forEach((ga, g) => {
    if (!keep(g)) return;
    const gb = guesses[b][g];
    score += ga < gb ? 1 : ga === gb ? 0.5 : 0;
    n++;
  });
  return n ? score / n : NaN;
};

const pct = (x: number) => (Number.isNaN(x) ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
const median = (row: readonly number[]) => [...row].sort((a, b) => a - b)[Math.floor(row.length / 2)];
const worst = (row: readonly number[]) => [...row].sort((a, b) => a - b)[Math.floor(row.length * 0.9)];

console.log(`\n${secrets.length} words, seed ${seed}\n`);
console.log('computer              average  median  90th %  table  fitted rating');
computers.forEach((computer, c) => {
  console.log(`${computer.name.padEnd(20)}  ${averageOf(spreads[c]).toFixed(2).padStart(7)}  ${String(median(guesses[c])).padStart(6)}  ${String(worst(guesses[c])).padStart(6)}  ${String(computer.rating ?? '').padStart(5)}  ${ratings[c].toFixed(0).padStart(6)}`);
});

const keepBucket = (bucket: string) => (g: number) => bucketOf(secrets[g]) === bucket;
console.log('\nAverage guesses by how many anagrams the word has on the secret list');
console.log(`${'computer'.padEnd(20)}  ${BUCKETS.map((b) => b.padStart(13)).join('')}`);
console.log(`${'(words)'.padEnd(20)}  ${BUCKETS.map((b) => String(secrets.filter((_, g) => keepBucket(b)(g)).length).padStart(13)).join('')}`);
computers.forEach((computer, c) => {
  console.log(`${computer.name.padEnd(20)}  ${BUCKETS.map((b) => {
    const row = guesses[c].filter((_, g) => keepBucket(b)(g));
    return (row.length ? (row.reduce((x, y) => x + y, 0) / row.length).toFixed(2) : '-').padStart(13);
  }).join('')}`);
});

const humans = computers.flatMap((computer, c) => (computer.name.startsWith('human') ? [c] : []));
if (humans.length) {
  console.log('\nHuman-like computers\' score against each recall computer, same word');
  console.log(`${'vs'.padEnd(14)}${humans.map((h) => computers[h].name.padStart(22)).join('')}`);
  computers.forEach((computer, c) => {
    if (humans.includes(c)) return;
    console.log(`${computer.name.padEnd(14)}${humans.map((h) => pct(headToHead(h, c)).padStart(22)).join('')}`);
  });
  const sixty = computers.findIndex((c) => c.name === 'recall 0.60');
  console.log('\n...and against recall 0.60 (rated 1673) by anagrams');
  for (const bucket of BUCKETS) {
    console.log(`${bucket.padEnd(14)}${humans.map((h) => pct(headToHead(h, sixty, keepBucket(bucket))).padStart(22)).join('')}`);
  }
}
