import { GUESS_WORD_SET, SECRET_WORD_SET } from './wordLists';

/** Every secret word and guess has exactly this many letters. */
export const WORD_LENGTH = 5;

export type WordError =
  | 'wrong-length'
  | 'not-letters'
  | 'repeated-letters'
  | 'not-in-word-list';

export type WordValidation =
  | { ok: true; word: string }
  | { ok: false; error: WordError };

/** Words are case-insensitive, so everything is compared in lowercase. */
export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function hasValidLength(word: string): boolean {
  return normalizeWord(word).length === WORD_LENGTH;
}

/** Words use only the letters a–z: no digits, spaces, or special characters. */
export function isAlphabetic(word: string): boolean {
  return /^[a-z]+$/.test(normalizeWord(word));
}

/** Secret words may not repeat a letter (`bunny` is invalid). Guesses may. */
export function hasRepeatedLetters(word: string): boolean {
  const normalized = normalizeWord(word);
  return new Set(normalized).size !== normalized.length;
}

/** Is the word on the secret-word list? Case-insensitive. */
export function isValidSecretWord(word: string): boolean {
  return SECRET_WORD_SET.has(normalizeWord(word));
}

/** Is the word on the guess list (a superset of the secret list)? Case-insensitive. */
export function isValidGuessWord(word: string): boolean {
  return GUESS_WORD_SET.has(normalizeWord(word));
}

/** Which list a word is checked against: secret words, or the broader guess list. */
export type WordKind = 'secret' | 'guess';

export const isWordError = (value: unknown): value is WordError =>
  value === 'wrong-length' || value === 'not-letters' || value === 'repeated-letters' || value === 'not-in-word-list';

/** Checks a word as a secret word or a guess. */
export function validateWord(kind: WordKind, word: string): WordValidation {
  return kind === 'secret' ? validateSecretWord(word) : validateGuess(word);
}

export function validateSecretWord(word: string): WordValidation {
  return validate(word, isValidSecretWord, { allowRepeatedLetters: false });
}

export function validateGuess(word: string): WordValidation {
  return validate(word, isValidGuessWord, { allowRepeatedLetters: true });
}

function validate(
  word: string,
  isInWordList: (word: string) => boolean,
  { allowRepeatedLetters }: { allowRepeatedLetters: boolean },
): WordValidation {
  const normalized = normalizeWord(word);
  if (normalized.length !== WORD_LENGTH) {
    return { ok: false, error: 'wrong-length' };
  }
  if (!isAlphabetic(normalized)) {
    return { ok: false, error: 'not-letters' };
  }
  if (!allowRepeatedLetters && hasRepeatedLetters(normalized)) {
    return { ok: false, error: 'repeated-letters' };
  }
  if (!isInWordList(normalized)) {
    return { ok: false, error: 'not-in-word-list' };
  }
  return { ok: true, word: normalized };
}
