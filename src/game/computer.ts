import type { GuessResult } from './scoring';
import { SECRET_WORDS } from './wordLists';

/**
 * How well the computer guesses the human's word in two player. Calibrated by
 * simulation (README "Computer strength"); `computer.test.ts`
 * checks each level still averages inside its target range.
 */
export type Strength = 'casual' | 'skilled' | 'expert' | 'mastermind';

/**
 * The chance that the computer takes each of its past clues into account on a
 * turn. Never forgetting (Mastermind) averages about 7 guesses, so the other
 * levels forget some clues on purpose.
 */
export const RECALL: Readonly<Record<Strength, number>> = {
  // Retuned when a guess scoring 5 became unforgettable (issue #165), to keep
  // the averages they had: about 28, 18 and 12.
  casual: 0.095, // target: 25–30 guesses on average
  skilled: 0.19, // target: 15–20
  expert: 0.38, // target: 10–15
  mastermind: 1, // never forgets: about 7
};

/**
 * The strength whose guessing a player's average guesses per word matches,
 * from the targets above, so a Rush can be ranked against the computer:
 * under 10 is Mastermind, under 15 Expert, up to 20 Skilled, and above that
 * Casual.
 */
export function strengthForAverage(averageGuesses: number): Strength {
  if (averageGuesses < 10) return 'mastermind';
  if (averageGuesses < 15) return 'expert';
  if (averageGuesses <= 20) return 'skilled';
  return 'casual';
}

/** A word's letters as a 26-bit mask, so shared letters are a popcount. */
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

let secretMasks: Int32Array | undefined;
const masksFor = (words: readonly string[]) => {
  if (words === SECRET_WORDS) return (secretMasks ??= Int32Array.from(words, letterMask));
  return Int32Array.from(words, letterMask);
};

/**
 * "Imperfect memory": consider each past clue with probability `recall`, then
 * guess a random word that fits every clue considered and hasn't been guessed.
 * A guess that scored 5 (an anagram of the word) is never forgotten (issue
 * #165), so from then on every strength guesses only its anagrams.
 * The guess always comes from `words` (the secret list), since the human's word
 * must be on it. Stateless, so a reloaded game just carries on.
 */
export function pickGuessWithRecall(
  history: readonly GuessResult[],
  recall: number,
  random: () => number = Math.random,
  words: readonly string[] = SECRET_WORDS,
): string {
  const clues = history
    // `random()` is drawn for every clue, so a 5 changes no other clue's draw.
    .filter((g) => random() < recall || g.score === 5)
    .map((g) => ({ mask: letterMask(g.guess), score: g.score }));
  const guessed = new Set(history.map((g) => g.guess));
  const masks = masksFor(words);

  const pool: string[] = [];
  const unguessed: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (guessed.has(words[i])) continue;
    unguessed.push(words[i]);
    if (clues.every((c) => popcount(masks[i] & c.mask) === c.score)) pool.push(words[i]);
  }
  // The human's word always fits every true clue, so `pool` is only empty if
  // the history doesn't come from a word on the list. Fall back rather than fail.
  const choices = pool.length > 0 ? pool : unguessed;
  if (choices.length === 0) throw new Error('No words left to guess');
  return choices[Math.floor(random() * choices.length)];
}

/** The computer's next guess at the human's word. */
export function pickComputerGuess(
  history: readonly GuessResult[],
  strength: Strength,
  random: () => number = Math.random,
): string {
  return pickGuessWithRecall(history, RECALL[strength], random);
}
