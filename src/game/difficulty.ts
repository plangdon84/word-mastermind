/** The difficulties built so far (see README "Difficulty Levels"), easiest first. */
export type Difficulty = 'easy' | 'medium' | 'hard' | 'extreme';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'extreme'];

/**
 * What a guess counts as at each difficulty (README "Scoring"), so playing
 * harder is rewarded even if it takes more guesses. Starting values, to be
 * tuned from real games at each difficulty.
 */
export const DIFFICULTY_FACTOR: Readonly<Record<Difficulty, number>> = {
  easy: 1.2,
  medium: 1,
  hard: 0.9,
  extreme: 0.8,
};

/** The easier of two difficulties: a game is scored at the easiest one used. */
export function easierDifficulty(a: Difficulty, b: Difficulty): Difficulty {
  return DIFFICULTIES.indexOf(a) <= DIFFICULTIES.indexOf(b) ? a : b;
}

/** Easy's automatic marking is a real edge in a race, so rated play refuses it (README "Easy"). */
export const isRatedDifficulty = (difficulty: Difficulty): boolean => difficulty !== 'easy';

/** The difficulty rated play uses for a player whose default is `difficulty`: Medium instead of Easy. */
export const ratedDifficultyFor = (difficulty: Difficulty): Difficulty => (isRatedDifficulty(difficulty) ? difficulty : 'medium');

/**
 * Whether a player can move to `next` (README "Difficulty Levels", issue
 * #151): any level before their first guess; after it only the same or an
 * easier one, so the level shown is always the one the game counts at.
 */
export const canPickDifficulty = (playing: Difficulty, next: Difficulty, guessed: boolean): boolean =>
  !guessed || easierDifficulty(playing, next) === next;

/**
 * The difficulty a game is scored at after a change to `next`: the pick
 * itself before the first guess (nothing's been learned yet), else the
 * easiest one used.
 */
export const scoredAfterPick = (scored: Difficulty, next: Difficulty, guessed: boolean): Difficulty =>
  guessed ? easierDifficulty(scored, next) : next;

/** A harder level after the first guess (`canPickDifficulty`). */
export type DifficultyError = 'difficulty-harder';
