import { suggestWord } from '../game';

/** A word for Easy's Suggest to offer after these guesses, or null if none fits (README "Easy"). */
export const pickSuggestion = (guesses: readonly { guess: string; score: number }[]): string | null =>
  suggestWord(guesses, Math.random);

export const suggestedMessage = (word: string) => `Suggested ${word.toUpperCase()}. Submit it, or edit or clear it first.`;

export const NO_SUGGESTION = 'No word fits the scores so far.';
