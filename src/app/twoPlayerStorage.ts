import {
  isObject, isStrength, parseMarks, parseTwoPlayerRecord, replayTwoPlayer, toTwoPlayerRecord,
  type Marks, type Side, type TwoPlayerGame, type TwoPlayerMove, type TwoPlayerRecord,
} from '../game';
import { newId } from './ids';

/** What survives a page reload in two player. Settings are saved separately. */
export interface TwoPlayerSaved {
  /** The game's history ID, kept from the start so saving it twice can't duplicate it. */
  id: string;
  game: TwoPlayerGame;
  /** Medium's in/out marks on your own guesses. */
  marks: Marks;
  draft: string;
}

const KEY = 'word-mastermind:two-player:v1';
const isSide = (value: unknown): value is Side => value === 'human' || value === 'computer';

const words = (value: unknown): string[] | null =>
  Array.isArray(value)
    ? value.map((g) => (g as { guess?: unknown } | null)?.guess).filter((w): w is string => typeof w === 'string')
    : null;

/**
 * Saves from before moves were recorded held each side's guesses separately.
 * They become moves in turn order, and a stored give-up becomes the last move.
 * Their times weren't recorded, so they read as 0.
 */
function legacyRecord(game: unknown): Omit<TwoPlayerRecord, 'strength'> | null {
  if (!isObject(game)) return null;
  const { humanSecret, computerSecret, first } = game;
  const humanWords = words(game.humanGuesses);
  const computerWords = words(game.computerGuesses);
  if (typeof humanSecret !== 'string' || typeof computerSecret !== 'string') return null;
  if (!isSide(first) || !humanWords || !computerWords) return null;

  const queues: Record<Side, string[]> = { human: humanWords, computer: computerWords };
  const moves: TwoPlayerMove[] = [];
  let next: Side = first;
  while (queues[next].length > 0) {
    moves.push({ side: next, kind: 'guess', word: queues[next].shift()!, at: 0 });
    next = next === 'human' ? 'computer' : 'human';
  }
  // Guesses left over can't have been played in turn.
  if (queues.human.length > 0 || queues.computer.length > 0) return null;
  if (game.status === 'gave-up') moves.push({ side: 'human', kind: 'concede', at: 0 });
  return { humanSecret, computerSecret, first, startedAt: 0, difficulty: 'medium', moves };
}

/**
 * Reads a saved game defensively. The moves are replayed through the game
 * logic, so scores, turns and the result are recomputed rather than trusted,
 * and anything that doesn't replay cleanly is dropped.
 */
export function parseTwoPlayerSaved(raw: string | null, makeId: () => string = newId): TwoPlayerSaved | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  const { marks, draft } = data;
  // Saves from before the record held the strength kept it beside the record.
  const strength = isStrength(data.strength) ? { strength: data.strength } : {};
  const stored = 'record' in data ? data.record : legacyRecord(data.game);
  const record = parseTwoPlayerRecord(isObject(stored) ? { ...strength, ...stored } : null);
  if (!record) return null;
  const replayed = replayTwoPlayer(record);
  if (!replayed.ok) return null;

  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    game: replayed.game,
    marks: parseMarks(marks),
    draft: typeof draft === 'string' && /^[a-z]{0,5}$/.test(draft) ? draft : '',
  };
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadTwoPlayer(): TwoPlayerSaved | null {
  try {
    return parseTwoPlayerSaved(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Only the game's record is written; `parseTwoPlayerSaved` replays it. */
export function serializeTwoPlayerSaved({ id, game, marks, draft }: TwoPlayerSaved): string {
  return JSON.stringify({ id, record: toTwoPlayerRecord(game), marks, draft });
}

export function saveTwoPlayer(saved: TwoPlayerSaved): void {
  try {
    localStorage.setItem(KEY, serializeTwoPlayerSaved(saved));
  } catch {
    // Storage is a convenience; the game works without it.
  }
}

/** Forgets the saved game, so an abandoned game can't be continued. */
export function clearTwoPlayer(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
