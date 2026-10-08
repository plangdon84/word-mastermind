import { forEachFittingSet, type Mark, type Marks } from './marks';

/**
 * Easy difficulty's automatic marks (README "Easy"): a letter is in when
 * every set of 5 different letters that fits every score so far contains it,
 * and out when none does. Letters the scores don't settle stay unmarked.
 * Complete letter logic from the guesses and scores alone, never the word
 * list or the secret, so it knows only what a perfect note-taker would. If no
 * set fits (scores that can't all be true), nothing is marked.
 */
export function deduceMarks(guesses: readonly { guess: string; score: number }[]): Marks {
  let always = (1 << 26) - 1;
  let ever = 0;
  forEachFittingSet(guesses, 0, 0, (set) => {
    always &= set;
    ever |= set;
    return true;
  });
  if (ever === 0) return {};
  const marks: Partial<Record<string, Mark>> = {};
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(97 + i);
    if (always & (1 << i)) marks[letter] = 'in';
    else if (!(ever & (1 << i))) marks[letter] = 'out';
  }
  return marks;
}
