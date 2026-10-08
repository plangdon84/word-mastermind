import {
  isObject, parseMarks, parseSoloRecord, replaySolo, toSoloRecord,
  type Marks, type SoloGame, type SoloMove, type SoloRecord,
} from '../game';
import { newId } from './ids';

/**
 * What survives a page reload: the solo game in progress, its letter marks and
 * the half-typed guess. Settings are saved separately (`settings.ts`).
 */
export interface Saved {
  /** The game's history ID, kept from the start so saving it twice can't duplicate it. */
  id: string;
  game: SoloGame;
  /** Medium's in/out marks. Kept while playing Hard, which just hides them. */
  marks: Marks;
  draft: string;
}

const KEY = 'word-mastermind:solo:v1';

/**
 * Saves from before moves were recorded held the game itself. Its guesses
 * become moves, stopping at a win, and a stored give-up becomes the last move.
 * Their times weren't recorded, so they read as 0.
 */
function legacyRecord(game: unknown): SoloRecord | null {
  if (!isObject(game) || !Array.isArray(game.guesses)) return null;
  const { secret, guesses, status } = game;
  if (typeof secret !== 'string') return null;
  const moves: SoloMove[] = [];
  for (const g of guesses) {
    const word = isObject(g) ? g.guess : undefined;
    if (typeof word !== 'string') return null;
    moves.push({ kind: 'guess', word, at: 0 });
    if (word === secret) return { secret, startedAt: 0, difficulty: 'medium', moves };
  }
  if (status === 'gave-up') moves.push({ kind: 'give-up', at: 0 });
  return { secret, startedAt: 0, difficulty: 'medium', moves };
}

/**
 * Reads saved state defensively. The moves are replayed through the game
 * logic, so scores and the result are recomputed rather than trusted, and
 * anything that doesn't replay cleanly is dropped.
 */
export function parseSaved(raw: string | null, makeId: () => string = newId): Saved | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  const { marks, draft } = data;
  const record = 'record' in data ? parseSoloRecord(data.record) : legacyRecord(data.game);
  if (!record) return null;
  const replayed = replaySolo(record);
  if (!replayed.ok) return null;
  return {
    // Saves from before game history had no ID.
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    game: replayed.game,
    marks: parseMarks(marks),
    draft: typeof draft === 'string' && /^[a-z]{0,5}$/.test(draft) ? draft : '',
  };
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadSaved(): Saved | null {
  try {
    return parseSaved(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Only the game's record is written; `parseSaved` replays it. */
export function serializeSaved({ id, game, marks, draft }: Saved): string {
  return JSON.stringify({ id, record: toSoloRecord(game), marks, draft });
}

/** Saves the game; returns what was written, or null if storage refused it. */
export function save(saved: Saved): string | null {
  try {
    const raw = serializeSaved(saved);
    localStorage.setItem(KEY, raw);
    return raw;
  } catch {
    // Storage is a convenience; the game works without it.
    return null;
  }
}

/**
 * The saved game, if it's changed since this page last wrote `written`: a
 * page that comes back (another tab's, or one restored by Back) may have
 * missed another tab's saves while it slept, and mustn't save its old game
 * over them (issue #163). Unchanged, or unreadable, gives null.
 */
export function savedSince(written: string | null): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw !== null && raw !== written ? parseSaved(raw) : null;
  } catch {
    return null;
  }
}

/** Forgets the saved game: a game cancelled before your first guess leaves nothing behind. */
export function clearSaved(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Calls `listener` when another tab saves the solo game (the same game played
 * in two tabs, or a new one started there), so this tab can follow it rather
 * than save over it. Returns the unsubscribe.
 */
export function onOtherTabSave(listener: (saved: Saved) => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    const saved = parseSaved(e.newValue);
    if (saved) listener(saved);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
