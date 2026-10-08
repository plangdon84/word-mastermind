/*
 * The launch switches (README "Launch switches"): one list, read by the app
 * and the worker. A mode that's off is left off the title screen and the
 * Leaderboards page, its badge isn't offered, and the worker refuses its
 * routes (404 `off`). Turning one on is a one-line change here, shipped to
 * the app and the worker by the same merge.
 */

export interface Features {
  /** Two player vs. a random opponent: the matchmaking queue (README "Random opponent"). */
  randomOpponent: boolean;
  /**
   * The rating boards on the Leaderboards page: Live 15, 10 and 5 minutes,
   * Correspondence and Competitive Rush. The Daily Rush board is always on,
   * and so are ratings themselves (rated challenges between friends).
   */
  ratingBoards: boolean;
  /** Competitive Rush (README "Competitive Rush"). */
  competitiveRush: boolean;
  /** Easy's Suggest button (README "Easy"): on at 1.0, as decided in Dev Plan item 13c. */
  suggest: boolean;
  /**
   * The Daily Rush top 10% badge (README "Achievements"): off until the Daily
   * Rush regularly has more than 10 players, since with fewer even 1st place
   * isn't in the top 10%.
   */
  dailyTopTenPercent: boolean;
}

export type Feature = keyof Features;

/** Off for the 1.0 launch, until there are enough players (Dev Plan item 13b). */
export const FEATURES: Readonly<Features> = {
  randomOpponent: false,
  ratingBoards: false,
  competitiveRush: false,
  suggest: true,
  dailyTopTenPercent: false,
};
