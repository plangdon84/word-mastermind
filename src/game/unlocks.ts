import { summarizeGame } from './history';
import type { StatsGame } from './stats';

/*
 * Unlocking modes (README "Unlocking modes"): a new player starts with
 * single player and the tutorial, and opens the rest in three steps. Like
 * achievements, it's a rule over the saved games, never a stored flag, so
 * someone with qualifying games already has them open, and a reset profile
 * starts again. Any difficulty counts.
 */

export type UnlockStep = 'two-player' | 'solo-rush' | 'all-rush';

/** The steps in order: each needs the one before it. */
export const UNLOCK_STEPS: readonly UnlockStep[] = ['two-player', 'solo-rush', 'all-rush'];

export interface Unlock {
  step: UnlockStep;
  /** When it opened: the later of the game that earned it and the step before. */
  at: number;
  /** The game that opened it, or the one that opened the step before if that came later. */
  gameId: string;
}

/** Does this game earn `step`? */
function earns(step: UnlockStep, game: StatsGame): boolean {
  const summary = summarizeGame(game.replayed);
  switch (step) {
    case 'two-player':
      return summary.mode === 'single' && summary.result === 'won';
    case 'solo-rush':
      // Against the computer or a friend; a draw isn't a win.
      return (summary.mode === 'computer' || summary.mode === 'friend') && summary.result === 'won';
    case 'all-rush':
      return game.replayed.mode === 'rush' && game.replayed.game.results.every((r) => r.outcome === 'solved');
  }
}

/** The steps unlocked, in order, each with when it opened. */
export function computeUnlocks(games: readonly StatsGame[]): Unlock[] {
  const ended = games
    .map((game) => ({ game, endedAt: summarizeGame(game.replayed).endedAt }))
    .sort((a, b) => a.endedAt - b.endedAt);
  const unlocks: Unlock[] = [];
  for (const step of UNLOCK_STEPS) {
    const first = ended.find(({ game }) => earns(step, game));
    if (!first) break;
    const before = unlocks[unlocks.length - 1];
    unlocks.push(before && before.at > first.endedAt ? { ...before, step } : { step, at: first.endedAt, gameId: first.game.id });
  }
  return unlocks;
}

/** Which title-screen choices are open. */
export interface OpenModes {
  twoPlayer: boolean;
  soloRush: boolean;
  /** Daily Rush, Rush with Friends and Competitive Rush. */
  otherRush: boolean;
}

export function openModes(unlocks: readonly Unlock[]): OpenModes {
  const has = (step: UnlockStep) => unlocks.some((u) => u.step === step);
  return { twoPlayer: has('two-player'), soloRush: has('solo-rush'), otherRush: has('all-rush') };
}
