import { summarizeGame, type GameSummary, type ReplayedGame } from './history';

/*
 * The part of stats that the title screen's unlocks need at start-up, apart
 * from `stats.ts` and `achievements.ts`, which load after the page has (Dev
 * Plan item 19zq).
 */

/** A finished game from the history, rebuilt from its record. */
export interface StatsGame {
  id: string;
  replayed: ReplayedGame;
  /** Its summary, if already worked out, so it isn't worked out again (Dev Plan item 19c). */
  summary?: GameSummary;
}

/** A game's summary: the one it carries, else worked out from the replayed game. */
export const summaryOf = (game: StatsGame): GameSummary => game.summary ?? summarizeGame(game.replayed);
