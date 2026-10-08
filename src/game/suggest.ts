import type { Difficulty } from './difficulty';
import { letterMask, popcount } from './marks';
import { SECRET_WORDS } from './wordLists';

/*
 * Easy's Suggest (README "Easy"): fills the input with a secret-list word
 * that could be the secret, given every score so far (the "fits every score"
 * method, chosen by the owner's A/B test in Dev Plan item 13c). Each
 * suggestion is a move in the game's record (the word suggested), so reviews
 * show it and stats can compare games with and without. The engines only
 * count them; the app picks the word, with `suggestWord`.
 */

/** Suggestions per game (per word in a Rush), set by the A/B test. */
export const SUGGEST_LIMIT = 1;

/** Why a suggestion is refused: not at Easy, or none left. */
export type SuggestError = 'not-easy' | 'no-suggestions';

/** Whether a player at this difficulty with this many used may take another suggestion. */
export function checkSuggestion(difficulty: Difficulty, used: number): SuggestError | null {
  if (difficulty !== 'easy') return 'not-easy';
  return used >= SUGGEST_LIMIT ? 'no-suggestions' : null;
}

type Scored = readonly { guess: string; score: number }[];

/** Whether `word` would have scored every guess as it did (and isn't one of them, which would have won). */
export function fitsEveryScore(word: string, guesses: Scored): boolean {
  const mask = letterMask(word);
  return guesses.every((g) => g.guess !== word && popcount(mask & letterMask(g.guess)) === g.score);
}

/** Every word Suggest could offer now: the secret-list words that fit every score. */
export function suggestionCandidates(guesses: Scored, secretWords: readonly string[] = SECRET_WORDS): string[] {
  return secretWords.filter((w) => fitsEveryScore(w, guesses));
}

/** A random word Suggest offers now, or null if none fits. `random` returns [0, 1). */
export function suggestWord(guesses: Scored, random: () => number, secretWords?: readonly string[]): string | null {
  const candidates = suggestionCandidates(guesses, secretWords);
  return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
}
