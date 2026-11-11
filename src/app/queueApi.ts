import { isObject, isTime, type QueueChoice, type WordError } from '../game';
import { apiRequester, type ApiIdentity } from './apiIdentity';

/*
 * The matchmaking queue (README "Random opponent"): signed-in players wait
 * with their secret word, one queue per time control and difficulty, and
 * the server pairs them by rating into a rated game against a person. The
 * worker imports these shapes too.
 */

/** Where you are in a queue. */
export type QueueStatus =
  /**
   * Waiting since `since` (the server's clock), with `waiting` others in the
   * queue and `playing` people in ladder games now (Dev Plan item 19w; absent
   * from a server before it).
   */
  | { state: 'waiting'; since: number; waiting: number; playing?: number; now: number }
  /** Matched: the game to open. */
  | { state: 'matched'; gameId: string }
  /** Not in the queue (you left, or waited too long without checking in). */
  | { state: 'idle' };

/**
 * How busy the rated ladder is (Dev Plan item 19w, README "Random
 * opponent"): how many people wait in the queue and how many are in ladder
 * games now. Numbers only, never who.
 */
export interface QueueBusy {
  waiting: number;
  playing: number;
}

export type QueueError = WordError | 'offensive-name' | 'bad-request' | 'bad-guest-id' | 'signed-out' | 'sign-in-needed' | 'unreachable';


export function parseQueueStatus(value: unknown): QueueStatus | null {
  if (!isObject(value)) return null;
  if (value.state === 'idle') return { state: 'idle' };
  if (value.state === 'matched') {
    return typeof value.gameId === 'string' && /^[0-9a-f]{64}$/.test(value.gameId) ? { state: 'matched', gameId: value.gameId } : null;
  }
  if (value.state === 'waiting' && isTime(value.since) && isTime(value.now) && isCount(value.waiting)) {
    return {
      state: 'waiting', since: value.since, waiting: value.waiting, now: value.now,
      ...(isCount(value.playing) ? { playing: value.playing } : {}),
    };
  }
  return null;
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function parseQueueBusy(value: unknown): QueueBusy | null {
  return isObject(value) && isCount(value.waiting) && isCount(value.playing) ? { waiting: value.waiting, playing: value.playing } : null;
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
  /** How busy the queue is, without joining it. */
  busy(choice: QueueChoice): Promise<QueueBusy>;
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
    busy: async (choice) => {
      const busy = parseQueueBusy(await request('POST', '/api/queue/busy', choice));
      if (!busy) throw new QueueApiError('bad-request', 200);
      return busy;
    },
  };
}
