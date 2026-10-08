import { useMemo } from 'preact/hooks';
import { deduceMarks, type Difficulty, type Marks } from '../game';

/** No guesses yet, as one array, so a screen without a game keeps its marks worked out. */
export const NO_GUESSES: readonly { guess: string; score: number }[] = [];

/**
 * The letter marks a game screen shows: your own at Medium, the app's at Easy
 * (worked out from the scores alone, README "Easy"), and none otherwise.
 */
export function useShownMarks(
  difficulty: Difficulty, marks: Marks, guesses: readonly { guess: string; score: number }[],
): Marks | undefined {
  const easy = difficulty === 'easy';
  const deduced = useMemo(() => (easy ? deduceMarks(guesses) : {}), [easy, guesses]);
  return easy ? deduced : difficulty === 'medium' ? marks : undefined;
}

const NO_MARKS: Marks = {};

/**
 * The marks on the opponent's board, by the difficulty they play at (README
 * "Two player"): at Easy, what the app works out from their scores; at
 * Medium, the marks they shared (none if they don't share them); otherwise
 * none. Null difficulty (an older server) shows none.
 */
export function useOpponentMarks(
  difficulty: Difficulty | null, shared: Marks | null, guesses: readonly { guess: string; score: number }[],
): Marks | undefined {
  return useShownMarks(difficulty ?? 'hard', shared ?? NO_MARKS, guesses);
}
