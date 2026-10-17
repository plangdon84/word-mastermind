import { summarizeGame } from './history';
import type { StatsGame } from './stats';

/*
 * Unlocking modes (README "Unlocking modes"): a new player starts with
 * Practice, the Daily Word and two player against the computer, and finding
 * the word in any one of them opens everything else at once (Dev Plan item
 * 18zn). Like achievements, it's a rule over the saved games, never a stored
 * flag, so someone with a qualifying game already has it all open, and a
 * reset profile starts again. Any difficulty counts.
 */

export type UnlockStep = 'all';

export const UNLOCK_STEPS: readonly UnlockStep[] = ['all'];

export interface Unlock<Step extends string = UnlockStep> {
  step: Step;
  /** When it opened: the later of the game that earned it and the step before. */
  at: number;
  /** The game that opened it, or the one that opened the step before if that came later. */
  gameId: string;
}

/** A Practice win, the Daily Word found or a win against the computer; a draw isn't a win. */
function opensAll(game: StatsGame): boolean {
  const { replayed } = game;
  if (replayed.mode === 'dailyWord') return replayed.game.results.every((r) => r.outcome === 'solved');
  const summary = summarizeGame(replayed);
  return (summary.mode === 'single' || summary.mode === 'computer') && summary.result === 'won';
}

/** The steps before item 18zn, each needing the one before: only Achievement Hunter still counts their badges. */
export type OldUnlockStep = 'two-player' | 'solo-rush' | 'all-rush';

export const OLD_UNLOCK_STEPS: readonly OldUnlockStep[] = ['two-player', 'solo-rush', 'all-rush'];

function earnedOld(step: OldUnlockStep, game: StatsGame): boolean {
  const summary = summarizeGame(game.replayed);
  switch (step) {
    case 'two-player':
      return summary.mode === 'single' && summary.result === 'won';
    case 'solo-rush':
      return (summary.mode === 'computer' || summary.mode === 'friend') && summary.result === 'won';
    case 'all-rush':
      return game.replayed.mode === 'rush' && game.replayed.game.results.every((r) => r.outcome === 'solved');
  }
}

/** Opens each step in turn, each with the first game after its games' end times that earns it. */
function inSteps<Step extends string>(
  games: readonly StatsGame[], steps: readonly Step[], earns: (step: Step, game: StatsGame) => boolean,
): Unlock<Step>[] {
  const ended = games
    .map((game) => ({ game, endedAt: summarizeGame(game.replayed).endedAt }))
    .sort((a, b) => a.endedAt - b.endedAt);
  const unlocks: Unlock<Step>[] = [];
  for (const step of steps) {
    const first = ended.find(({ game }) => earns(step, game));
    if (!first) break;
    const before = unlocks[unlocks.length - 1];
    unlocks.push(before && before.at > first.endedAt ? { ...before, step } : { step, at: first.endedAt, gameId: first.game.id });
  }
  return unlocks;
}

/** The steps unlocked, in order, each with when it opened. */
export const computeUnlocks = (games: readonly StatsGame[]): Unlock[] => inSteps(games, UNLOCK_STEPS, (_, game) => opensAll(game));

/** The steps the rule before item 18zn would have unlocked, for Achievement Hunter's levels already reached. */
export const computeOldUnlocks = (games: readonly StatsGame[]): Unlock<OldUnlockStep>[] => inSteps(games, OLD_UNLOCK_STEPS, earnedOld);

/** Which title-screen choices are open. */
export interface OpenModes {
  /**
   * Everything past Practice, the Daily Word and two player against the
   * computer: two player against a friend (or a random opponent), all of
   * Word Sets and the Daily Set.
   */
  all: boolean;
}

export function openModes(unlocks: readonly Unlock[]): OpenModes {
  return { all: unlocks.some((u) => u.step === 'all') };
}
