import type { GuessResult } from './scoring';
import { normalizeWord } from './words';

/** A word guessed before in this game (or, in a run, at this word): which guess it was, and its score. */
export interface EarlierGuess {
  /** 1 for the first guess. */
  number: number;
  result: GuessResult;
}

/**
 * The earlier guess of `word` among `guesses`, or null if it's new. Guessing
 * a word again tells you nothing new, so every mode refuses it before
 * submitting (README "Repeated guesses").
 *
 * The engines (`submitGuess`, `submitTurn`, `submitRunGuess`,
 * `submitPvpGuess`) don't check this: records saved before the rule may hold
 * a repeat and must still replay. The computer's guesser never repeats a
 * guess anyway (`computer.ts`), so its strengths are unchanged.
 */
export function earlierGuess(guesses: readonly GuessResult[], word: string): EarlierGuess | null {
  const normalized = normalizeWord(word);
  const index = guesses.findIndex((g) => g.guess === normalized);
  return index < 0 ? null : { number: index + 1, result: guesses[index] };
}
