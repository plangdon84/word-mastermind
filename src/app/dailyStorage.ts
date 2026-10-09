import { addDays, isDailyDay, isObject, parseMarks, type DailyDay, type DailyMode, type DailyPlacement, type Marks } from '../game';
import { parsePlacement } from './dailyApi';

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
  try {
    localStorage.setItem(KEY[mode], JSON.stringify(saved));
  } catch {
    // Storage is a convenience; the game is on the server.
  }
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

export function savePlacements(placements: readonly DailyPlacement[], mode: DailyMode = 'daily'): void {
  try {
    localStorage.setItem(PLACEMENTS_KEY[mode], JSON.stringify(placements));
  } catch {
    // The badges wait until the server can be asked again.
  }
}
