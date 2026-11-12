import { isObject, validateWord, type WordKind, type WordValidation } from '../../src/game';
import { isSentWord } from './requestChecks';

export interface WordCheckRequest {
  kind: WordKind;
  word: string;
}

export function parseWordCheck(body: unknown): WordCheckRequest | null {
  if (!isObject(body)) return null;
  const { kind, word } = body;
  if ((kind !== 'secret' && kind !== 'guess') || !isSentWord(word)) return null;
  return { kind, word };
}

/** Checks a word exactly as the app does, with the same bundled lists. */
export function checkWord({ kind, word }: WordCheckRequest): WordValidation {
  return validateWord(kind, word);
}
