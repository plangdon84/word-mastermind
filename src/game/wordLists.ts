// The generated word lists (see wordlist/README.md), bundled as text at build
// time. Never edit wordlist/lists/ by hand: change the rules and rerun the ETL.
import guessText from '../../wordlist/lists/guess.txt?raw';
import secretText from '../../wordlist/lists/secret.txt?raw';

function parseWordList(text: string): readonly string[] {
  return text.split('\n').filter((line) => line !== '');
}

/** Words a player (or the computer) may pick as a secret. Sorted. */
export const SECRET_WORDS: readonly string[] = parseWordList(secretText);

/** Words a player may guess: a superset of `SECRET_WORDS`. Sorted. */
export const GUESS_WORDS: readonly string[] = parseWordList(guessText);

export const SECRET_WORD_SET: ReadonlySet<string> = new Set(SECRET_WORDS);
export const GUESS_WORD_SET: ReadonlySet<string> = new Set(GUESS_WORDS);
