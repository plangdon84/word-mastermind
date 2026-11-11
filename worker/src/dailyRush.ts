import { HISTORY_VERSION } from '../../src/game';
import { handleDaily, saveFinishedDaily, type DailyDeps, type DailyRequest } from './dailyRoom';
import { themeFor } from './dailyThemes';
import { pickWordFor } from './dailyWords';
import { json } from './http';
import { noteDailyStarted } from './reminders';
import type { Env } from './index';

/**
 * One Durable Object per day's daily games (the Daily Set and the Daily
 * Word), named by its day: the day's referee (`dailyRoom.ts`). Each
 * request is handled whole before the next starts (`blockConcurrencyWhile`),
 * even while it waits on D1 (Cloudflare only holds a request back while
 * storage is in use), so a player's two guesses can't race and a finished
 * run is saved once. The worker (`dailyRoutes.ts`) checks
 * each request before passing it on.
 */
export class DailyRush implements DurableObject {
  private readonly deps: DailyDeps;

  constructor(private readonly state: DurableObjectState, env: Env) {
    this.deps = {
      saveFinished: (mode, day, entry, totals, late, now) => saveFinishedDaily(env.DB, mode, day, entry, totals, late, HISTORY_VERSION, now),
      random: Math.random,
      themeFor: (day) => themeFor(env.DB, day),
      wordFor: (day) => pickWordFor(env.DB, day, Math.random),
      started: (mode, day, playerId, now) => noteDailyStarted(env.DB, mode, day, playerId, now),
    };
  }

  async fetch(request: Request): Promise<Response> {
    const dailyRequest = await request.json<DailyRequest>();
    const { status, body } = await this.state.blockConcurrencyWhile(
      () => handleDaily(this.state.storage, this.deps, dailyRequest, Date.now()));
    return json(body, status);
  }
}
