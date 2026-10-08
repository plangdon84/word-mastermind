import {
  isObject, parseMarks, parseRunRecord, replayRun, toRunRecord, type Marks, type RunGame,
} from '../game';
import { newId } from './ids';

/** What survives a page reload in Rush. Settings are saved separately. */
export interface RushSaved {
  /** The run's history ID, kept from the start so saving it twice can't duplicate it. */
  id: string;
  run: RunGame;
  /** Medium's in/out marks, one set per word, kept so a finished Rush can be reviewed. */
  marks: readonly Marks[];
  draft: string;
}

const KEY = 'word-mastermind:rush:v1';

/**
 * Reads a saved run defensively. The moves are replayed through the game
 * logic, so every result is recomputed rather than trusted, and anything that
 * doesn't replay cleanly is dropped.
 */
export function parseRushSaved(raw: string | null, makeId: () => string = newId): RushSaved | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(data)) return null;
  const record = parseRunRecord(data.record);
  if (!record) return null;
  const replayed = replayRun(record);
  if (!replayed.ok) return null;
  const run = replayed.game;
  // Saves from before marks were kept per word held only the current word's.
  const stored = Array.isArray(data.marks) ? data.marks : run.words.map((_, i) => (i === run.current ? data.marks : {}));
  const { draft } = data;
  return {
    id: typeof data.id === 'string' && data.id ? data.id : makeId(),
    run,
    marks: run.words.map((_, i) => parseMarks(stored[i])),
    draft: typeof draft === 'string' && /^[a-z]{0,5}$/.test(draft) ? draft : '',
  };
}

/** Only the run's record is written; `parseRushSaved` replays it. */
export function serializeRushSaved({ id, run, marks, draft }: RushSaved): string {
  return JSON.stringify({ id, record: toRunRecord(run), marks, draft });
}

/** Browser storage can be missing or blocked (private windows), so failures are ignored. */
export function loadRush(): RushSaved | null {
  try {
    return parseRushSaved(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveRush(saved: RushSaved): void {
  try {
    localStorage.setItem(KEY, serializeRushSaved(saved));
  } catch {
    // Storage is a convenience; the game works without it.
  }
}
