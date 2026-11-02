/*
 * The title screen's Daily card folded to one line (issue 222, README "Title
 * screen"): tapping its heading collapses or opens it, remembered on this
 * device, and collapsed it says what's left to play today.
 */
import { DAILY_MODES, type DailyMode } from '../game';
import type { DailyToday } from './dailyApi';
import { readStored, removeStored, writeStored } from './localStore';

const KEY = 'word-mastermind:daily-card:v1';

export function loadDailyCollapsed(): boolean {
  return readStored(KEY) === 'collapsed';
}

export function saveDailyCollapsed(collapsed: boolean): void {
  // If storage refuses it: it opens again next visit; nothing else is lost.
  if (collapsed) writeStored(KEY, 'collapsed');
  else removeStored(KEY);
}

/**
 * "2 to play", "1 to play" or "Played": the daily games not yet finished or
 * given up, of those open (`modes`; the Daily Set may still be locked),
 * leaving out a day with no Daily Set. Null while any of them loads.
 */
export function dailyLeftText(
  today: Record<DailyMode, DailyToday | null>, inProgress: Record<DailyMode, boolean>, modes: readonly DailyMode[] = DAILY_MODES,
): string | null {
  if (modes.some((mode) => today[mode] === null)) return null;
  const left = modes.filter((mode) => {
    const { run, theme } = today[mode]!;
    if (run) return run.status === 'playing';
    return mode !== 'daily' || theme !== null || inProgress[mode];
  }).length;
  return left === 0 ? 'Played' : `${left} to play`;
}
