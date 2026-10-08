import { addDays, isDailyDay, isObject, parseMarks, type DailyDay, type DailyPlacement, type Marks } from '../game';
import { parsePlacement } from './dailyApi';

/*
 * What this device keeps about Daily Rush. The runs themselves are on the
 * server; this is only Medium's marks and whether today's run is in
 * progress (so a reload goes back into it), and your final places on past
 * days (for the badges).
 */

export interface DailySaved {
  day: DailyDay;
  /** Today's run was started and isn't over. */
  playing: boolean;
  /** Medium's in/out marks, one set per word. */
  marks: readonly Marks[];
}

const KEY = 'word-mastermind:daily:v1';
const PLACEMENTS_KEY = 'word-mastermind:daily-placements:v1';

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
export function loadDaily(): DailySaved | null {
  try {
    return parseDailySaved(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveDaily(saved: DailySaved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage is a convenience; the game is on the server.
  }
}

/**
 * Whether a reload should go back into Daily Rush: today's run, or
 * yesterday's, which can still be finished off the board.
 */
export const dailyInProgress = (today: DailyDay): boolean => {
  const saved = loadDaily();
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

/** Your final places on past days, as the server last sent them. */
export function loadPlacements(): DailyPlacement[] {
  try {
    return parsePlacements(localStorage.getItem(PLACEMENTS_KEY));
  } catch {
    return [];
  }
}

export function savePlacements(placements: readonly DailyPlacement[]): void {
  try {
    localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
  } catch {
    // The badges wait until the server can be asked again.
  }
}
