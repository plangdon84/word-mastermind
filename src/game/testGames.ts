import type { Strength } from './computer';
import type { Difficulty } from './difficulty';
import { replayEntry, type HistoryEntry, type LobbyPlace, type RatingChange } from './history';
import type { DailyDay } from './daily';
import type { LobbyKind } from './lobby';
import { otherSeat, type PvpMove, type Seat } from './pvp';
import type { RunMove } from './run';
import type { SoloMove } from './solo';
import type { Side, TwoPlayerMove } from './twoPlayer';
import type { StatsGame } from './stats';

/*
 * Finished games for the stats and achievements tests, built from moves and
 * replayed as the app does. Only imported by tests.
 */

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
/** Moves are this far apart unless a test says otherwise. */
const STEP = 10_000;

function replayed(entry: HistoryEntry): StatsGame {
  const game = replayEntry(entry);
  if (!game) throw new Error(`${entry.id} does not replay to a finished game`);
  return { id: entry.id, replayed: game };
}

interface SoloOptions {
  secret?: string; difficulty?: Difficulty; gaveUp?: boolean; step?: number;
  /** Take Easy's Suggest before the first guess (needs `difficulty: 'easy'`). */
  suggest?: boolean;
}

/** A single-player game's history entry: the guesses, ending with the secret unless it was given up. */
export function soloEntry(id: string, start: number, guesses: readonly string[], options: SoloOptions = {}): HistoryEntry {
  const { secret = 'beach', difficulty = 'medium', gaveUp = false, step = STEP, suggest = false } = options;
  const moves: SoloMove[] = guesses.map((word, i) => ({ kind: 'guess', word, at: start + (i + 1) * step }));
  if (suggest) moves.unshift({ kind: 'suggest', word: secret, at: start + 1 });
  if (gaveUp) moves.push({ kind: 'give-up', at: start + (guesses.length + 1) * step });
  return { id, version: 1, mode: 'single', marks: {}, record: { secret, startedAt: start, difficulty, moves } };
}

export const solo = (id: string, start: number, guesses: readonly string[], options: SoloOptions = {}) =>
  replayed(soloEntry(id, start, guesses, options));

/**
 * A game vs. the computer. The two lists of guesses are interleaved, first
 * player first. `concede` adds your concession after them. Each of your
 * moves comes 10 seconds after the move before it; each of the computer's,
 * `theirTurn` milliseconds after (10 seconds unless set). `suggest` takes
 * Easy's Suggest before any guess.
 */
export function versus(id: string, start: number, options: {
  first?: Side; you: readonly string[]; computer: readonly string[];
  strength?: Strength; difficulty?: Difficulty; concede?: boolean;
  humanSecret?: string; computerSecret?: string; theirTurn?: number; suggest?: boolean;
}): StatsGame {
  const {
    first = 'human', you, computer, strength = 'skilled', difficulty = 'medium', concede = false,
    humanSecret = 'storm', computerSecret = 'beach', theirTurn = STEP, suggest = false,
  } = options;
  const [a, b] = first === 'human' ? [you, computer] : [computer, you];
  const second: Side = first === 'human' ? 'computer' : 'human';
  const moves: TwoPlayerMove[] = suggest ? [{ side: 'human', kind: 'suggest', word: computerSecret, at: start }] : [];
  let at = start;
  const after = (side: Side) => (at += side === 'human' ? STEP : theirTurn);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) moves.push({ side: first, kind: 'guess', word: a[i], at: after(first) });
    if (i < b.length) moves.push({ side: second, kind: 'guess', word: b[i], at: after(second) });
  }
  if (concede) moves.push({ side: 'human', kind: 'concede', at: after('human') });
  return replayed({
    id, version: 1, mode: 'computer', marks: {},
    record: { humanSecret, computerSecret, first, startedAt: start, difficulty, strength, moves },
  });
}

/**
 * A game against a friend from `seat`'s side: the two lists of guesses
 * interleaved, first player first, 10 seconds apart. `concede` adds your
 * concession after them; `suggest` takes Easy's Suggest before any guess.
 */
export function friendEntry(id: string, start: number, options: {
  seat?: Seat; first?: 'you' | 'them'; you: readonly string[]; them: readonly string[];
  yourSecret?: string; theirSecret?: string; difficulty?: Difficulty; opponent?: string;
  rating?: RatingChange | null; suggest?: boolean;
  /** You give up after the guesses (`true`), or they do (`'them'`). */
  concede?: boolean | 'them';
  /** The player to move runs out of time after the guesses (a day a guess). */
  timeOut?: boolean;
  /** Their difficulty, if not yours; and a level you switch to after the first guesses. */
  theirDifficulty?: Difficulty; yourSwitch?: Difficulty;
}): HistoryEntry {
  const {
    seat = 'host', first = 'you', you, them, yourSecret = 'storm', theirSecret = 'beach', difficulty = 'medium',
    concede = false, opponent = 'Bob', rating = null, suggest = false, theirDifficulty = difficulty, yourSwitch, timeOut = false,
  } = options;
  const other = otherSeat(seat);
  const firstSeat = first === 'you' ? seat : other;
  const [a, b] = first === 'you' ? [you, them] : [them, you];
  const moves: PvpMove[] = suggest ? [{ seat, kind: 'suggest', word: theirSecret, at: start }] : [];
  let at = start;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) moves.push({ seat: firstSeat, kind: 'guess', word: a[i], at: (at += STEP) });
    if (i < b.length) moves.push({ seat: otherSeat(firstSeat), kind: 'guess', word: b[i], at: (at += STEP) });
    if (i === 0 && yourSwitch) moves.push({ seat, kind: 'difficulty', difficulty: yourSwitch, at: (at += STEP) });
  }
  if (concede) moves.push({ seat: concede === 'them' ? other : seat, kind: 'concede', at: (at += STEP) });
  if (timeOut) {
    // Whoever's turn it is: the next to guess, after the last guess.
    const last = moves.filter((m) => m.kind === 'guess').at(-1);
    const turn = last ? otherSeat(last.seat) : firstSeat;
    moves.push({ seat: turn, kind: 'timeout', at: at + 2 * DAY });
  }
  const secrets = { [seat]: yourSecret, [other]: theirSecret } as Record<Seat, string>;
  return {
    id, version: 1, mode: 'friend', seat, opponent, rating, marks: {},
    record: { secrets, first: firstSeat, startedAt: start, turnDays: 1, difficulty: { [seat]: difficulty, [other]: theirDifficulty } as Record<Seat, Difficulty>, moves },
  };
}

export const friend = (id: string, start: number, options: Parameters<typeof friendEntry>[2]) =>
  replayed(friendEntry(id, start, options));

/**
 * Moves for a run: each word's guesses, or 'give-up' to give that word up. A
 * guess starting with `?` is Easy's Suggest offering that word instead.
 * `end` ends the run after them, at `endAt` if given.
 */
function runMoves(
  start: number, words: readonly (readonly string[] | 'give-up')[], step: number, end: boolean, endAt?: number,
): RunMove[] {
  const moves: RunMove[] = [];
  let at = start;
  for (const word of words) {
    if (word === 'give-up') moves.push({ kind: 'give-up-word', at: (at += step) });
    else {
      for (const w of word) {
        moves.push(w.startsWith('?') ? { kind: 'suggest', word: w.slice(1), at: (at += step) } : { kind: 'guess', word: w, at: (at += step) });
      }
    }
  }
  if (end) moves.push({ kind: 'end', at: endAt ?? (at += step) });
  return moves;
}

/** A finished Daily Rush on `day`: each word's guesses, ending with the word. */
export function dailyEntry(id: string, day: DailyDay, start: number, words: readonly (readonly string[])[], options: {
  secrets?: readonly string[]; difficulty?: Difficulty;
} = {}): HistoryEntry {
  const { secrets = ['beach', 'crane', 'storm', 'house'], difficulty = 'medium' } = options;
  return {
    id, version: 1, mode: 'daily', day, marks: secrets.map(() => ({})),
    record: { words: secrets, startedAt: start, timeLimitMs: null, pausable: false, difficulty, moves: runMoves(start, words, STEP, false) },
  };
}

export const daily = (id: string, day: DailyDay, start: number, words: readonly (readonly string[])[], options = {}) =>
  replayed(dailyEntry(id, day, start, words, options));

/**
 * A lobby's game from your seat: your run, and your place (`rank`) among `of`
 * players. `end` gives the run up after the words; 'time-up' ends it when the
 * 30 minutes run out.
 */
export function lobbyEntry(id: string, start: number, words: readonly (readonly string[] | 'give-up')[], options: {
  rank: number | null; of?: number; kind?: LobbyKind; secrets?: readonly string[]; difficulty?: Difficulty;
  end?: boolean | 'time-up';
}): HistoryEntry {
  const { rank, of = 3, kind = 'friends', secrets = ['beach', 'crane', 'storm', 'house'], difficulty = 'medium', end = false } = options;
  const places: LobbyPlace[] = Array.from({ length: of }, (_, i) => ({
    name: i === 0 ? 'You' : `Player ${i + 1}`, strength: null, you: i === 0,
    rank: i === 0 ? rank : i + 1, score: 5 + i, seconds: 60 + i,
  }));
  return {
    id, version: 1, mode: 'lobby', kind, places, rating: null, marks: secrets.map(() => ({})),
    record: {
      words: secrets, startedAt: start, timeLimitMs: 30 * MINUTE, pausable: false, difficulty,
      moves: runMoves(start, words, STEP, end !== false, end === 'time-up' ? start + 30 * MINUTE : undefined),
    },
  };
}

export const lobby = (id: string, start: number, words: readonly (readonly string[] | 'give-up')[], options: Parameters<typeof lobbyEntry>[3]) =>
  replayed(lobbyEntry(id, start, words, options));

/** A Rush: each word's guesses, or 'give-up' to give that word up. `end` ends the run after them. */
export function rush(id: string, start: number, words: readonly (readonly string[] | 'give-up')[], options: {
  secrets?: readonly string[]; difficulty?: Difficulty; end?: boolean; step?: number; rankBy?: 'rush';
} = {}): StatsGame {
  const { secrets = ['beach', 'crane', 'storm', 'house'], difficulty = 'medium', end = false, step = STEP, rankBy } = options;
  const moves = runMoves(start, words, step, end);
  return replayed({
    id, version: 1, mode: 'rush', marks: secrets.map(() => ({})),
    record: { words: secrets, startedAt: start, timeLimitMs: null, pausable: true, difficulty, ...(rankBy ? { rankBy } : {}), moves },
  });
}
