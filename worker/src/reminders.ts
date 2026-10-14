import { DAY_MS, dailyDay, newYorkHour, type DailyDay, type DailyMode } from '../../src/game';
import { isPlayers } from './accounts';
import { comeBackNotice, dailiesNotice, type Notice, type ReminderKind } from './notices';
import { notifyGuest, reminderOn, type VapidKeys } from './push';

/*
 * Reminders (Dev Plan item 18zj, README "Reminders"), sent only to devices
 * with turn alerts on and the kind switched on. Time running out is the game
 * room's (`room.ts`). The other two come from the worker's Cron Trigger
 * (`wrangler.toml`), which runs `runReminders` every minute of the hours
 * they're due: the day's daily games at 8pm in New York, and coming back
 * after a week with no game at noon there. Each run sends a small batch, to
 * stay within the Workers Free plan's limits on a request (about 10 ms of
 * work and 50 calls), so a batch a minute reaches about 300 players an hour.
 */

/** When the dailies reminder goes out: 8pm in New York, with four hours of the day left. */
export const DAILIES_HOUR = 20;
/** When the come-back reminder goes out: noon in New York. */
export const COME_BACK_HOUR = 12;
/** A week with no game the server knows of. */
export const COME_BACK_AFTER_MS = 7 * DAY_MS;
/** Players reminded a run. */
export const REMINDER_BATCH = 5;

/** A player moved in a game against a friend: they're playing, so no come-back reminder. */
export async function notePlayed(db: D1Database, playerId: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO player_activity (player_id, played_at) VALUES (?1, ?2)
     ON CONFLICT (player_id) DO UPDATE SET played_at = MAX(played_at, excluded.played_at)`,
  ).bind(playerId, now).run();
}

/** A player started one of the day's daily games, so 8pm's reminder leaves it out (and they're playing). */
export async function noteDailyStarted(db: D1Database, mode: DailyMode, day: DailyDay, playerId: string, now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO daily_played (player_id, day, mode, played_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(playerId, day, mode, now).run();
}

/**
 * The players with a device that has this kind of reminder switched on:
 * each account once, whichever of its devices turned alerts on.
 */
const playersFor = (kind: ReminderKind) => `
  SELECT DISTINCT COALESCE(g.account_id, s.guest_id) AS player
  FROM push_subscriptions s LEFT JOIN guests g ON g.id = s.guest_id LEFT JOIN profiles p ON p.account_id = g.account_id
  WHERE ${reminderOn(kind)}`;

/** Whether `x.player` (or any of their account's guest IDs) started the day's game `mode`. */
const startedDaily = (mode: DailyMode) => `EXISTS (SELECT 1 FROM daily_played d
  WHERE d.day = ?1 AND d.mode = '${mode}' AND ${isPlayers('d.player_id', 'x.player')})`;

/** Marks a reminder as sent before sending it, so a run that fails partway never sends one twice. */
async function claim(db: D1Database, playerId: string, kind: ReminderKind, about: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO reminders_sent (player_id, kind, about, sent_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (player_id, kind) DO UPDATE SET about = excluded.about, sent_at = excluded.sent_at`,
  ).bind(playerId, kind, about, now).run();
}

/** Players due today's dailies reminder: not yet reminded today, with one or both games not started. */
async function dailiesDue(db: D1Database, day: DailyDay): Promise<{ player: string; set: number; word: number }[]> {
  const { results } = await db.prepare(
    `SELECT player, daily_set AS "set", daily_word AS word FROM (
       SELECT x.player, ${startedDaily('daily')} AS daily_set, ${startedDaily('dailyWord')} AS daily_word
       FROM (${playersFor('dailies')}) x
       WHERE NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.player_id = x.player AND r.kind = 'dailies' AND r.about = ?1)
     ) WHERE NOT (daily_set AND daily_word) ORDER BY player LIMIT ?2`,
  ).bind(day, REMINDER_BATCH).all<{ player: string; set: number; word: number }>();
  return results;
}

/**
 * Players due a come-back reminder: their last game the server knows of
 * (`player_activity`, under any of their IDs) was a week ago or more, and
 * they haven't been reminded since it. A player with no game it knows of
 * (a guest who only plays offline) is never reminded.
 */
async function comeBackDue(db: D1Database, now: number): Promise<{ player: string; last: number }[]> {
  const { results } = await db.prepare(
    `SELECT player, last FROM (
       SELECT x.player, (SELECT MAX(a.played_at) FROM player_activity a WHERE ${isPlayers('a.player_id', 'x.player')}) AS last
       FROM (${playersFor('comeBack')}) x
     ) WHERE last IS NOT NULL AND last <= ?1
       AND NOT EXISTS (SELECT 1 FROM reminders_sent r WHERE r.player_id = player AND r.kind = 'comeBack' AND r.about = CAST(last AS TEXT))
     ORDER BY player LIMIT ?2`,
  ).bind(now - COME_BACK_AFTER_MS, REMINDER_BATCH).all<{ player: string; last: number }>();
  return results;
}

/** What a run of the Cron Trigger did: the notices it sent. */
export interface RemindersRun {
  sent: Notice[];
}

/**
 * One run of the Cron Trigger: in New York's 8pm hour, a batch of dailies
 * reminders; in its noon hour, a batch of come-back reminders; otherwise
 * nothing. `now` is the scheduled time.
 */
export async function runReminders(
  db: D1Database, keys: VapidKeys | null, now: number, fetchFn: typeof fetch = fetch,
): Promise<RemindersRun> {
  if (!keys) return { sent: [] };
  const hour = newYorkHour(now);
  const due: { notices: Notice[]; kind: ReminderKind; about: string; player: string }[] = [];
  if (hour === DAILIES_HOUR) {
    const day = dailyDay(now);
    for (const { player, set, word } of await dailiesDue(db, day)) {
      due.push({ player, kind: 'dailies', about: day, notices: dailiesNotice(player, { daily: !set, dailyWord: !word }) });
    }
  } else if (hour === COME_BACK_HOUR) {
    for (const { player, last } of await comeBackDue(db, now)) {
      due.push({ player, kind: 'comeBack', about: String(last), notices: [comeBackNotice(player)] });
    }
  }
  const sent: Notice[] = [];
  await Promise.all(due.map(async ({ player, kind, about, notices }) => {
    await claim(db, player, kind, about, now);
    for (const notice of notices) {
      sent.push(notice);
      await notifyGuest(db, keys, notice.guestId, notice.message, now, fetchFn, notice.reminder).catch(() => {});
    }
  }));
  return { sent };
}
