import type { Strength } from './computer';
import { isDailyDay, type DailyDay } from './daily';
import type { Difficulty } from './difficulty';
import type { LobbyKind } from './lobby';
import { parseMarks, type Marks } from './marks';
import { otherSeat, replayPvp, type PvpGame, type PvpRecord, type Seat } from './pvp';
import {
  isCount, isDifficulty, isObject, isSeat, isStrength, isTime, parsePvpRecord, parseRunRecord, parseSoloRecord, parseTwoPlayerRecord,
} from './records';
import { replayRun, summarizeSoloRun, type RunGame, type RunRecord, type SoloRunSummary } from './run';
import { replaySolo, type SoloGame, type SoloRecord } from './solo';
import { isTwoPlayerOver, replayTwoPlayer, type TwoPlayerGame, type TwoPlayerRecord } from './twoPlayer';
import { normalizeWord } from './words';

/*
 * Game history (README "Game history"): every finished game is kept as its
 * record, plus what the record can't rebuild: an ID, the mode, a version
 * number and Medium's final letter marks. Everything shown about a past game
 * is worked out by replaying it, never stored.
 */

export type HistoryMode = 'single' | 'computer' | 'rush' | 'friend' | 'daily' | 'lobby';

export const HISTORY_MODES: readonly HistoryMode[] = ['single', 'computer', 'rush', 'friend', 'daily', 'lobby'];

/**
 * Games the server refereed: against a friend, Daily Rush and Rush with
 * Friends (or Competitive Rush). The server keeps them and hands each player
 * their own side (`worker/src/played.ts`), so they're never uploaded by sync.
 */
export const SERVER_MODES: readonly HistoryMode[] = ['friend', 'daily', 'lobby'];

export const isServerMode = (mode: HistoryMode) => SERVER_MODES.includes(mode);

/** A rated game's rating for you, before and after it, as shown (rounded). */
export interface RatingChange {
  before: number;
  after: number;
}

/**
 * One player's final place in a Rush with Friends or Competitive Rush, as the
 * server worked it out. The others' runs aren't kept (their guesses are
 * theirs), so the places are, as Daily Rush's are.
 */
export interface LobbyPlace {
  name: string;
  /** A computer player's strength; null for a person. */
  strength: Strength | null;
  you: boolean;
  /** 1 for the best; tied players share one. Null if they never finished. */
  rank: number | null;
  score: number | null;
  seconds: number | null;
}

/** Bumped when an entry's shape changes, so older entries can be read differently. */
export const HISTORY_VERSION = 1;

interface EntryBase {
  /** Random, so syncing history between devices (README "Synced profile") can't duplicate a game. */
  id: string;
  version: number;
}

export type HistoryEntry =
  | EntryBase & { mode: 'single'; record: SoloRecord; marks: Marks }
  | EntryBase & { mode: 'computer'; record: TwoPlayerRecord; marks: Marks }
  /** One set of marks per word, in order. */
  | EntryBase & { mode: 'rush'; record: RunRecord; marks: readonly Marks[] }
  /** Against a friend: the whole game (it's over, so both words are known), your seat and their name. */
  | EntryBase & { mode: 'friend'; record: PvpRecord; seat: Seat; opponent: string; rating: RatingChange | null; marks: Marks }
  /** A Daily Rush: your run on that day's set. */
  | EntryBase & { mode: 'daily'; day: DailyDay; record: RunRecord; marks: readonly Marks[] }
  /** Rush with Friends or Competitive Rush: your run, and everyone's final places. */
  | EntryBase & {
    mode: 'lobby'; kind: LobbyKind; record: RunRecord; places: readonly LobbyPlace[]; rating: RatingChange | null;
    marks: readonly Marks[];
  };

export type ReplayedGame =
  | { mode: 'single'; game: SoloGame }
  | { mode: 'computer'; game: TwoPlayerGame }
  | { mode: 'rush'; game: RunGame }
  | { mode: 'friend'; game: PvpGame; seat: Seat; opponent: string; rating: RatingChange | null }
  | { mode: 'daily'; game: RunGame; day: DailyDay }
  | { mode: 'lobby'; game: RunGame; kind: LobbyKind; places: readonly LobbyPlace[]; rating: RatingChange | null };

/** A finished game rebuilt from its entry, or null if it doesn't replay or isn't over. */
export function replayEntry(entry: HistoryEntry): ReplayedGame | null {
  switch (entry.mode) {
    case 'single': {
      const result = replaySolo(entry.record);
      return result.ok && result.game.status !== 'playing' ? { mode: 'single', game: result.game } : null;
    }
    case 'computer': {
      const result = replayTwoPlayer(entry.record);
      return result.ok && isTwoPlayerOver(result.game) ? { mode: 'computer', game: result.game } : null;
    }
    case 'rush': {
      const result = replayRun(entry.record);
      return result.ok && result.game.status === 'over' ? { mode: 'rush', game: result.game } : null;
    }
    case 'friend': {
      const result = replayPvp(entry.record);
      if (!result.ok || result.game.status !== 'over') return null;
      return { mode: 'friend', game: result.game, seat: entry.seat, opponent: entry.opponent, rating: entry.rating };
    }
    case 'daily': {
      const result = replayRun(entry.record);
      return result.ok && result.game.status === 'over' ? { mode: 'daily', game: result.game, day: entry.day } : null;
    }
    case 'lobby': {
      const result = replayRun(entry.record);
      if (!result.ok || result.game.status !== 'over') return null;
      return { mode: 'lobby', game: result.game, kind: entry.kind, places: entry.places, rating: entry.rating };
    }
  }
}

const isName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;
const orNull = <T>(value: unknown, check: (v: unknown) => v is T): T | null | undefined =>
  value === null ? null : check(value) ? value : undefined;

function parseRatingChange(value: unknown): RatingChange | null | undefined {
  if (value === undefined || value === null) return null;
  return isObject(value) && isCount(value.before) && isCount(value.after) ? { before: value.before, after: value.after } : undefined;
}

function parsePlaces(value: unknown): LobbyPlace[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  const places: LobbyPlace[] = [];
  for (const p of value) {
    if (!isObject(p) || !isName(p.name) || typeof p.you !== 'boolean') return null;
    const strength = orNull(p.strength, isStrength);
    const rank = orNull(p.rank, (v): v is number => isCount(v) && (v as number) >= 1);
    const score = orNull(p.score, isTime);
    const seconds = orNull(p.seconds, isTime);
    if (strength === undefined || rank === undefined || score === undefined || seconds === undefined) return null;
    places.push({ name: p.name, strength, you: p.you, rank, score, seconds });
  }
  return places.filter((p) => p.you).length === 1 ? places : null;
}

const runMarks = (record: RunRecord, value: unknown) => {
  const marks = Array.isArray(value) ? value : [];
  return record.words.map((_, i) => parseMarks(marks[i]));
};

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 64;

/**
 * Reads an entry defensively, from storage or a backup file. The record must
 * replay to a finished game; marks that don't parse are dropped.
 */
export function parseHistoryEntry(value: unknown): HistoryEntry | null {
  if (!isObject(value) || !isId(value.id)) return null;
  const { id, version, mode } = value;
  if (!Number.isInteger(version) || (version as number) < 1 || (version as number) > HISTORY_VERSION) return null;
  const base = { id, version: version as number };
  let entry: HistoryEntry | null = null;
  if (mode === 'single') {
    const record = parseSoloRecord(value.record);
    if (record) entry = { ...base, mode, record, marks: parseMarks(value.marks) };
  } else if (mode === 'computer') {
    const record = parseTwoPlayerRecord(value.record);
    if (record) entry = { ...base, mode, record, marks: parseMarks(value.marks) };
  } else if (mode === 'rush') {
    const record = parseRunRecord(value.record);
    if (record) entry = { ...base, mode, record, marks: runMarks(record, value.marks) };
  } else if (mode === 'friend') {
    const record = parsePvpRecord(value.record);
    const rating = parseRatingChange(value.rating);
    if (record && isSeat(value.seat) && isName(value.opponent) && rating !== undefined) {
      entry = { ...base, mode, record, seat: value.seat, opponent: value.opponent, rating, marks: parseMarks(value.marks) };
    }
  } else if (mode === 'daily') {
    const record = parseRunRecord(value.record);
    if (record && isDailyDay(value.day)) entry = { ...base, mode, day: value.day, record, marks: runMarks(record, value.marks) };
  } else if (mode === 'lobby') {
    const record = parseRunRecord(value.record);
    const places = parsePlaces(value.places);
    const rating = parseRatingChange(value.rating);
    const kind = value.kind === 'competitive' ? 'competitive' : value.kind === 'friends' ? 'friends' : null;
    if (record && places && kind && rating !== undefined) {
      entry = { ...base, mode, kind, record, places, rating, marks: runMarks(record, value.marks) };
    }
  }
  return entry && replayEntry(entry) ? entry : null;
}

/** A game's result from your side. A Rush has none: it's scored instead. */
export type HistoryResult = 'won' | 'lost' | 'drawn';

/** What a history row shows and filters on, worked out from the replayed game. */
export interface GameSummary {
  mode: HistoryMode;
  /** Who you played: a friend's name; null otherwise. */
  opponent: string | null;
  /** Rush with Friends and Competitive Rush: your final place, and how many played. Null otherwise. */
  place: { rank: number | null; of: number } | null;
  /** A rated game's rating for you, before and after. */
  rating: RatingChange | null;
  /** Single player: solving it is a win and giving up a loss. Null for a Rush. */
  result: HistoryResult | null;
  /** You gave up (the game, or a whole Rush). */
  gaveUp: boolean;
  /** The easiest difficulty used, which the game counts at. */
  difficulty: Difficulty;
  /** vs. Computer only. */
  strength: Strength | null;
  /** Your guesses; in a Rush, across every word. */
  yourGuesses: number;
  /** The computer's guesses, vs. Computer only. */
  opponentGuesses: number | null;
  /** When the last move was made. */
  endedAt: number;
  /** Every secret word and guess, for search. */
  words: ReadonlySet<string>;
  /** A Rush's score and level, or null if it has none (given up, or no word found). */
  rush: SoloRunSummary | null;
}

const lastMoveAt = (startedAt: number, moves: readonly { at: number }[]) =>
  moves.length > 0 ? moves[moves.length - 1].at : startedAt;

export function summarizeGame(replayed: ReplayedGame): GameSummary {
  switch (replayed.mode) {
    case 'single': {
      const { game } = replayed;
      return {
        mode: 'single',
        result: game.status === 'won' ? 'won' : 'lost',
        gaveUp: game.status === 'gave-up',
        difficulty: game.scoredDifficulty,
        strength: null,
        yourGuesses: game.guesses.length,
        opponentGuesses: null,
        endedAt: lastMoveAt(game.startedAt, game.moves),
        words: new Set([game.secret, ...game.guesses.map((g) => g.guess)]),
        rush: null,
        opponent: null,
        place: null,
        rating: null,
      };
    }
    case 'computer': {
      const { game } = replayed;
      const result: HistoryResult = game.status === 'human-won' ? 'won' : game.status === 'draw' ? 'drawn' : 'lost';
      return {
        mode: 'computer',
        result,
        gaveUp: game.status === 'gave-up',
        difficulty: game.scoredDifficulty,
        strength: game.strength,
        yourGuesses: game.humanGuesses.length,
        opponentGuesses: game.computerGuesses.length,
        endedAt: lastMoveAt(game.startedAt, game.moves),
        words: new Set([
          game.humanSecret, game.computerSecret,
          ...game.humanGuesses.map((g) => g.guess), ...game.computerGuesses.map((g) => g.guess),
        ]),
        rush: null,
        opponent: null,
        place: null,
        rating: null,
      };
    }
    case 'rush': {
      const { game } = replayed;
      const guesses = game.results.flatMap((r) => r.guesses);
      return {
        mode: 'rush',
        result: null,
        gaveUp: game.results.some((r) => r.outcome === 'unsolved'),
        difficulty: game.scoredDifficulty,
        strength: null,
        yourGuesses: guesses.length,
        opponentGuesses: null,
        endedAt: lastMoveAt(game.startedAt, game.moves),
        words: new Set([...game.words, ...guesses.map((g) => g.guess)]),
        rush: summarizeSoloRun(game),
        opponent: null,
        place: null,
        rating: null,
      };
    }
    case 'friend': {
      const { game, seat, opponent, rating } = replayed;
      const other = otherSeat(seat);
      const winner = game.outcome?.winner ?? null;
      return {
        mode: 'friend',
        result: winner === null ? 'drawn' : winner === seat ? 'won' : 'lost',
        gaveUp: game.outcome?.reason === 'conceded' && winner === other,
        difficulty: game.scoredDifficulty[seat],
        strength: null,
        yourGuesses: game.guesses[seat].length,
        opponentGuesses: game.guesses[other].length,
        endedAt: lastMoveAt(game.startedAt, game.moves),
        words: new Set([
          game.secrets.host, game.secrets.guest,
          ...game.guesses.host.map((g) => g.guess), ...game.guesses.guest.map((g) => g.guess),
        ]),
        rush: null,
        opponent,
        place: null,
        rating,
      };
    }
    case 'daily':
    case 'lobby': {
      const { game } = replayed;
      const guesses = game.results.flatMap((r) => r.guesses);
      const you = replayed.mode === 'lobby' ? replayed.places.find((p) => p.you) : undefined;
      return {
        mode: replayed.mode,
        result: null,
        gaveUp: game.results.some((r) => r.outcome === 'unsolved'),
        difficulty: game.scoredDifficulty,
        strength: null,
        yourGuesses: guesses.length,
        opponentGuesses: null,
        endedAt: lastMoveAt(game.startedAt, game.moves),
        words: new Set([...game.words, ...guesses.map((g) => g.guess)]),
        rush: null,
        opponent: null,
        place: replayed.mode === 'lobby' ? { rank: you?.rank ?? null, of: replayed.places.length } : null,
        rating: replayed.mode === 'lobby' ? replayed.rating : null,
      };
    }
  }
}

/** The history list's filters; a missing field matches everything. */
export interface HistoryFilter {
  mode?: HistoryMode;
  result?: HistoryResult;
  difficulty?: Difficulty;
  /** Matches any secret word or guess that starts with it, ignoring case. */
  search?: string;
}

export function matchesFilter(summary: GameSummary, filter: HistoryFilter): boolean {
  if (filter.mode && summary.mode !== filter.mode) return false;
  if (filter.result && summary.result !== filter.result) return false;
  if (filter.difficulty && isDifficulty(filter.difficulty) && summary.difficulty !== filter.difficulty) return false;
  const search = normalizeWord(filter.search ?? '');
  if (search && ![...summary.words].some((w) => w.startsWith(search))) return false;
  return true;
}
