/*
 * When each Daily Rush day starts and ends (README "Daily Rush"). A day is
 * named by its date, e.g. `2026-10-31`. Days before `NEW_YORK_FROM` ran
 * midnight to midnight UTC; from it on, the day changes at midnight in New
 * York, following daylight saving (4:00 or 5:00 UTC). So the day
 * `NEW_YORK_FROM` itself starts at midnight UTC and ends at New York's next
 * midnight, a few hours longer than the rest. Like the rest of the game logic,
 * nothing here reads the clock. No imports, so Node scripts can run it as is.
 */

/** A Daily Rush day, e.g. `2026-10-31`. */
export type DailyDay = string;

/** The first day to end at New York's midnight rather than UTC's. It must not be before the day it ships. */
export const NEW_YORK_FROM: DailyDay = '2026-10-19';

const DAY_MS = 24 * 60 * 60 * 1000;

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

/** The date and hour in New York at `ms`. */
function newYork(ms: number): { date: string; hour: number } {
  const part: Record<string, string> = {};
  for (const p of NEW_YORK.formatToParts(ms)) part[p.type] = p.value;
  return { date: `${part.year}-${part.month}-${part.day}`, hour: Number(part.hour) % 24 };
}

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const utcMidnight = (day: DailyDay): number => Date.parse(`${day}T00:00:00Z`);

/** The date before or after, `by` days away: on the calendar, whatever the days' lengths. */
export const addDays = (day: DailyDay, by: number): DailyDay => utcDate(utcMidnight(day) + by * DAY_MS);

/** Midnight in New York starting `day`: 4:00 UTC in summer time, 5:00 in winter. */
function newYorkMidnight(day: DailyDay): number {
  for (const hour of [4, 5]) {
    const at = utcMidnight(day) + hour * 60 * 60 * 1000;
    const there = newYork(at);
    if (there.date === day && there.hour === 0) return at;
  }
  throw new Error(`No midnight in New York on ${day}`);
}

/** When a day ends, and the next set of words is out. */
export function dayEnd(day: DailyDay): number {
  const next = addDays(day, 1);
  return day < NEW_YORK_FROM ? utcMidnight(next) : newYorkMidnight(next);
}

/** When a day starts: when the day before ended. */
export const dayStart = (day: DailyDay): number => dayEnd(addDays(day, -1));

/** The day `now` falls on. */
export function dailyDay(now: number): DailyDay {
  const utc = utcDate(now);
  if (utc < NEW_YORK_FROM) return utc;
  // Between midnight UTC and New York's on the first New York day, New York still has the day before.
  const there = newYork(now).date;
  return there < NEW_YORK_FROM ? NEW_YORK_FROM : there;
}

/** Is this a day as `dailyDay` writes them? */
export function isDailyDay(value: unknown): value is DailyDay {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const start = utcMidnight(value);
  return Number.isFinite(start) && utcDate(start) === value;
}
