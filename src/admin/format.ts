import type { DailyCounts, PeriodKind } from './usage';

/*
 * Labels and groupings for the usage dashboard (Dev Plan item 18m).
 */

const MODE_NAMES: Record<string, string> = {
  single: 'Single player',
  computer: 'Two player vs. computer',
  rush: 'Solo Rush',
  friend: 'Two player vs. a friend',
  daily: 'Daily Rush',
  dailyWord: 'Daily Word',
  lobby: 'Rush with Friends',
  competitive: 'Competitive Rush',
};

export const modeName = (mode: string): string => MODE_NAMES[mode] ?? mode;

/** The difficulties, in the order (and colours) the daily charts stack them. */
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme'] as const;

export const difficultyName = (difficulty: string): string => difficulty.charAt(0).toUpperCase() + difficulty.slice(1);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A period's short label: `16 Oct` for a day or a week (its Monday), `Oct 2026` for a month. */
export function periodLabel(period: string, kind: PeriodKind): string {
  const [year, month, day] = period.split('-').map(Number);
  return kind === 'month' ? `${MONTHS[month - 1]} ${year}` : `${day} ${MONTHS[month - 1]}`;
}

/** Finished entries on a day, every difficulty together. */
export const finishedOn = (day: DailyCounts): number => Object.values(day.finished).reduce((a, b) => a + b, 0);

let names: Intl.DisplayNames | undefined;

/** A country's English name (`GB` → `United Kingdom`), or the code; as the app's `countryName`, without sharing its bundle. */
export function countryName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The first `top` countries by name, the rest summed as Others (null when there are none). */
export function topCountries(
  countries: { country: string; count: number }[], top = 20,
): { rows: { name: string; count: number }[]; others: number | null } {
  const rest = countries.slice(top);
  return {
    rows: countries.slice(0, top).map((c) => ({ name: countryName(c.country), count: c.count })),
    others: rest.length > 0 ? rest.reduce((sum, c) => sum + c.count, 0) : null,
  };
}

/** A count with thousands separated. */
export const count = (n: number): string => n.toLocaleString('en-US');
