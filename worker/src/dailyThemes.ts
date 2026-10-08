import type { DailyDay } from '../../src/game';
import type { DailyTheme } from './themeDays';

export type { DailyTheme } from './themeDays';

/*
 * The Daily Rush's themes, one per UTC day, from D1 (`daily_themes`). They
 * never come from the repo, which is public, and never reach the app until
 * the day is over. `npm run daily-themes` loads them (`themeDays.ts`).
 */

/** The day's theme, or null on a day with none loaded. */
export async function themeFor(db: D1Database, day: DailyDay): Promise<DailyTheme | null> {
  const row = await db.prepare('SELECT theme_id, theme, words FROM daily_themes WHERE day = ?1')
    .bind(day).first<{ theme_id: string; theme: string; words: string }>();
  return row && { id: row.theme_id, theme: row.theme, words: row.words.split(',') };
}
