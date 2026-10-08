import type { QueueChoice } from '../../src/app/queueApi';
import { startMatchedGame } from './games';
import { json } from './http';
import type { Env } from './index';
import { handleQueue, type QueueDeps, type QueueRequest } from './queue';

/** A request to a queue's Durable Object: the queue's own choice comes with it, for the games it starts. */
export type MatchmakerRequest = QueueRequest & QueueChoice;

/** The queue's Durable Object name: its time control and difficulty ("10m:hard"). */
export const queueName = ({ timeControl, difficulty }: QueueChoice) => `${timeControl}:${difficulty}`;

/** What a queue needs from outside: starting a game in a game room, with its time control and difficulty. */
export const queueDeps = (env: Env, { timeControl, difficulty }: QueueChoice): QueueDeps => ({
  startGame: (host, guest, now) => startMatchedGame(env, host, guest, timeControl, difficulty, now),
});

/**
 * One Durable Object per matchmaking queue, named by its time control and
 * difficulty (`queueName`): the queue's referee (`queue.ts`). Cloudflare
 * handles its requests one at a time, and it starts each matched game in a
 * game room (`GameRoom`) like any other.
 */
export class Matchmaker implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const { timeControl, difficulty, ...queueRequest } = await request.json<MatchmakerRequest>();
    const deps = queueDeps(this.env, { timeControl, difficulty });
    const { status, body } = await handleQueue(this.state.storage, deps, queueRequest as QueueRequest, Date.now());
    return json(body, status);
  }
}
