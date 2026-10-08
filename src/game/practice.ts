import { evaluateGuess, type GuessResult } from './scoring';
import { validateGuess, type WordError } from './words';

/*
 * Playing on after a loss (README "Play on after a loss"): having lost a two
 * player game without finding their word, you can keep guessing it on the
 * same board until you find it or ask to see it. The extra guesses are
 * practice, kept apart from the game's record, so they never change its
 * result, history, rating or badges.
 */

/** What to keep of a game played on: the practice words, in order, and whether you asked to see their word. */
export interface PlayOn {
  words: readonly string[];
  revealed: boolean;
}

/**
 * Where you are after the loss: `choose` (Keep guessing or see their word),
 * `playing`, `found` (a practice guess found it) or `revealed`.
 */
export type PlayOnStage = 'choose' | 'playing' | 'found' | 'revealed';

export const NEW_PLAY_ON: PlayOn = { words: [], revealed: false };

/** Only a loss where you never found their word can be played on. */
export function canPlayOn(lost: boolean, guesses: readonly GuessResult[]): boolean {
  return lost && !guesses.some((g) => g.isWin);
}

/** The practice guesses, scored against their word. */
export function practiceGuesses(secret: string, playOn: PlayOn | null): GuessResult[] {
  return (playOn?.words ?? []).map((w) => evaluateGuess(w, secret));
}

/** Null is a loss you haven't chosen what to do about yet. */
export function playOnStage(secret: string, playOn: PlayOn | null): PlayOnStage {
  if (!playOn) return 'choose';
  if (practiceGuesses(secret, playOn).some((g) => g.isWin)) return 'found';
  return playOn.revealed ? 'revealed' : 'playing';
}

export type PlayOnResult =
  | { ok: true; playOn: PlayOn; result: GuessResult }
  | { ok: false; error: WordError | 'game-over' };

/** A practice guess: checked like any guess, and refused once you've found or seen their word. */
export function addPlayOnGuess(secret: string, playOn: PlayOn, word: string): PlayOnResult {
  if (playOnStage(secret, playOn) !== 'playing') return { ok: false, error: 'game-over' };
  const validation = validateGuess(word);
  if (!validation.ok) return validation;
  return {
    ok: true,
    playOn: { ...playOn, words: [...playOn.words, validation.word] },
    result: evaluateGuess(validation.word, secret),
  };
}
