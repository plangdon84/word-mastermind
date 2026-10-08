import { isLive, isObject, isTime, type Difficulty, type TimeControl, type WordError } from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';

/*
 * The matchmaking queue (README "Random opponent"): signed-in players wait
 * with their secret word, one queue per time control and difficulty, and
 * the server pairs them by rating into a rated game against a person. The
 * worker imports these shapes too.
 */

/** Where you are in a queue. */
export type QueueStatus =
  /** Waiting since `since` (the server's clock), with `waiting` others in the queue. */
  | { state: 'waiting'; since: number; waiting: number; now: number }
  /** Matched: the game to open. */
  | { state: 'matched'; gameId: string }
  /** Not in the queue (you left, or waited too long without checking in). */
  | { state: 'idle' };

export type QueueError = WordError | 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'unreachable';

/** Which queue: a time control and a difficulty. */
export interface QueueChoice {
  timeControl: TimeControl;
  difficulty: Difficulty;
}

/**
 * The queue for these settings. It offers the live clocks only, so a saved
 * correspondence time control (from a game against a friend) becomes 10
 * minutes each, rather than a queue the server refuses.
 */
export function queueChoice(timeControl: TimeControl, difficulty: Difficulty): QueueChoice {
  return { timeControl: isLive(timeControl) ? timeControl : '10m', difficulty };
}

export function parseQueueStatus(value: unknown): QueueStatus | null {
  if (!isObject(value)) return null;
  if (value.state === 'idle') return { state: 'idle' };
  if (value.state === 'matched') {
    return typeof value.gameId === 'string' && /^[0-9a-f]{64}$/.test(value.gameId) ? { state: 'matched', gameId: value.gameId } : null;
  }
  if (value.state === 'waiting' && isTime(value.since) && isTime(value.now) && Number.isInteger(value.waiting)) {
    return { state: 'waiting', since: value.since, waiting: value.waiting as number, now: value.now };
  }
  return null;
}

export class QueueApiError extends Error {
  constructor(readonly code: QueueError, readonly status: number) {
    super(`The server answered ${status}: ${code}`);
  }
}

export interface QueueApi {
  /** Joins the queue with your word, or matches you at once. */
  join(choice: QueueChoice, name: string, secret: string): Promise<QueueStatus>;
  /** Checks in: keeps your place, and says when you're matched. */
  poll(choice: QueueChoice): Promise<QueueStatus>;
  leave(choice: QueueChoice): Promise<QueueStatus>;
}

export function queueApi(apiUrl: string, identity: ApiIdentity, fetchFn: typeof fetch = fetch): QueueApi {
  const request = apiRequester(apiUrl, identity, fetchFn, (code, status) => new QueueApiError(code as QueueError, status));
  const post = async (path: string, body: unknown): Promise<QueueStatus> => {
    const status = parseQueueStatus(await request('POST', path, body));
    if (!status) throw new QueueApiError('bad-request', 200);
    return status;
  };
  return {
    join: (choice, name, secret) => post('/api/queue', { ...choice, name, secret }),
    poll: (choice) => post('/api/queue/poll', choice),
    leave: (choice) => post('/api/queue/leave', choice),
  };
}
