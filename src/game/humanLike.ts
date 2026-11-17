import { deduceMarks } from './deduce';
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

function popcount(n: number): number {
  let count = 0;
  for (; n; n &= n - 1) count++;
  return count;
}

/** Marks as two letter masks. */
export interface LetterMarks {
  inMask: number;
  outMask: number;
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
function propagate(clues: readonly Clue[], multiple: boolean): LetterMarks {
  let inMask = 0;
  let outMask = 0;
  // Every constraint: `mask` holds exactly `count` in letters.
  const constraints: Clue[] = [{ mask: ALL, score: 5 }, ...clues.map((c) => ({ ...c }))];
  for (let round = 0; round < 50; round++) {
    let changed = false;
    const unsettled = (c: Clue) => ({ mask: c.mask & ~inMask & ~outMask, score: c.score - popcount(c.mask & inMask) });
    const live = constraints.map(unsettled);
    if (multiple) {
      // One set inside another: what's left over holds the difference.
      const extra: Clue[] = [];
      for (const a of live) {
        for (const b of live) {
          if (a === b || a.mask === b.mask || (a.mask & b.mask) !== a.mask || a.mask === 0) continue;
          const diff = { mask: b.mask & ~a.mask, score: b.score - a.score };
          if (!constraints.some((c) => c.mask === diff.mask)) extra.push(diff);
        }
      }
      for (const e of extra.slice(0, 200)) {
        if (!constraints.some((c) => c.mask === e.mask)) {
          constraints.push(e);
          live.push(e);
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

/** The letters it has settled, at its level of letter logic. */
export function humanMarks(history: readonly GuessResult[], deduction: Deduction): LetterMarks {
  if (deduction === 'all') {
    const marks = deduceMarks(history);
    let inMask = 0;
    let outMask = 0;
    for (const [letter, mark] of Object.entries(marks)) {
      if (mark === 'in') inMask |= letterMask(letter);
      else if (mark === 'out') outMask |= letterMask(letter);
    }
    return { inMask, outMask };
  }
  return propagate(history.map((g) => ({ mask: letterMask(g.guess), score: g.score })), deduction === 'multiple');
}

let guessMasks: Int32Array | undefined;
let wordIndexes: number[] | undefined; // guess-list words with no repeated letter: what a secret can be
let familiarWords: Uint8Array | undefined;
const masks = () => (guessMasks ??= Int32Array.from(GUESS_WORDS, letterMask));
const familiar = () => (familiarWords ??= Uint8Array.from(GUESS_WORDS, (w) => (SECRET_WORD_SET.has(w) ? 1 : 0)));
const plainWords = () => (wordIndexes ??= GUESS_WORDS.flatMap((w, i) => (popcount(masks()[i]) === 5 ? [i] : [])));

/** How many of the candidates a staging guess's entropy is measured over. */
const SAMPLE = 400;

/**
 * Its next guess at the word. Works out the marks, then a weight for every
 * guess-list word with 5 different letters that fits them (its hunch: a word
 * loses weight for each letter it's off on each score). With few words left,
 * or 4 letters known in, it guesses the likeliest word. Otherwise it plays the
 * staging guess, from the whole guess list, that tells it most about the
 * likely words while testing no more than `testLetters` unsettled letters.
 */
export function pickHumanLikeGuess(history: readonly GuessResult[], style: HumanLikeStyle, random: () => number = Math.random): string {
  const { opener } = style;
  if (opener && history.length < opener.length && history.every((g, i) => g.guess === opener[i] && g.score < 5)
    && history.reduce((sum, g) => sum + g.score, 0) < 5) return opener[history.length];
  const all = masks();
  const guessed = new Set(history.map((g) => g.guess));
  const clues = history.map((g) => ({ mask: letterMask(g.guess), score: g.score }));
  const { inMask, outMask } = humanMarks(history, style.deduction);
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

  // A weighted sample of the candidates to judge staging guesses against.
  const total = weights.reduce((a, b) => a + b, 0);
  const sample: number[] = [];
  const sampleWeights: number[] = [];
  if (candidates.length <= SAMPLE) {
    candidates.forEach((c, k) => { sample.push(all[c]); sampleWeights.push(weights[k] / total); });
  } else {
    for (let s = 0; s < SAMPLE; s++) {
      let r = random() * total;
      let k = 0;
      while (k < weights.length - 1 && (r -= weights[k]) > 0) k++;
      sample.push(all[candidates[k]]);
      sampleWeights.push(1 / SAMPLE);
    }
  }

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
  const scored: { word: string; value: number }[] = [];
  const spread = new Float64Array(6);
  for (let t = 0; t < testable.length; t++) {
    if (tests[t] > limit) continue;
    const i = testable[t];
    const m = all[i];
    spread.fill(0);
    for (let s = 0; s < sample.length; s++) spread[popcount(m & sample[s])] += sampleWeights[s];
    let value = 0;
    for (const p of spread) if (p > 0) value -= p * Math.log2(p);
    if (!familiar()[i]) value *= 0.9;
    if (value > 0) scored.push({ word: GUESS_WORDS[i], value });
  }
  if (scored.length === 0) return best();
  const top = Math.max(...scored.map((s) => s.value));
  const good = scored.filter((s) => s.value >= top * style.leeway);
  return good[Math.floor(random() * good.length)].word;
}
