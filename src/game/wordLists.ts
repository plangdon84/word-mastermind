/*!
 * Word lists from the English Speller Database (ESDB), wordlist/NOTICE-ESDB:
 *
 * Copyright 2000-2026 by Kevin Atkinson
 *
 * Permission to use, copy, modify, distribute, and sell any part of the English
 * Speller Database (ESDB, previously known as SCOWLv2), or word lists
 * created from it, is hereby granted without fee, provided that the above
 * copyright notice appears in all copies and that both the above copyright
 * notice and this notice appear in supporting documentation.  Kevin Atkinson
 * makes no representations about the suitability of this database for any
 * purpose.  It is provided "as is" without express or implied warranty.
 */

// The generated word lists (see wordlist/README.md), bundled as text at build
// time. Never edit wordlist/lists/ by hand: change the rules and rerun the ETL.
// The notice above is a kept (/*!) comment, so it ships in the app's and the
// worker's bundles with the lists (issue 229).
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
