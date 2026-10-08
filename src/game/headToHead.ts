import { summarizeGame, type HistoryMode, type HistoryResult } from './history';
import type { StatsGame } from './stats';

/*
 * Your record against a friend (Dev Plan item 18c, README "Friends'
 * profiles"): wins, draws and losses in each mode you can play them in,
 * from your own games. A game the server refereed has the same history ID
 * in both players' histories, so the games you played together are the IDs
 * in both. Like the rest of the stats, it's worked out from the games each
 * time, never kept as a count.
 */

/** The modes you play a friend in: a game against them, and a Word Set with them. */
export const HEAD_TO_HEAD_MODES = ['friend', 'lobby'] as const satisfies readonly HistoryMode[];
export type HeadToHeadMode = (typeof HEAD_TO_HEAD_MODES)[number];

export interface Tally {
  wins: number;
  draws: number;
  losses: number;
}

export type HeadToHead = Record<HeadToHeadMode, Tally>;

/** Your place in a lobby game, where lower is better: not placed comes after every place. */
function rankOf(game: StatsGame): number | null {
  if (game.replayed.mode !== 'lobby') return null;
  const you = game.replayed.places.find((p) => p.you);
  return you ? you.rank ?? Infinity : null;
}

/** How a game you both played went for you, or null if it doesn't count. */
function resultOf(yours: StatsGame, theirs: StatsGame): HistoryResult | null {
  if (yours.replayed.mode === 'friend' && theirs.replayed.mode === 'friend') return summarizeGame(yours.replayed).result;
  const [you, them] = [rankOf(yours), rankOf(theirs)];
  // Neither of you placed (both gave up every word): nobody beat anybody.
  if (you === null || them === null || (you === Infinity && them === Infinity)) return null;
  return you < them ? 'won' : you > them ? 'lost' : 'drawn';
}

/** Your wins, draws and losses against a friend in each mode: your games, and theirs, which say which games you shared. */
export function headToHead(yours: readonly StatsGame[], theirs: readonly StatsGame[]): HeadToHead {
  const tally: HeadToHead = { friend: { wins: 0, draws: 0, losses: 0 }, lobby: { wins: 0, draws: 0, losses: 0 } };
  const theirById = new Map(theirs.map((g) => [g.id, g]));
  for (const game of yours) {
    const mode = game.replayed.mode;
    const their = theirById.get(game.id);
    if (!their || (mode !== 'friend' && mode !== 'lobby')) continue;
    const result = resultOf(game, their);
    if (result === 'won') tally[mode].wins++;
    else if (result === 'drawn') tally[mode].draws++;
    else if (result === 'lost') tally[mode].losses++;
  }
  return tally;
}
