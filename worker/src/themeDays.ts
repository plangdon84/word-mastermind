/*
 * The rules for loading the Daily Rush's themes into D1 (`daily_themes`):
 * joining the private calendar's files, checking each day, and the SQL.
 * Used by `npm run daily-themes`, the browser tests' server and the load
 * test, so it imports nothing: Node runs it with its own TypeScript support.
 */

/** A UTC day, e.g. "2026-10-31" (`DailyDay` in src/game). */
type Day = string;

export interface DailyTheme {
  id: string;
  /** The theme's name, shown to players. */
  theme: string;
  words: readonly string[];
}

/** A day and its theme, as `npm run daily-themes` loads it. */
export interface ThemeDay extends DailyTheme {
  day: Day;
}

/** The private calendar's files: the themes, and the calendar linking each to a day. */
export interface CalendarFiles {
  themes: { themes: readonly { id: string; theme: string; words: readonly string[] }[] };
  calendar: { days: readonly { date: string; id: string }[] };
}

/** Each day in the calendar with its theme; throws on a day whose theme isn't in the themes file. */
export function calendarDays({ themes, calendar }: CalendarFiles): ThemeDay[] {
  const byId = new Map(themes.themes.map((t) => [t.id, t]));
  return calendar.days.map(({ date, id }) => {
    const theme = byId.get(id);
    if (!theme) throw new Error(`${date}'s theme ${id} isn't in the themes file.`);
    return { day: date, id, theme: theme.theme, words: theme.words };
  });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9-]+$/;

/** What's wrong with these days, if anything: each needs a real date, an ID, a name and 4 different secret words. */
export function themeDayProblems(days: readonly ThemeDay[], isSecretWord: (word: string) => boolean): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { day, id, theme, words } of days) {
    // Date.parse gives NaN for a month 13 or a day 32, which toISOString would throw on.
    const ms = DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN;
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day) problems.push(`${day}: not a date`);
    if (seen.has(day)) problems.push(`${day}: listed twice`);
    seen.add(day);
    if (!ID.test(id)) problems.push(`${day}: the theme ID "${id}" isn't lower-case letters, digits and dashes`);
    if (!theme.trim()) problems.push(`${day}: the theme has no name`);
    if (words.length !== 4 || new Set(words).size !== 4) problems.push(`${day}: needs 4 different words`);
    for (const word of words) if (!isSecretWord(word)) problems.push(`${day}: ${word} isn't on the secret list`);
  }
  return problems;
}

const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;

/**
 * SQL that loads `days`, adding new days and replacing days after `today`.
 * Today and the days before it are never changed: they've been played, and
 * their boards show their words.
 */
export function themeDaysSql(days: readonly ThemeDay[], today: Day): string {
  return days.map(({ day, id, theme, words }) =>
    `INSERT INTO daily_themes (day, theme_id, theme, words) VALUES (${quote(day)}, ${quote(id)}, ${quote(theme)}, ${quote(words.join(','))})`
    + ` ON CONFLICT (day) DO UPDATE SET theme_id = excluded.theme_id, theme = excluded.theme, words = excluded.words`
    + ` WHERE daily_themes.day > ${quote(today)};`).join('\n');
}
