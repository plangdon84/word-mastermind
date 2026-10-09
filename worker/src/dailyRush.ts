import { HISTORY_VERSION } from '../../src/game';
import { handleDaily, saveFinishedDaily, type DailyDeps, type DailyRequest } from './dailyRoom';
import { themeFor } from './dailyThemes';
import { pickWordFor } from './dailyWords';
import { json } from './http';
import type { Env } from './index';

/**
 * One Durable Object per day's daily games (the Daily Set and the Daily
 * Word), named by its day: the day's referee (`dailyRoom.ts`). Cloudflare handles its requests one at a time,
 * so a player's two guesses can't race. The worker (`dailyRoutes.ts`) checks
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
    };
  }

  async fetch(request: Request): Promise<Response> {
    const dailyRequest = await request.json<DailyRequest>();
    const { status, body } = await handleDaily(this.state.storage, this.deps, dailyRequest, Date.now());
    return json(body, status);
  }
}
