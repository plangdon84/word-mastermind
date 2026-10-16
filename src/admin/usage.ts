/*
 * The usage dashboard's figures (Dev Plan item 18m): what `GET
 * /api/admin/figures` answers, shared by the worker and the page. Totals
 * only: never a player's ID, name or email. Nothing here imports the game
 * or the app, so the page shares no code with the app's bundle.
 */

/** A count for one period: a day (`2026-10-16`), a week (its Monday) or a month (its first day). */
export interface PeriodCount {
  period: string;
  count: number;
}

/** Counts per day (the last 30), week (the last 12, from Monday) and month (the last 12), oldest first. */
export interface Periods {
  day: PeriodCount[];
  week: PeriodCount[];
  month: PeriodCount[];
}

export type PeriodKind = keyof Periods;

export interface ModeCount {
  /** A history mode, or `competitive` for Competitive Rush (a lobby with `kind: 'competitive'`). */
  mode: string;
  total: number;
  /** Started in the last 30 days. */
  recent: number;
}

/** Entries on one day of a daily game, by difficulty, and how many players started it. */
export interface DailyCounts {
  day: string;
  started: number;
  /** Finished entries on the day's boards (giving up leaves none), by difficulty. */
  finished: Record<string, number>;
}

export interface Usage {
  /** When the figures were counted (ms). */
  at: number;
  players: {
    /** Players: guests who never signed in, plus accounts. */
    total: number;
    /** Guests who never signed in. */
    guests: number;
    accounts: number;
    /** Devices (guest IDs), each signed-in browser counting once. */
    devices: number;
  };
  /** Players who opened the app online in the last 24 hours, 7 days and 30 days. */
  active: { day: number; week: number; month: number };
  /** Players seen for the first time. */
  newPlayers: Periods;
  newAccounts: Periods;
  /** Players who started, finished or moved in a game the server knows of. */
  playing: Periods;
  /** Online games (refereed by the server) and signed-in players' synced games. */
  games: { online: ModeCount[]; synced: ModeCount[] };
  /** The last 30 days, oldest first. */
  daily: DailyCounts[];
  dailyWord: DailyCounts[];
  /** Signed-in players by the country in their profile (its code), most first; `noCountry` chose none. */
  countries: { country: string; count: number }[];
  noCountry: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A light check that an answer is the figures, not an error. */
export function isUsage(value: unknown): value is Usage {
  return isObject(value) && typeof value.at === 'number' && isObject(value.players) && isObject(value.newPlayers)
    && isObject(value.games) && Array.isArray(value.daily) && Array.isArray(value.countries);
}
