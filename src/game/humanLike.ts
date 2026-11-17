import type { GuessResult } from './scoring';
import { GUESS_WORDS, SECRET_WORD_SET } from './wordLists';

/*
 * An experimental computer that tries to play the way people do (an
 * experiment, not yet used by any mode): it works out which letters are in
 * and out (Medium's marks), has a hunch about the rest from how common
 * letters and words are, tests a few letters at a time with "staging"
 * guesses padded with letters it already knows, and only goes for the word
 * once it believes it knows the letters. It guesses from the guess list.
 * Benchmarked against the recall computers by `npm run benchmark-human`.
 * Stateless like `pickGuessWithRecall`: each guess is worked out from the
 * history alone.
 */

/** How far its letter logic goes, after the player's own description of novice, intermediate and expert play. */
export type Deduction = 'single' | 'multiple' | 'all';

export interface HumanLikeStyle {
  /**
   * `single`: one guess at a time (a 0 rules its letters out, a score
   * already met by its in letters rules the rest out, and so on).
   * `multiple`: also compares guesses with each other, as overlapping sets
   * of letters. `all`: complete letter logic (Easy's `deduceMarks`).
   */
  deduction: Deduction;
  /** The most letters it hasn't settled that a staging guess tests at once. */
  testLetters: number;
  /**
   * How strongly a word that doesn't fit a score counts against it in its
   * hunch: 0 ignores the scores (only the marks count), large is strict.
   */
  strictness: number;
  /** It goes for the word once this few words fit every score it has, or it knows this many letters are in. */
  solveAtWords: number;
  solveAtIn: number;
  /** It picks at random among staging guesses at least this good a fraction of the best one. */
  leeway: number;
  /**
   * How much less it thinks of a word that isn't a common one (not on the
   * secret list), as the word or as a staging guess: people think of common
   * words first. 1 treats every guess-list word alike.
   */
  unfamiliar: number;
  /**
   * Fixed first guesses, played in order before it starts thinking, such as
   * a player's CRANE, SPLIT, DOUGH (15 different letters). It stops early
   * once their scores add up to 5, since every other letter is then out.
   */
  opener?: readonly string[];
  /**
   * The chance each turn that it sees everything the scores say (complete
   * letter logic) instead of only what its own `deduction` finds: a person
   * who sometimes spots a deduction and sometimes misses it. Leave it out for 0.
   */
  insight?: number;
}

/** The opener a player uses: three common words with 15 different letters. */
export const CRANE_SPLIT_DOUGH: readonly string[] = ['crane', 'split', 'dough'];

export const HUMAN_STYLES: Readonly<Record<'novice' | 'intermediate' | 'expert', HumanLikeStyle>> = {
  novice: { deduction: 'multiple', testLetters: 1, strictness: 0.5, solveAtWords: 2, solveAtIn: 4, leeway: 0.85, unfamiliar: 0.3 },
  intermediate: { deduction: 'multiple', testLetters: 2, strictness: 1, solveAtWords: 3, solveAtIn: 4, leeway: 0.9, unfamiliar: 0.3 },
  expert: { deduction: 'all', testLetters: 5, strictness: 3, solveAtWords: 3, solveAtIn: 4, leeway: 0.95, unfamiliar: 0.3 },
};

const ALL = (1 << 26) - 1;

function letterMask(word: string): number {
  let mask = 0;
  for (let i = 0; i < word.length; i++) mask |= 1 << (word.charCodeAt(i) - 97);
  return mask;
}

/** Set bits of each 13-bit number, so a 26-letter mask's count is two lookups. */
const BITS = (() => {
  const table = new Uint8Array(1 << 13);
  for (let i = 1; i < table.length; i++) table[i] = table[i >> 1] + (i & 1);
  return table;
})();

const popcount = (n: number): number => BITS[n & 8191] + BITS[n >>> 13];

/** Marks as two letter masks (`marksOf` turns them into Medium's marks). */
export interface LetterMarks {
  inMask: number;
  outMask: number;
}

/** Letter masks as Medium's marks: each letter in or out. */
export function marksOf({ inMask, outMask }: LetterMarks): Partial<Record<string, 'in' | 'out'>> {
  const marks: Partial<Record<string, 'in' | 'out'>> = {};
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    if (inMask & (1 << i)) marks[letter] = 'in';
    else if (outMask & (1 << i)) marks[letter] = 'out';
  }
  return marks;
}

/** A guess as a set of letters and the score it got. */
interface Clue {
  mask: number;
  score: number;
}

/**
 * Letter logic over sets of letters: each clue says "this many of these
 * letters are in", and the word itself says "5 of all 26". `single` uses
 * each clue alone (with what's already settled); `multiple` also takes one
 * clue's letters away from another's when one holds the other, which is how
 * a person reads two guesses that differ by a letter or two.
 */
/** The most sets of letters `propagate` keeps track of, so it stays quick. */
const MAX_CONSTRAINTS = 300;

function propagate(clues: readonly Clue[], multiple: boolean): LetterMarks {
  let inMask = 0;
  let outMask = 0;
  // Every constraint: `mask` holds exactly `count` in letters.
  const constraints: Clue[] = [{ mask: ALL, score: 5 }, ...clues.map((c) => ({ ...c }))];
  const known = new Set(constraints.map((c) => c.mask));
  for (let round = 0; round < 50; round++) {
    let changed = false;
    const unsettled = (c: Clue) => ({ mask: c.mask & ~inMask & ~outMask, score: c.score - popcount(c.mask & inMask) });
    const live = constraints.map(unsettled);
    if (multiple && constraints.length < MAX_CONSTRAINTS) {
      // One set inside another: what's left over holds the difference.
      const count = live.length;
      for (let a = 0; a < count && constraints.length < MAX_CONSTRAINTS; a++) {
        const small = live[a];
        if (small.mask === 0) continue;
        for (let b = 0; b < count; b++) {
          const big = live[b];
          if (a === b || small.mask === big.mask || (small.mask & big.mask) !== small.mask) continue;
          const diff = { mask: big.mask & ~small.mask, score: big.score - small.score };
          if (known.has(diff.mask)) continue;
          known.add(diff.mask);
          constraints.push(diff);
          live.push(diff);
          changed = true;
        }
      }
    }
    for (const c of live) {
      if (c.mask === 0) continue;
      if (c.score === 0) {
        outMask |= c.mask;
        changed = true;
      } else if (c.score === popcount(c.mask)) {
        inMask |= c.mask;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { inMask, outMask: outMask & ~inMask };
}

/**
 * Complete letter logic, as Easy's `deduceMarks` works it out but much
 * faster: a search over sets of 5 letters that gives up on a branch as soon
 * as a score can't be met, and stops once nothing more could be marked.
 * Fast enough to run on the server for each of the computer's guesses.
 */
export function completeMarks(clues: readonly { mask: number; score: number }[]): LetterMarks {
  if (clues.length === 0) return { inMask: 0, outMask: 0 };
  const n = clues.length;
  const masks = clues.map((c) => c.mask);
  const scores = clues.map((c) => c.score);
  // left[i * n + k]: clue k's letters from letter i on.
  const left = new Int8Array(27 * n);
  for (let i = 25; i >= 0; i--) {
    for (let k = 0; k < n; k++) left[i * n + k] = left[(i + 1) * n + k] + ((masks[k] >> i) & 1);
  }
  const counts = new Int8Array(n);
  let always = ALL;
  let ever = 0;
  let found = false;
  const search = (i: number, chosen: number, set: number): boolean => {
    if (chosen === 5) {
      for (let k = 0; k < n; k++) if (counts[k] !== scores[k]) return true;
      always &= set;
      ever |= set;
      found = true;
      // Nothing left to learn: no letter in every set, and every letter in one.
      return !(always === 0 && ever === ALL);
    }
    if (26 - i < 5 - chosen) return true;
    for (let k = 0; k < n; k++) {
      if (counts[k] > scores[k] || counts[k] + left[i * n + k] < scores[k]) return true;
    }
    const bit = 1 << i;
    for (let k = 0; k < n; k++) if (masks[k] & bit) counts[k]++;
    const go = search(i + 1, chosen + 1, set | bit);
    for (let k = 0; k < n; k++) if (masks[k] & bit) counts[k]--;
    return go && search(i + 1, chosen, set);
  };
  search(0, 0, 0);
  return found ? { inMask: always, outMask: ALL & ~ever } : { inMask: 0, outMask: 0 };
}

/** The letters it has settled, at its level of letter logic. */
export function humanMarks(history: readonly GuessResult[], deduction: Deduction): LetterMarks {
  const clues = history.map((g) => ({ mask: letterMask(g.guess), score: g.score }));
  if (deduction === 'all') return completeMarks(clues);
  return propagate(clues, deduction === 'multiple');
}

let guessMasks: Int32Array | undefined;
let wordIndexes: number[] | undefined; // guess-list words with no repeated letter: what a secret can be
let familiarWords: Uint8Array | undefined;
const masks = () => (guessMasks ??= Int32Array.from(GUESS_WORDS, letterMask));
const familiar = () => (familiarWords ??= Uint8Array.from(GUESS_WORDS, (w) => (SECRET_WORD_SET.has(w) ? 1 : 0)));
const plainWords = () => (wordIndexes ??= GUESS_WORDS.flatMap((w, i) => (popcount(masks()[i]) === 5 ? [i] : [])));

/** How many of the candidates a staging guess's entropy is measured over. */
const SAMPLE = 200;
/** The fewest it samples, however many guesses it judges. */
const MIN_SAMPLE = 60;
/** At most about this many (guess, sampled word) pairs a turn, to keep each guess quick. */
const WORK = 500_000;

/**
 * Its next guess at the word. Works out the marks, then a weight for every
 * guess-list word with 5 different letters that fits them (its hunch: a word
 * loses weight for each letter it's off on each score). With few words left,
 * or 4 letters known in, it guesses the likeliest word. Otherwise it plays the
 * staging guess, from the whole guess list, that tells it most about the
 * likely words while testing no more than `testLetters` unsettled letters.
 */
export function pickHumanLikeGuess(history: readonly GuessResult[], style: HumanLikeStyle, random: () => number = Math.random): string {
  return pickHumanLikeMove(history, style, random).word;
}

/** Its next guess, with the letters it believes in and out as it makes it (Medium's marks, shown to its opponent). */
export function pickHumanLikeMove(
  history: readonly GuessResult[], style: HumanLikeStyle, random: () => number = Math.random,
): { word: string; marks: LetterMarks } {
  const { opener } = style;
  if (opener && history.length < opener.length && history.every((g, i) => g.guess === opener[i] && g.score < 5)
    && history.reduce((sum, g) => sum + g.score, 0) < 5) return { word: opener[history.length], marks: humanMarks(history, style.deduction) };
  const insight = style.insight ?? 0;
  const sees = insight >= 1 || (insight > 0 && random() < insight);
  const marks = humanMarks(history, sees ? 'all' : style.deduction);
  return { word: chooseGuess(history, style, random, marks), marks };
}

function chooseGuess(history: readonly GuessResult[], style: HumanLikeStyle, random: () => number, { inMask, outMask }: LetterMarks): string {
  const all = masks();
  const guessed = new Set(history.map((g) => g.guess));
  const clues = history.map((g) => ({ mask: letterMask(g.guess), score: g.score }));
  // A 5 is unforgettable: from then on only its anagrams can be the word.
  const five = clues.find((c) => c.score === 5);

  // Its hunch: candidates that fit the marks, weighted by how well they fit the scores.
  const candidates: number[] = [];
  const weights: number[] = [];
  let fitting = 0;
  for (const i of plainWords()) {
    const m = all[i];
    if ((m & inMask) !== inMask || (m & outMask) !== 0 || guessed.has(GUESS_WORDS[i])) continue;
    if (five && m !== five.mask) continue;
    let off = 0;
    for (const c of clues) off += Math.abs(popcount(m & c.mask) - c.score);
    if (off === 0) fitting++;
    candidates.push(i);
    weights.push(Math.exp(-style.strictness * off) * (familiar()[i] ? 1 : style.unfamiliar));
  }
  if (candidates.length === 0) {
    // Only if the scores can't all be true; carry on with anything unguessed.
    const left = GUESS_WORDS.filter((w) => !guessed.has(w));
    return left[Math.floor(random() * left.length)];
  }

  const best = () => {
    let top = -1;
    const ties: number[] = [];
    weights.forEach((w, k) => {
      if (w > top + 1e-12) { top = w; ties.length = 0; ties.push(k); } else if (Math.abs(w - top) <= 1e-12) ties.push(k);
    });
    return GUESS_WORDS[candidates[ties[Math.floor(random() * ties.length)]]];
  };
  if (five || fitting <= style.solveAtWords || popcount(inMask) >= style.solveAtIn) return best();

  // Staging guesses: real-looking words (4 or 5 different letters) testing as
  // few unsettled letters as it likes, or as few as any word can.
  const unsettled = ALL & ~inMask & ~outMask;
  // How many letters a guess tests: its unsettled letters, or, measured
  // against an earlier guess, the unsettled letters it swaps in or out (a
  // person changing one letter of a guess tests that one letter).
  const testsOf = (m: number) => {
    let fewestTests = popcount(m & unsettled);
    for (const c of clues) fewestTests = Math.min(fewestTests, popcount((m ^ c.mask) & unsettled));
    return fewestTests;
  };
  const testable: number[] = [];
  const tests: number[] = [];
  let fewest = 5;
  for (let i = 0; i < GUESS_WORDS.length; i++) {
    const m = all[i];
    if (popcount(m) < 4 || popcount(m & unsettled) === 0 || guessed.has(GUESS_WORDS[i])) continue;
    const testing = testsOf(m);
    if (testing === 0) continue;
    testable.push(i);
    tests.push(testing);
    if (testing < fewest) fewest = testing;
  }
  const limit = Math.max(style.testLetters, fewest);
  // A weighted sample of the candidates to judge staging guesses against,
  // words with the same letters taken together (a guess can't tell them apart).
  const total = weights.reduce((a, b) => a + b, 0);
  const judged = new Set<number>();
  for (let t = 0; t < testable.length; t++) if (tests[t] <= limit) judged.add(all[testable[t]]);
  // Fewer samples when there are many guesses to judge, so a guess never
  // takes the server much past a few milliseconds (`WORK`).
  const size = Math.max(MIN_SAMPLE, Math.min(SAMPLE, Math.floor(WORK / Math.max(1, judged.size))));
  const sampled = new Map<number, number>();
  if (candidates.length <= size) {
    candidates.forEach((c, k) => sampled.set(all[c], (sampled.get(all[c]) ?? 0) + weights[k] / total));
  } else {
    const running = new Float64Array(weights.length);
    weights.reduce((sum, w, k) => (running[k] = sum + w), 0);
    for (let s = 0; s < size; s++) {
      const r = random() * total;
      let lo = 0;
      let hi = running.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (running[mid] < r) lo = mid + 1; else hi = mid;
      }
      const m = all[candidates[lo]];
      sampled.set(m, (sampled.get(m) ?? 0) + 1 / size);
    }
  }
  const sample = Int32Array.from(sampled.keys());
  const sampleWeights = Float64Array.from(sampled.values());

  const scored: { word: string; value: number }[] = [];
  const spread = new Float64Array(6);
  const valueOf = new Map<number, number>(); // by letters: anagrams tell it the same
  for (let t = 0; t < testable.length; t++) {
    if (tests[t] > limit) continue;
    const i = testable[t];
    const m = all[i];
    let value = valueOf.get(m);
    if (value === undefined) {
      spread.fill(0);
      for (let s = 0; s < sample.length; s++) spread[popcount(m & sample[s])] += sampleWeights[s];
      value = 0;
      for (const p of spread) if (p > 0) value -= p * Math.log2(p);
      valueOf.set(m, value);
    }
    if (!familiar()[i]) value *= 0.9;
    if (value > 0) scored.push({ word: GUESS_WORDS[i], value });
  }
  if (scored.length === 0) return best();
  const top = Math.max(...scored.map((s) => s.value));
  const good = scored.filter((s) => s.value >= top * style.leeway);
  return good[Math.floor(random() * good.length)].word;
}
