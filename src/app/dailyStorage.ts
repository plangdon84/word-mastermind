import { useEffect, useState } from 'preact/hooks';
import { addDays, isDailyDay, isObject, parseMarks, type DailyDay, type DailyMode, type DailyPlacement, type Marks } from '../game';
import type { ApiIdentity } from './apiIdentity';
import { parsePlacement, type DailyToday } from './dailyApi';
import { readStored, writeStored } from './localStore';

/*
 * What this device keeps about the daily games, the Daily Set (Daily Rush)
 * and the Daily Word, each on its own. The runs themselves are on the
 * server; this is only Medium's marks and whether today's run is in
 * progress (so a reload goes back into it), and your final places on past
 * days (for the badges and the history).
 */

export interface DailySaved {
  day: DailyDay;
  /** Today's run was started and isn't over. */
  playing: boolean;
  /** Medium's in/out marks, one set per word. */
  marks: readonly Marks[];
}

/** The Daily Set's keys are those from before the Daily Word. */
const KEY: Record<DailyMode, string> = { daily: 'word-mastermind:daily:v1', dailyWord: 'word-mastermind:daily-word:v1' };
const PLACEMENTS_KEY: Record<DailyMode, string> = {
  daily: 'word-mastermind:daily-placements:v1', dailyWord: 'word-mastermind:daily-word-placements:v1',
};
/** Whose places those are, and the latest day they're complete through (Dev Plan item 19zm). */
const HELD_KEY: Record<DailyMode, string> = {
  daily: 'word-mastermind:daily-placements-held:v1', dailyWord: 'word-mastermind:daily-word-placements-held:v1',
};

export function parseDailySaved(raw: string | null): DailySaved | null {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!isObject(data) || !isDailyDay(data.day) || !Array.isArray(data.marks)) return null;
    return { day: data.day, playing: data.playing === true, marks: data.marks.map(parseMarks) };
  } catch {
    return null;
  }
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadDaily(mode: DailyMode = 'daily'): DailySaved | null {
  try {
    return parseDailySaved(localStorage.getItem(KEY[mode]));
  } catch {
    return null;
  }
}

export function saveDaily(saved: DailySaved, mode: DailyMode = 'daily'): void {
  // If storage refuses it: the game is on the server.
  writeStored(KEY[mode], JSON.stringify(saved));
}

/**
 * Whether a reload should go back into a daily game: today's run, or
 * yesterday's, which can still be finished off the board.
 */
export const dailyInProgress = (today: DailyDay, mode: DailyMode = 'daily'): boolean => {
  const saved = loadDaily(mode);
  return saved !== null && (saved.day === today || saved.day === addDays(today, -1)) && saved.playing;
};

export function parsePlacements(raw: string | null): DailyPlacement[] {
  try {
    const data: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(data)) return [];
    return data.map(parsePlacement).filter((p): p is DailyPlacement => p !== null);
  } catch {
    return [];
  }
}

/** Your final places on past days, as the server last sent them: the Daily Set's, then the Daily Word's. */
export function loadPlacements(): DailyPlacement[] {
  const load = (mode: DailyMode) => {
    try {
      return parsePlacements(localStorage.getItem(PLACEMENTS_KEY[mode]));
    } catch {
      return [];
    }
  };
  return [...load('daily'), ...load('dailyWord').filter((p) => p.mode === 'dailyWord')];
}

/** Who `usePlacements` tells when this tab saves new places. */
const placementListeners = new Set<() => void>();

export function savePlacements(placements: readonly DailyPlacement[], mode: DailyMode = 'daily'): void {
  // If storage refuses it: the badges wait until the server can be asked again.
  writeStored(PLACEMENTS_KEY[mode], JSON.stringify(placements));
  placementListeners.forEach((update) => update());
}

/**
 * Whose places these are. Signing in keeps the device ID but plays as the
 * account (whose places include other devices'), and signing out gives a new
 * device ID, so the two together tell the players apart; not the token,
 * which a new session changes for the same player.
 */
const ownerOf = (identity: ApiIdentity) => `${identity.guestId}${identity.token ? ':account' : ''}`;

interface Held {
  of: string;
  through: DailyDay;
}

function loadHeld(mode: DailyMode): Held | null {
  try {
    const data: unknown = JSON.parse(readStored(HELD_KEY[mode]) ?? 'null');
    return isObject(data) && typeof data.of === 'string' && isDailyDay(data.through) ? { of: data.of, through: data.through } : null;
  } catch {
    return null;
  }
}

/**
 * The latest day this device's places for `mode` are complete through, for
 * `identity`, so the server sends only later ones; null to ask for them all
 * (none held, another player's, or kept by a version from before).
 */
export function placesHeldThrough(identity: ApiIdentity, mode: DailyMode): DailyDay | null {
  const held = loadHeld(mode);
  return held && held.of === ownerOf(identity) ? held.through : null;
}

/**
 * Keeps the places in a server's answer for `identity`: the whole list, or
 * (`placementsAfter` a day) those after it merged into what's held. Returns
 * what's now held, or null if the answer changed nothing: it sent none (an
 * action's), or only later ones for a list this device no longer holds.
 */
export function keepPlacements(identity: ApiIdentity, mode: DailyMode, today: DailyToday): DailyPlacement[] | null {
  const { placementsAfter: after, placements } = today;
  if (after === null) return null;
  const of = ownerOf(identity);
  let kept: DailyPlacement[];
  if (after === undefined) kept = placements;
  else {
    const held = loadHeld(mode);
    // Asked for while another player's (or no) list was held, or that list has moved on since (another tab).
    if (!held || held.of !== of || held.through !== after) return null;
    const before = parsePlacements(readStored(PLACEMENTS_KEY[mode])).filter((p) => p.day <= after);
    kept = [...before, ...placements];
  }
  savePlacements(kept, mode);
  // Complete through the day before yesterday: yesterday's board can still change after midnight (a run finished in
  // time whose save is retried later), so it's asked for again (2.7.2 review, round 1). Written after the list, so a
  // list storage refused is asked for whole next time.
  writeStored(HELD_KEY[mode], JSON.stringify({ of, through: addDays(today.day, -2) } satisfies Held));
  return kept;
}

/**
 * Your places (`loadPlacements`), read once and again only when new ones
 * are saved, here or in another tab (Issue 199), not on every redraw.
 */
export function usePlacements(): DailyPlacement[] {
  const [placements, setPlacements] = useState(loadPlacements);
  useEffect(() => {
    const update = () => setPlacements(loadPlacements());
    const fromTab = (e: StorageEvent) => {
      if (e.key === null || Object.values(PLACEMENTS_KEY).includes(e.key)) update();
    };
    placementListeners.add(update);
    window.addEventListener('storage', fromTab);
    return () => {
      placementListeners.delete(update);
      window.removeEventListener('storage', fromTab);
    };
  }, []);
  return placements;
}
