import { createContext } from 'preact';

/** Which side of the bottom row Enter is on (a profile setting); Backspace takes the other. */
export const EnterSide = createContext<'left' | 'right'>('left');

/**
 * The typed letters in a new random order (the Shuffle key, Easy and Medium),
 * different from the old one whenever the letters allow it.
 */
export function shuffleLetters(draft: string, random: () => number = Math.random): string {
  const letters = [...draft];
  if (new Set(letters).size < 2) return draft;
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  const shuffled = letters.join('');
  // Shuffled back into place: move each letter along one instead, which
  // changes the order of any letters that aren't all the same.
  return shuffled === draft ? draft.slice(1) + draft[0] : shuffled;
}
