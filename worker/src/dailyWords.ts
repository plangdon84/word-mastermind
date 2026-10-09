import { addDays, SECRET_WORDS, type DailyDay } from '../../src/game';
import { themeFor } from './dailyThemes';

/*
 * The Daily Word's words, one per day, in D1 (`daily_words`). The server
 * picks each day's at random from the secret list the first time someone
 * starts it, so nothing in the repo, which is public, can tell what it will
 * be, and keeps it so the day's word never changes.
 */

/** A word isn't the Daily Word again within this many days. */
export const DAILY_WORD_REPEAT_DAYS = 365;

/** The day's word, or null if nobody has started that day's yet. */
export async function wordFor(db: D1Database, day: DailyDay): Promise<string | null> {
  return await db.prepare('SELECT word FROM daily_words WHERE day = ?1').bind(day).first<string>('word');
}

/**
 * The day's word, picking it first if it hasn't been: a secret-list word
 * that wasn't the Daily Word in the past year, nor in that day's Daily Set.
 * Two picks at once keep whichever was saved first.
 */
export async function pickWordFor(db: D1Database, day: DailyDay, random: () => number): Promise<string> {
  const picked = await wordFor(db, day);
  if (picked) return picked;
  const { results } = await db.prepare('SELECT word FROM daily_words WHERE day >= ?1 AND day < ?2')
    .bind(addDays(day, -DAILY_WORD_REPEAT_DAYS), day).all<{ word: string }>();
  const used = new Set([...results.map((r) => r.word), ...(await themeFor(db, day))?.words ?? []]);
  const fresh = SECRET_WORDS.filter((w) => !used.has(w));
  const pool = fresh.length > 0 ? fresh : SECRET_WORDS;
  const word = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  await db.prepare('INSERT OR IGNORE INTO daily_words (day, word) VALUES (?1, ?2)').bind(day, word).run();
  return (await wordFor(db, day))!;
}
