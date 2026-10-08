import type { Strength } from './computer';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import type { RunMove, RunRecord } from './run';
import type { SoloMove, SoloRecord } from './solo';
import type { Side, TwoPlayerMove, TwoPlayerRecord } from './twoPlayer';
import { parseMarks } from './marks';
import { CLOCK_MINUTES, TURN_DAYS, type ClockMinutes, type PvpMove, type PvpRecord, type Seat, type TurnDays } from './pvp';

/*
 * Reading game records back from anywhere they could have been changed or
 * corrupted: browser storage, a backup file, later a network request. Each
 * parser checks the shape only; replaying the record (`replaySolo` and so on)
 * checks the rules. Records saved before difficulty was recorded were played
 * at Medium.
 */

export const STRENGTHS: readonly Strength[] = ['casual', 'skilled', 'expert', 'mastermind'];

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** A whole number, zero or more: a count, or a rank. */
export const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
export const isDifficulty = (value: unknown): value is Difficulty => DIFFICULTIES.includes(value as Difficulty);
export const isStrength = (value: unknown): value is Strength => STRENGTHS.includes(value as Strength);
const isSide = (value: unknown): value is Side => value === 'human' || value === 'computer';

/** A missing difficulty is Medium, from before difficulty was recorded. */
const difficultyOf = (value: unknown): Difficulty | null =>
  value === undefined ? 'medium' : isDifficulty(value) ? value : null;

/** Parses each move with `parse`, or returns null if any is invalid. */
function parseList<T>(value: unknown, parse: (m: Record<string, unknown> & { at: number }) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const moves: T[] = [];
  for (const m of value) {
    if (!isObject(m) || !isTime(m.at)) return null;
    const move = parse(m as Record<string, unknown> & { at: number });
    if (move === null) return null;
    moves.push(move);
  }
  return moves;
}

export function parseSoloMoves(value: unknown): SoloMove[] | null {
  return parseList<SoloMove>(value, (m) => {
    if (m.kind === 'guess' && typeof m.word === 'string') return { kind: 'guess', word: m.word, at: m.at };
    if (m.kind === 'give-up') return { kind: 'give-up', at: m.at };
    if (m.kind === 'suggest' && typeof m.word === 'string') return { kind: 'suggest', word: m.word, at: m.at };
    if (m.kind === 'difficulty' && isDifficulty(m.difficulty)) {
      return { kind: 'difficulty', difficulty: m.difficulty, at: m.at };
    }
    return null;
  });
}

export function parseSoloRecord(value: unknown): SoloRecord | null {
  if (!isObject(value)) return null;
  const { secret, startedAt } = value;
  const difficulty = difficultyOf(value.difficulty);
  const moves = parseSoloMoves(value.moves);
  if (typeof secret !== 'string' || !isTime(startedAt) || !difficulty || !moves) return null;
  return { secret, startedAt, difficulty, moves };
}

export function parseTwoPlayerMoves(value: unknown): TwoPlayerMove[] | null {
  return parseList<TwoPlayerMove>(value, (m) => {
    if (m.kind === 'guess' && isSide(m.side) && typeof m.word === 'string') {
      return { side: m.side, kind: 'guess', word: m.word, at: m.at };
    }
    if (m.kind === 'concede' && m.side === 'human') return { side: 'human', kind: 'concede', at: m.at };
    if (m.kind === 'suggest' && m.side === 'human' && typeof m.word === 'string') {
      return { side: 'human', kind: 'suggest', word: m.word, at: m.at };
    }
    if (m.kind === 'difficulty' && m.side === 'human' && isDifficulty(m.difficulty)) {
      return { side: 'human', kind: 'difficulty', difficulty: m.difficulty, at: m.at };
    }
    return null;
  });
}

export function parseTwoPlayerRecord(value: unknown): TwoPlayerRecord | null {
  if (!isObject(value)) return null;
  const { humanSecret, computerSecret, first, startedAt, strength } = value;
  const difficulty = difficultyOf(value.difficulty);
  const moves = parseTwoPlayerMoves(value.moves);
  if (typeof humanSecret !== 'string' || typeof computerSecret !== 'string') return null;
  if (!isSide(first) || !isTime(startedAt) || !difficulty || !isStrength(strength) || !moves) return null;
  return { humanSecret, computerSecret, first, startedAt, difficulty, strength, moves };
}

export function parseRunMoves(value: unknown): RunMove[] | null {
  return parseList<RunMove>(value, (m) => {
    if (m.kind === 'guess' && typeof m.word === 'string') return { kind: 'guess', word: m.word, at: m.at };
    if (m.kind === 'suggest' && typeof m.word === 'string') return { kind: 'suggest', word: m.word, at: m.at };
    if (m.kind === 'give-up-word' || m.kind === 'end' || m.kind === 'pause' || m.kind === 'resume') {
      return { kind: m.kind, at: m.at };
    }
    if (m.kind === 'difficulty' && isDifficulty(m.difficulty)) {
      return { kind: 'difficulty', difficulty: m.difficulty, at: m.at };
    }
    return null;
  });
}

export function parseRunRecord(value: unknown): RunRecord | null {
  if (!isObject(value)) return null;
  const { words, startedAt, timeLimitMs, pausable } = value;
  const difficulty = difficultyOf(value.difficulty);
  const moves = parseRunMoves(value.moves);
  if (!Array.isArray(words) || !words.every((w) => typeof w === 'string')) return null;
  if (!isTime(startedAt) || !(timeLimitMs === null || isTime(timeLimitMs)) || !difficulty || !moves) return null;
  if (typeof pausable !== 'boolean' || (pausable && timeLimitMs !== null)) return null;
  // Left out for Crush, as in every run from before Rush and Crush.
  if (value.rankBy !== undefined && value.rankBy !== 'rush' && value.rankBy !== 'crush') return null;
  return { words, startedAt, timeLimitMs, pausable, difficulty, ...(value.rankBy === 'rush' ? { rankBy: 'rush' as const } : {}), moves };
}

export const isSeat = (value: unknown): value is Seat => value === 'host' || value === 'guest';

export function parsePvpMoves(value: unknown): PvpMove[] | null {
  return parseList<PvpMove>(value, (m) => {
    if (!isSeat(m.seat)) return null;
    if (m.kind === 'guess' && typeof m.word === 'string') {
      if (m.marks !== undefined && !isObject(m.marks)) return null;
      return { seat: m.seat, kind: 'guess', word: m.word, at: m.at, ...(m.marks ? { marks: parseMarks(m.marks) } : {}) };
    }
    if (m.kind === 'suggest' && typeof m.word === 'string') return { seat: m.seat, kind: 'suggest', word: m.word, at: m.at };
    if (m.kind === 'concede' || m.kind === 'timeout') return { seat: m.seat, kind: m.kind, at: m.at };
    if (m.kind === 'difficulty' && isDifficulty(m.difficulty)) {
      return { seat: m.seat, kind: 'difficulty', difficulty: m.difficulty, at: m.at };
    }
    return null;
  });
}

/** A game against a friend, as the server keeps it. */
export function parsePvpRecord(value: unknown): PvpRecord | null {
  if (!isObject(value)) return null;
  const { secrets, first, startedAt, turnDays, clockMinutes, difficulty, rated } = value;
  const moves = parsePvpMoves(value.moves);
  if (!isObject(secrets) || typeof secrets.host !== 'string' || typeof secrets.guest !== 'string') return null;
  if (!isObject(difficulty) || !isDifficulty(difficulty.host) || !isDifficulty(difficulty.guest)) return null;
  if (!isSeat(first) || !isTime(startedAt) || !moves || (rated !== undefined && rated !== true)) return null;
  const timing = clockMinutes !== undefined
    ? (CLOCK_MINUTES.includes(clockMinutes as ClockMinutes) && turnDays === undefined ? { clockMinutes: clockMinutes as ClockMinutes } : null)
    : turnDays === undefined || TURN_DAYS.includes(turnDays as TurnDays) ? (turnDays === undefined ? {} : { turnDays: turnDays as TurnDays }) : null;
  if (!timing) return null;
  return {
    secrets: { host: secrets.host, guest: secrets.guest }, first, startedAt, ...timing,
    difficulty: { host: difficulty.host, guest: difficulty.guest }, ...(rated ? { rated: true as const } : {}), moves,
  };
}
