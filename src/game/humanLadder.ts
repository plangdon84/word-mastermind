import { HUMAN_LADDER, seededRandom } from './computerRatings';
import { CRANE_SPLIT_DOUGH, HUMAN_STYLES, marksOf, pickHumanLikeMove, type HumanLikeStyle } from './humanLike';
import type { Marks } from './marks';
import { COMPUTER_PAUSE_MS } from './ladder';
import type { GuessResult } from './scoring';

/*
 * How each human-like ladder computer plays (Dev Plan item 19zr): its style
 * (`humanLike.ts`), keyed by its ID in `HUMAN_LADDER`. The settings came
 * from `npm run benchmark-human`, each picked to land on a recall
 * computer's rating; docs/human-like-benchmark.md has the runs. Only the
 * worker uses this module, so the app never bundles it.
 */

const open = (style: HumanLikeStyle, changes: Partial<HumanLikeStyle> = {}): HumanLikeStyle =>
  ({ ...style, opener: CRANE_SPLIT_DOUGH, ...changes });

/** Each human-like ladder computer's style, by its ID, weakest first. */
export const HUMAN_LADDER_STYLES: ReadonlyMap<number, HumanLikeStyle> = new Map([
  [0.385, open(HUMAN_STYLES.novice)],
  [0.505, open(HUMAN_STYLES.intermediate, { leeway: 0.55 })],
  [0.605, open(HUMAN_STYLES.intermediate)],
  [0.705, open(HUMAN_STYLES.intermediate, { testLetters: 3, insight: 0.5 })],
  [0.805, open(HUMAN_STYLES.intermediate, { testLetters: 5, insight: 1 })],
  [0.905, open(HUMAN_STYLES.expert, { leeway: 0.9 })],
  [0.995, open(HUMAN_STYLES.expert, { opener: ['crane', 'split'] })],
]);

if (HUMAN_LADDER.some((c) => !HUMAN_LADDER_STYLES.has(c.recall))) throw new Error('A human-like ladder computer has no style');

/**
 * A human-like ladder computer's next guess at the player's word, from its
 * own guesses so far, with the letters it marks in and out as it guesses
 * (sent with the guess at Medium, as a player who shares marks does). Worked out when it's due, one at a time (unlike the
 * recall computers' plans), since a whole game at once would take a request
 * far past the Workers Free plan's CPU time.
 */
export function humanLadderGuess(id: number, history: readonly GuessResult[], random: () => number): { word: string; marks: Marks } {
  const style = HUMAN_LADDER_STYLES.get(id);
  if (!style) throw new Error(`No human-like ladder computer ${id}`);
  const move = pickHumanLikeMove(history, style, random);
  return { word: move.word, marks: marksOf(move.marks) };
}

/**
 * How long a human-like computer pauses before its `n`th guess (from 0),
 * 3 to 8 seconds as the recall computers do: from the game's seed, so the
 * room knows when each guess is due before working it out.
 */
export function computerPause(seed: number, n: number): number {
  const [shortest, longest] = COMPUTER_PAUSE_MS;
  return Math.round(shortest + seededRandom((seed + Math.imul(n + 1, 0x9e3779b1)) | 0)() * (longest - shortest));
}
