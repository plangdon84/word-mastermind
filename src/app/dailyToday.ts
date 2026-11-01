/*
 * Today's Daily Set and Daily Word for the title screen (issue 250). The
 * last answer is kept while the app is open, so coming back to the title
 * screen shows what it already knew while it asks again, rather than every
 * game as not played; a game it doesn't know yet is null (the card says
 * "Loading…", never Play). It asks again on coming back to the page, and a
 * failed answer keeps what it had.
 */
import { useEffect, useState } from 'preact/hooks';
import { DAILY_MODES, type DailyMode } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { API_URL } from './config';
import { dailyGames, type DailyToday } from './dailyApi';

export type DailyGamesToday = Record<DailyMode, DailyToday | null>;

export interface DailyKnown {
  games: DailyGamesToday;
  /** The server's clock minus this device's, for the countdown. */
  offset: number;
  /** The last request for a game still unknown failed. */
  failed: boolean;
}

const NONE: DailyGamesToday = { daily: null, dailyWord: null };

/** What this page last heard, and for whom: another player's (after signing in or out) isn't shown. */
let cache: { who: string; games: DailyGamesToday; offset: number } | null = null;

const whoOf = (identity: ApiIdentity) => `${identity.guestId}:${identity.token ?? ''}`;

/** A game known from before, unless its day is over by the server's clock. */
const current = (today: DailyToday | null, offset: number, now: number) =>
  (today && now + offset < today.nextAt ? today : null);

/** The games kept for `identity`, those still today. */
export function knownDailies(identity: ApiIdentity, now: number): DailyGamesToday {
  if (!cache || cache.who !== whoOf(identity)) return NONE;
  const { games, offset } = cache;
  return { daily: current(games.daily, offset, now), dailyWord: current(games.dailyWord, offset, now) };
}

/** Merges an answer into what was known: a game that didn't come keeps the one before. */
export function mergeDailies(before: DailyGamesToday, answer: DailyGamesToday): DailyGamesToday {
  return { daily: answer.daily ?? before.daily, dailyWord: answer.dailyWord ?? before.dailyWord };
}

/**
 * What the Daily screen last heard about one game (review of PR #51): kept
 * for the title screen, so coming back right after playing it shows it
 * played rather than what the title screen heard before. Its place on the
 * board comes with the title screen's next answer.
 */
export function noteDaily(identity: ApiIdentity, mode: DailyMode, today: DailyToday): void {
  const who = whoOf(identity);
  const before = cache?.who === who ? cache : { who, games: NONE, offset: today.now - Date.now() };
  cache = { ...before, games: { ...before.games, [mode]: today } };
}

/** Forgets what this page heard (tests). */
export function forgetDailies(): void {
  cache = null;
}

/**
 * Today's daily games, kept across visits to the title screen; `onAnswer`
 * runs with each answer from the server (for its badges' placements).
 */
export function useDailyToday(identity: ApiIdentity, onAnswer: (games: DailyGamesToday) => void): DailyKnown {
  const [known, setKnown] = useState<DailyKnown>(() => ({
    games: knownDailies(identity, Date.now()), offset: cache?.who === whoOf(identity) ? cache.offset : 0, failed: false,
  }));
  useEffect(() => {
    const apiUrl = API_URL;
    if (!apiUrl) return;
    let live = true;
    const who = whoOf(identity);
    // A change of player starts again from nothing.
    setKnown((k) => (cache?.who === who ? k : { games: NONE, offset: 0, failed: false }));
    const ask = () => {
      // One request for both (Issue 213).
      dailyGames(apiUrl, identity).then((answer) => {
        if (!live) return;
        onAnswer(answer);
        const before = knownDailies(identity, Date.now());
        const games = mergeDailies(before, answer);
        const heard = DAILY_MODES.map((m) => answer[m]).find((t) => t !== null);
        const offset = heard ? heard.now - Date.now() : cache?.who === who ? cache.offset : 0;
        cache = { who, games, offset };
        setKnown({ games, offset, failed: DAILY_MODES.some((m) => games[m] === null) });
      });
    };
    ask();
    const onVisible = () => {
      if (document.visibilityState === 'visible') ask();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [identity.guestId, identity.token]);
  return known;
}
