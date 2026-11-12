import { HISTORY_VERSION, type DailyDay } from '../../src/game';
import { handleDaily, saveFinishedDaily, type DailyDeps, type DailyRequest } from './dailyRoom';
import { themeFor, type DailyTheme } from './dailyThemes';
import { pickWordFor } from './dailyWords';
import { json } from './http';
import { noteDailyStarted } from './reminders';
import type { Env } from './index';
import { wholeRequest } from './whole';

/**
 * One Durable Object per day's daily games (the Daily Set and the Daily
 * Word), named by its day: the day's referee (`dailyRoom.ts`). Each
 * request is handled whole before the next starts (`blockConcurrencyWhile`),
 * even while it waits on D1 (Cloudflare only holds a request back while
 * storage is in use), so a player's two guesses can't race and a finished
 * run is saved once. The worker (`dailyRoutes.ts`) checks
 * each request before passing it on. Since the 2.7.2 review, the day's
 * theme and Daily Word are read from D1 once and then remembered (neither
 * changes within a day), and the 8pm reminder's "started" note is written
 * after answering, so a start doesn't hold every other daily player back
 * while it waits on D1.
 */
export class DailyRush implements DurableObject {
  private readonly deps: DailyDeps;
  /** Each day's theme and Daily Word, once read: they never change within a day. */
  private readonly themes = new Map<DailyDay, DailyTheme>();
  private readonly words = new Map<DailyDay, string>();

  constructor(private readonly state: DurableObjectState, env: Env) {
    this.deps = {
      saveFinished: (mode, day, entry, totals, late, now) => saveFinishedDaily(env.DB, mode, day, entry, totals, late, HISTORY_VERSION, now),
      random: Math.random,
      themeFor: async (day) => {
        // A day without a theme isn't remembered, so a theme loaded later in the day is still found.
        const known = this.themes.get(day) ?? await themeFor(env.DB, day);
        if (known) this.themes.set(day, known);
        return known;
      },
      wordFor: async (day) => {
        const known = this.words.get(day) ?? await pickWordFor(env.DB, day, Math.random);
        this.words.set(day, known);
        return known;
      },
      started: async (mode, day, playerId, now) => {
        state.waitUntil(noteDailyStarted(env.DB, mode, day, playerId, now).catch(() => {}));
      },
    };
  }

  async fetch(request: Request): Promise<Response> {
    const dailyRequest = await request.json<DailyRequest>();
    // A finished run's save to D1 runs after this request's turn, so the day's other players don't wait for it, but
    // before its answer, so the player's place is on the board by the time the app looks (2.7.2 review).
    const afterTurn: (() => Promise<void>)[] = [];
    const deps: DailyDeps = { ...this.deps, afterTurn: (work) => afterTurn.push(work) };
    const done = await wholeRequest(this.state, () => handleDaily(this.state.storage, deps, dailyRequest, Date.now()));
    if (!done.ok) return done.response;
    for (const work of afterTurn) await work().catch((error) => console.error('daily save failed', error));
    return json(done.value.body, done.value.status);
  }
}
