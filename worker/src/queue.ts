import { validateSecretWord, type Rating } from '../../src/game';
import type { QueueError, QueueStatus } from '../../src/app/queueApi';

/*
 * The matchmaking queue's referee (README "Random opponent"), run by one
 * Durable Object per time control and difficulty (`matchmaker.ts`). Players
 * wait with their secret word, checking in every few seconds; the queue
 * pairs two whose ratings are close enough, allowing a wider gap the longer
 * either has waited, and starts a rated game between them. Like the game
 * logic, it never reads the clock: the time is passed in.
 */

/** A player waiting in the queue. */
export interface Seeker {
  accountId: string;
  name: string;
  secret: string;
  rating: Rating;
  joinedAt: number;
  /** When they last checked in. */
  seenAt: number;
}

/** A game the queue started, kept so the player who was waiting learns of it. */
interface Match {
  gameId: string;
  at: number;
}

interface QueueState {
  seekers: Seeker[];
  matches: Record<string, Match>;
}

/** A player who hasn't checked in for this long has left (closed the page), and loses their place. */
export const STALE_MS = 30_000;
/** How long a match waits to be picked up. */
export const MATCH_KEEP_MS = 10 * 60 * 1000;
/** The rating gap allowed at once, and how much wider it gets each second the longer-waiting player has waited. */
export const BASE_GAP = 200;
export const GAP_PER_SECOND = 10;

/** The widest rating gap two players may be matched across, at `now`. */
export const allowedGap = (a: Seeker, b: Seeker, now: number) =>
  BASE_GAP + (GAP_PER_SECOND * (now - Math.min(a.joinedAt, b.joinedAt))) / 1000;

/**
 * The best opponent for `seeker` among the others: the closest rating within
 * the allowed gap, the longest waiting on a tie; or null.
 */
export function pickOpponent(seeker: Seeker, others: readonly Seeker[], now: number): Seeker | null {
  let best: Seeker | null = null;
  for (const other of others) {
    if (other.accountId === seeker.accountId) continue;
    const gap = Math.abs(other.rating.rating - seeker.rating.rating);
    if (gap > allowedGap(seeker, other, now)) continue;
    const bestGap = best && Math.abs(best.rating.rating - seeker.rating.rating);
    if (!best || gap < bestGap! || (gap === bestGap && other.joinedAt < best.joinedAt)) best = other;
  }
  return best;
}

export interface QueueStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface QueueDeps {
  /** Starts a rated game: `host` waited longer, `guest` made the match. Returns its ID. */
  startGame(host: Seeker, guest: Seeker, now: number): Promise<string>;
}

export type QueueRequest =
  | { action: 'join'; accountId: string; name: string; secret: string; rating: Rating }
  | { action: 'poll'; accountId: string }
  | { action: 'leave'; accountId: string };

export type QueueResponse = { status: number; body: QueueStatus | { error: QueueError } };

const KEY = 'queue';

async function load(storage: QueueStorage, now: number): Promise<QueueState> {
  const state = (await storage.get<QueueState>(KEY)) ?? { seekers: [], matches: {} };
  const matches = Object.fromEntries(Object.entries(state.matches).filter(([, m]) => now - m.at < MATCH_KEEP_MS));
  return { seekers: state.seekers.filter((s) => now - s.seenAt < STALE_MS), matches };
}

const waiting = (state: QueueState, seeker: Seeker, now: number): QueueResponse =>
  ({ status: 200, body: { state: 'waiting', since: seeker.joinedAt, waiting: state.seekers.length - 1, now } });

/**
 * Matches `seeker` if anyone fits. The opponent leaves the queue before the
 * game is started, since other requests can arrive while it starts; if it
 * fails, both go back.
 */
async function tryMatch(storage: QueueStorage, deps: QueueDeps, state: QueueState, seeker: Seeker, now: number): Promise<QueueResponse> {
  const opponent = pickOpponent(seeker, state.seekers, now);
  if (!opponent) return waiting(state, seeker, now);
  const without = state.seekers.filter((s) => s.accountId !== opponent.accountId && s.accountId !== seeker.accountId);
  await storage.put(KEY, { ...state, seekers: without });
  let gameId: string;
  try {
    gameId = await deps.startGame(opponent, seeker, now);
  } catch {
    const current = await load(storage, now);
    await storage.put(KEY, { ...current, seekers: [...current.seekers, opponent, seeker] });
    return waiting(state, seeker, now);
  }
  const current = await load(storage, now);
  const at = { gameId, at: now };
  await storage.put(KEY, { ...current, matches: { ...current.matches, [opponent.accountId]: at, [seeker.accountId]: at } });
  return { status: 200, body: { state: 'matched', gameId } };
}

export async function handleQueue(storage: QueueStorage, deps: QueueDeps, request: QueueRequest, now: number): Promise<QueueResponse> {
  const state = await load(storage, now);
  const { accountId } = request;
  const others = state.seekers.filter((s) => s.accountId !== accountId);
  const { [accountId]: match, ...otherMatches } = state.matches;

  if (request.action === 'leave') {
    await storage.put(KEY, { seekers: others, matches: otherMatches });
    return { status: 200, body: { state: 'idle' } };
  }

  if (request.action === 'poll') {
    if (match) return { status: 200, body: { state: 'matched', gameId: match.gameId } };
    const seeker = state.seekers.find((s) => s.accountId === accountId);
    if (!seeker) {
      await storage.put(KEY, state);
      return { status: 200, body: { state: 'idle' } };
    }
    const seen = { ...seeker, seenAt: now };
    const next = { ...state, seekers: [...others, seen] };
    await storage.put(KEY, next);
    return tryMatch(storage, deps, next, seen, now);
  }

  // Joining again starts over: a new word, a new place in the queue.
  const secret = validateSecretWord(request.secret);
  if (!secret.ok) return { status: 400, body: { error: secret.error } };
  const seeker: Seeker = {
    accountId, name: request.name, secret: secret.word, rating: request.rating, joinedAt: now, seenAt: now,
  };
  const next = { seekers: [...others, seeker], matches: otherMatches };
  await storage.put(KEY, next);
  return tryMatch(storage, deps, next, seeker, now);
}
