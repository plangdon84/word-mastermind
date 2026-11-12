import type { RoomStorage } from './room';

/*
 * One way for a referee (a game room, a day's daily games, a lobby) to save
 * a finished game to D1 (Dev Plan item 19zo): mark it finished in its own
 * storage, save it, clear the mark, and if the save fails, keep the mark and
 * try again later. The failure never fails the request, or the game couldn't
 * even be opened while D1 is down. Every save is safe to repeat: D1 ignores
 * a game it has, and a game is rated once (`batchRated`), so what follows a
 * save (the ratings shown, notifications) happens once, after the save that
 * worked.
 */

/** How long after a failed save to D1 a referee with an alarm tries again. */
export const SAVE_RETRY_MS = 60 * 1000;

/** How a referee saves one finished game. `S` is what its storage keeps; `R` is what the save gives back. */
export interface FinishedSave<S, R> {
  /** The storage key the finished game is kept under. */
  key: string;
  /** Saves it to D1. Throws if D1 fails; asked again, it gives back the same result. */
  save(): Promise<R>;
  /** What to store once it's saved: the mark cleared, with anything the save gave back (ratings). */
  cleared(marked: S, result: R): S;
  /**
   * When the referee's alarm should try again after a failure, or null for a
   * referee without one (the day's daily games), which tries on the next request.
   */
  retryAt: number | null;
  /** Runs once, after the save worked and the cleared game is stored: the alarm deleted, everyone told. */
  afterSave?(saved: S, result: R): Promise<void> | void;
}

/** What came of a save: what's stored now, and whether it's in D1. */
export interface SaveOutcome<S> {
  value: S;
  saved: boolean;
}

/**
 * Stores a game that has just finished, already marked (`unsaved`), so any
 * request that comes in while it's saved finds it over, then saves it
 * (`saveMarked`).
 */
export async function markFinished<S, R>(storage: RoomStorage, marked: S, how: FinishedSave<S, R>): Promise<SaveOutcome<S>> {
  await storage.put(how.key, marked);
  return saveMarked(storage, marked, how);
}

/**
 * Saves a finished game that's marked as not in D1 yet, and clears the mark.
 * If the save fails, the game stays as it is, marked, and the referee's
 * alarm (if it has one) is set to try again.
 */
export async function saveMarked<S, R>(storage: RoomStorage, marked: S, how: FinishedSave<S, R>): Promise<SaveOutcome<S>> {
  let result: R;
  try {
    result = await how.save();
  } catch {
    if (how.retryAt !== null) await storage.setAlarm(how.retryAt);
    return { value: marked, saved: false };
  }
  const saved = how.cleared(marked, result);
  await storage.put(how.key, saved);
  await how.afterSave?.(saved, result);
  return { value: saved, saved: true };
}
