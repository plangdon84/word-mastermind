import type { Strength } from './computer';
import { DIFFICULTIES, DIFFICULTY_FACTOR, type Difficulty } from './difficulty';
import { STRENGTHS } from './records';
import { summarizeGame, type GameSummary, type HistoryMode, type ReplayedGame } from './history';
import { runElapsedMs, runRankBy, wordSeconds } from './run';
import { otherSeat, type PvpGame, type Seat } from './pvp';
import type { TwoPlayerGame } from './twoPlayer';

/*
 * Analytics (README "Analytics"): worked out from the saved games every time,
 * never kept as counters. Only finished games are passed in, and each counts at
 * the easiest difficulty used.
 */

/** A finished game from the history, rebuilt from its record. */
export interface StatsGame {
  id: string;
  replayed: ReplayedGame;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Trends compare this many days with the same number before them. */
export const TREND_DAYS = 30;
/** A trend is hidden with fewer games than this in either period. */
export const TREND_MIN_GAMES = 5;
/** How many of your most used guesses are listed; a tie for the last place is cut alphabetically. */
export const TOP_GUESSES = 10;
/**
 * Time played counts at most this long between two moves, so a game left open
 * (or saved and picked up days later) doesn't count the time away.
 */
export const IDLE_CAP_MS = 5 * 60 * 1000;

/** How a number moved: the last 30 days against the 30 before. */
export interface Trend {
  current: number;
  previous: number;
  /** `current - previous`. For win %, in percentage points. */
  change: number;
}

export interface WinRecord {
  wins: number;
  draws: number;
  losses: number;
  /** 0–100, or null with no games. */
  winPct: number | null;
}

/** A game worth pointing at: its ID, and the number that makes it stand out. */
export interface GameRef {
  id: string;
  value: number;
}

export interface ModeStats {
  mode: HistoryMode;
  played: number;
  gaveUp: number;
  /**
   * Guesses to find a word, on average; null if none was found. Single player
   * leaves out games given up; vs. Computer counts the games where you found
   * the word; Rush counts every word of a scored Rush, penalties included.
   */
  averageGuesses: number | null;
  averageTrend: Trend | null;
  /**
   * Single player: fewest guesses × the difficulty factor. vs. Computer: the
   * win in fewest guesses. A Word Set: the lowest Crush score (Solo, or your
   * score in a lobby). The earliest wins a tie.
   */
  best: GameRef | null;
  /**
   * Word Sets ranked by time (Dev Plan item 18z): Solo, the lowest Rush score
   * (seconds a word × the difficulty factor); a lobby, your lowest total
   * time. Null for the other modes, or before a scored Rush.
   */
  bestRush: GameRef | null;
  /**
   * The shortest time, in seconds, from starting on a word to finding it.
   * Against an opponent, only your own turns count.
   */
  fastest: GameRef | null;
  /** Modes with an opponent only. A game given up is a loss. */
  record: (WinRecord & {
    winPctTrend: Trend | null;
    currentStreak: number;
    bestStreak: number;
    /** vs. Computer only. */
    byStrength: Record<Strength, WinRecord> | null;
  }) | null;
  /** Rush with Friends and Competitive Rush: how often you finished first. */
  firsts: number | null;
}

export interface Stats {
  played: number;
  /** Win % over games with an opponent (the computer or a friend); null with none. */
  winPct: number | null;
  /** Every guess you made, in every mode. */
  totalGuesses: number;
  modes: Record<HistoryMode, ModeStats>;
  byDifficulty: Record<Difficulty, number>;
  /** Your most used guesses, most first, then alphabetical; at most `TOP_GUESSES`. */
  topGuesses: { word: string; count: number }[];
  /**
   * Time from each game's start to its last move; a Rush leaves out its
   * pauses, and against an opponent only your own turns count. In single
   * player and against an opponent, no gap between moves counts for more
   * than `IDLE_CAP_MS`.
   */
  secondsPlayed: number;
}

/** One game, reduced to what the stats need, in the order games ended. */
interface Row {
  id: string;
  summary: GameSummary;
  replayed: ReplayedGame;
  /** Guesses to find each word found, penalties included in a Rush. */
  found: number[];
  seconds: number;
}

const average = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const winPct = (wins: number, games: number) => (games === 0 ? null : (wins / games) * 100);

/** Guesses to find each word, as the average counts them. */
function wordsFound(replayed: ReplayedGame, summary: GameSummary): number[] {
  switch (replayed.mode) {
    case 'single':
      return replayed.game.status === 'won' ? [replayed.game.guesses.length] : [];
    case 'computer':
    case 'friend':
      return summary.result === 'won' || summary.result === 'drawn' ? [summary.yourGuesses] : [];
    case 'rush':
      return summary.rush ? summary.rush.words.map((w) => w.guesses) : [];
    case 'daily':
    case 'lobby':
      // Scored with the group's penalties on the server; here, the words you found.
      return replayed.game.results.filter((r) => r.outcome === 'solved').map((r) => r.guesses.length);
  }
}

/** Against an opponent, whose moves are yours: vs. the computer, the human's; vs. a friend, your seat's. */
type TurnGame = { game: TwoPlayerGame; you: 'human' } | { game: PvpGame; you: Seat };

/**
 * Against an opponent, your time on each of your moves: from the move before
 * it (the opponent's, or the start) to yours. Time the opponent spends on
 * their turn isn't yours, so a game played over days doesn't count them all.
 */
function yourTurnTimes({ game, you }: TurnGame): { ms: number; word: string | null }[] {
  let previous = game.startedAt;
  const times: { ms: number; word: string | null }[] = [];
  for (const move of game.moves as readonly { at: number; kind: string; word?: string; side?: string; seat?: string }[]) {
    // Neither ends a turn, and either can come on the opponent's turn.
    if (move.kind === 'suggest' || move.kind === 'difficulty') continue;
    // A timeout is the clock running out, not a move you made.
    if ((move.side ?? move.seat) === you && move.kind !== 'timeout') {
      times.push({ ms: Math.max(0, move.at - previous), word: move.kind === 'guess' ? move.word ?? null : null });
    }
    previous = move.at;
  }
  return times;
}

const turnGame = (replayed: ReplayedGame): TurnGame | null =>
  replayed.mode === 'computer' ? { game: replayed.game, you: 'human' }
    : replayed.mode === 'friend' ? { game: replayed.game, you: replayed.seat } : null;

const capped = (ms: number) => Math.min(ms, IDLE_CAP_MS);

function secondsPlayed(replayed: ReplayedGame, summary: GameSummary): number {
  const turns = turnGame(replayed);
  if (turns) return yourTurnTimes(turns).reduce((sum, t) => sum + capped(t.ms), 0) / 1000;
  if (replayed.mode === 'single') {
    let previous = replayed.game.startedAt;
    let ms = 0;
    for (const { at } of replayed.game.moves) {
      ms += capped(Math.max(0, at - previous));
      previous = Math.max(previous, at);
    }
    return ms / 1000;
  }
  if (replayed.mode === 'computer' || replayed.mode === 'friend') return 0;
  return runElapsedMs(replayed.game, summary.endedAt) / 1000;
}

/** Seconds from starting on a word to finding it, for each word found. */
function solveTimes(replayed: ReplayedGame): number[] {
  switch (replayed.mode) {
    case 'single': {
      const { game } = replayed;
      if (game.status !== 'won') return [];
      return [(game.moves[game.moves.length - 1].at - game.startedAt) / 1000];
    }
    case 'computer':
    case 'friend': {
      // Your time up to the guess that found it, not counting the opponent's turns.
      const target = replayed.mode === 'computer' ? replayed.game.computerSecret : replayed.game.secrets[otherSeat(replayed.seat)];
      const turns = yourTurnTimes(turnGame(replayed)!);
      const hit = turns.findIndex(({ word }) => word === target);
      return hit < 0 ? [] : [turns.slice(0, hit + 1).reduce((sum, t) => sum + t.ms, 0) / 1000];
    }
    case 'rush':
    case 'daily':
    case 'lobby':
      return replayed.game.results
        .filter((r) => r.outcome === 'solved')
        .map((r) => wordSeconds(r))
        .filter((s): s is number => s !== null);
  }
}

/** Your place in a Rush with Friends or Competitive Rush. */
const lobbyYou = (replayed: ReplayedGame) => (replayed.mode === 'lobby' ? replayed.places.find((p) => p.you) ?? null : null);

/** Against an opponent, whether you found their word (not a win because they gave up, ran out of time or left). */
function foundTheirWord(replayed: ReplayedGame): boolean {
  const guesses = replayed.mode === 'computer' ? replayed.game.humanGuesses
    : replayed.mode === 'friend' ? replayed.game.guesses[replayed.seat] : [];
  return guesses.some((g) => g.isWin);
}

/** The smallest value, the earliest game winning a tie. */
function lowest(rows: readonly Row[], value: (row: Row) => number | null): GameRef | null {
  let best: GameRef | null = null;
  for (const row of rows) {
    const v = value(row);
    if (v !== null && (best === null || v < best.value)) best = { id: row.id, value: v };
  }
  return best;
}

/** Splits games into the last `TREND_DAYS` and the same span before, or null if either is short of games. */
function trend(
  rows: readonly Row[],
  now: number,
  measure: (rows: readonly Row[]) => number | null,
  counts: (row: Row) => boolean,
): Trend | null {
  const span = TREND_DAYS * DAY_MS;
  const recent = rows.filter((r) => counts(r) && r.summary.endedAt > now - span && r.summary.endedAt <= now);
  const before = rows.filter((r) => counts(r) && r.summary.endedAt > now - 2 * span && r.summary.endedAt <= now - span);
  if (recent.length < TREND_MIN_GAMES || before.length < TREND_MIN_GAMES) return null;
  const current = measure(recent);
  const previous = measure(before);
  return current === null || previous === null ? null : { current, previous, change: current - previous };
}

function winRecord(rows: readonly Row[]): WinRecord {
  const count = (result: string) => rows.filter((r) => r.summary.result === result).length;
  const wins = count('won');
  return { wins, draws: count('drawn'), losses: count('lost'), winPct: winPct(wins, rows.length) };
}

function streaks(rows: readonly Row[]): { currentStreak: number; bestStreak: number } {
  let run = 0;
  let bestStreak = 0;
  for (const row of rows) {
    run = row.summary.result === 'won' ? run + 1 : 0;
    bestStreak = Math.max(bestStreak, run);
  }
  return { currentStreak: run, bestStreak };
}

function modeStats(mode: HistoryMode, rows: readonly Row[], now: number): ModeStats {
  const averageOf = (rs: readonly Row[]) => average(rs.flatMap((r) => r.found));
  // A Word Set's best is by its own measure: a Crush's score, a Rush's time.
  const rankedBy = (r: Row) => (r.replayed.mode === 'rush' || r.replayed.mode === 'lobby' ? runRankBy(r.replayed.game) : 'crush');
  const crush = rows.filter((r) => rankedBy(r) === 'crush');
  const rush = rows.filter((r) => rankedBy(r) === 'rush');
  const best = mode === 'single'
    ? lowest(rows, (r) => (r.found.length ? r.found[0] * DIFFICULTY_FACTOR[r.summary.difficulty] : null))
    : mode === 'computer' || mode === 'friend'
      ? lowest(rows, (r) => (r.summary.result === 'won' && foundTheirWord(r.replayed) ? r.summary.yourGuesses : null))
      : mode === 'rush' ? lowest(crush, (r) => r.summary.rush?.score ?? null)
        // Daily Rush's leaderboard counts total guesses; a lobby's standings, your score.
        : mode === 'daily' ? lowest(rows, (r) => (r.summary.gaveUp ? null : r.summary.yourGuesses))
          : lowest(crush, (r) => lobbyYou(r.replayed)?.score ?? null);
  const bestRush = mode === 'rush' ? lowest(rush, (r) => r.summary.rush?.score ?? null)
    : mode === 'lobby' ? lowest(rush, (r) => lobbyYou(r.replayed)?.seconds ?? null) : null;
  const fastest = lowest(rows, (r) => {
    const times = solveTimes(r.replayed);
    return times.length ? Math.min(...times) : null;
  });
  const opponent = mode === 'computer' || mode === 'friend';
  return {
    mode,
    played: rows.length,
    gaveUp: rows.filter((r) => r.summary.gaveUp).length,
    averageGuesses: averageOf(rows),
    averageTrend: trend(rows, now, averageOf, (r) => r.found.length > 0),
    best,
    bestRush,
    fastest,
    record: opponent
      ? {
        ...winRecord(rows),
        winPctTrend: trend(rows, now, (rs) => winPct(winRecord(rs).wins, rs.length), () => true),
        ...streaks(rows),
        byStrength: mode === 'computer' ? Object.fromEntries(
          STRENGTHS.map((s) => [s, winRecord(rows.filter((r) => r.summary.strength === s))]),
        ) as Record<Strength, WinRecord> : null,
      }
      : null,
    firsts: mode === 'lobby' ? rows.filter((r) => r.summary.place?.rank === 1).length : null,
  };
}

function topGuesses(rows: readonly Row[]): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { replayed } of rows) {
    const guesses = replayed.mode === 'single' ? replayed.game.guesses
      : replayed.mode === 'computer' ? replayed.game.humanGuesses
        : replayed.mode === 'friend' ? replayed.game.guesses[replayed.seat]
          : replayed.game.results.flatMap((r) => r.guesses);
    for (const g of guesses) counts.set(g.guess, (counts.get(g.guess) ?? 0) + 1);
  }
  return [...counts].map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : 1))
    .slice(0, TOP_GUESSES);
}

/** Every stat on the profile, from the finished games in the history. `now` places the trend periods. */
export function computeStats(games: readonly StatsGame[], now: number): Stats {
  const rows: Row[] = games
    .map(({ id, replayed }) => {
      const summary = summarizeGame(replayed);
      return { id, summary, replayed, found: wordsFound(replayed, summary), seconds: secondsPlayed(replayed, summary) };
    })
    .sort((a, b) => a.summary.endedAt - b.summary.endedAt);
  const ofMode = (mode: HistoryMode) => rows.filter((r) => r.summary.mode === mode);
  const opponentGames = rows.filter((r) => r.summary.mode === 'computer' || r.summary.mode === 'friend');
  return {
    played: rows.length,
    winPct: winPct(opponentGames.filter((r) => r.summary.result === 'won').length, opponentGames.length),
    totalGuesses: rows.reduce((sum, r) => sum + r.summary.yourGuesses, 0),
    modes: {
      single: modeStats('single', ofMode('single'), now),
      computer: modeStats('computer', ofMode('computer'), now),
      rush: modeStats('rush', ofMode('rush'), now),
      friend: modeStats('friend', ofMode('friend'), now),
      daily: modeStats('daily', ofMode('daily'), now),
      lobby: modeStats('lobby', ofMode('lobby'), now),
    },
    byDifficulty: Object.fromEntries(
      DIFFICULTIES.map((d) => [d, rows.filter((r) => r.summary.difficulty === d).length]),
    ) as Record<Difficulty, number>,
    topGuesses: topGuesses(rows),
    secondsPlayed: rows.reduce((sum, r) => sum + r.seconds, 0),
  };
}
