import { strengthForAverage, strengthForSeconds, type Strength } from './computer';
import { canPickDifficulty, DIFFICULTY_FACTOR, scoredAfterPick, type Difficulty, type DifficultyError } from './difficulty';
import {
  averageWord, evaluateGuess, penalized, totalSeconds, type GuessResult, type RankBy, type ScoredWord, type WordResult,
} from './scoring';
import { checkSuggestion, type SuggestError } from './suggest';
import { validateGuess, validateSecretWord, type WordError } from './words';

/**
 * A multi-word run: a list of secret words solved one after another against
 * one clock, with a result for each word. Every kind of Rush is a run
 * (README "Rush modes").
 *
 * Times are milliseconds since the epoch, passed in by the caller; game logic
 * never reads a clock.
 */
export type RunMove =
  /** A guess at the word being played. */
  | { kind: 'guess'; word: string; at: number }
  /** Give up the word being played and move on to the next, taking a penalty. */
  | { kind: 'give-up-word'; at: number }
  /** Stop the clock (a pausable run only), e.g. when the player leaves the page. */
  | { kind: 'pause'; at: number }
  | { kind: 'resume'; at: number }
  /** The player changed difficulty; the run is scored at the easiest one used. */
  | { kind: 'difficulty'; difficulty: Difficulty; at: number }
  /** Easy's Suggest filled the input with this word, at the word being played (README "Easy"). It isn't a guess. */
  | { kind: 'suggest'; word: string; at: number }
  /**
   * Stop the run: the word being played and any after it are unsolved. For
   * giving up a Rush, or the timer running out (passed the deadline as `at`).
   */
  | { kind: 'end'; at: number };

/** What to save: everything else is rebuilt by replaying the moves (`replayRun`). */
export interface RunRecord {
  words: readonly string[];
  startedAt: number;
  /** Null for a stopwatch (Rush); otherwise the run ends this long after it starts. */
  timeLimitMs: number | null;
  /**
   * Whether the clock can be paused: Solo Rush, where only you are timed.
   * The other Rush clocks keep running.
   */
  pausable: boolean;
  /** The difficulty the run started at. */
  difficulty: Difficulty;
  /**
   * A Word Set ranked by time: Rush. Left out for Crush, ranked by guesses,
   * as every run from before the choice was (README "Rush modes").
   */
  rankBy?: 'rush';
  moves: readonly RunMove[];
}

/** What a run ranks by: Rush or Crush. */
export const runRankBy = (run: RunRecord): RankBy => run.rankBy ?? 'crush';

export type WordOutcome = 'solved' | 'gave-up' | 'unsolved';

export interface RunWord {
  word: string;
  guesses: readonly GuessResult[];
  /** When play on this word began (the run's start, or when the previous word ended); null if not reached. */
  startedAt: number | null;
  /** Null until the word has an outcome. */
  endedAt: number | null;
  /** Time spent paused while this word was being played, which doesn't count. */
  pausedMs: number;
  /** Null while the word is being played, or before it's reached. */
  outcome: WordOutcome | null;
  /** Suggestions taken at this word. */
  suggested: number;
}

export interface RunGame extends RunRecord {
  results: readonly RunWord[];
  /** The index of the word being played; `words.length` once the run is over. */
  current: number;
  status: 'playing' | 'over';
  /** When the clock was paused, or null while it runs. */
  pausedAt: number | null;
  /** The difficulty being played now. */
  playingDifficulty: Difficulty;
  /** The easiest difficulty used at any point, which the run is scored at. */
  scoredDifficulty: Difficulty;
}

export type RunError =
  | WordError | SuggestError | DifficultyError | 'no-words' | 'game-over' | 'time-up' | 'paused' | 'not-paused' | 'not-pausable';

export type RunResult =
  | { ok: true; game: RunGame }
  | { ok: false; error: RunError };

/** When the timer runs out, or null for a stopwatch. */
export function runDeadline(run: RunRecord): number | null {
  return run.timeLimitMs === null ? null : run.startedAt + run.timeLimitMs;
}

export interface RunOptions {
  timeLimitMs?: number | null;
  pausable?: boolean;
  difficulty?: Difficulty;
  rankBy?: RankBy;
}

/** Every word must be a valid secret word. A run can have a time limit or be pausable, not both. */
export function createRun(
  words: readonly string[],
  now: number,
  { timeLimitMs = null, pausable = false, difficulty = 'medium', rankBy = 'crush' }: RunOptions = {},
): RunResult {
  if (timeLimitMs !== null && pausable) throw new Error('A run with a time limit cannot be paused');
  if (words.length === 0) return { ok: false, error: 'no-words' };
  const secrets: string[] = [];
  for (const word of words) {
    const validation = validateSecretWord(word);
    if (!validation.ok) return validation;
    secrets.push(validation.word);
  }
  return {
    ok: true,
    game: {
      words: secrets,
      startedAt: now,
      timeLimitMs,
      pausable,
      difficulty,
      ...(rankBy === 'rush' ? { rankBy } : {}),
      moves: [],
      results: secrets.map((word, i) => ({
        word, guesses: [], startedAt: i === 0 ? now : null, endedAt: null, pausedMs: 0, outcome: null, suggested: 0,
      })),
      current: 0,
      status: 'playing',
      pausedAt: null,
      playingDifficulty: difficulty,
      scoredDifficulty: difficulty,
    },
  };
}

/** Gives the word being played an outcome at `now`, and starts the next one. */
function finishWord(run: RunGame, outcome: WordOutcome, now: number, guesses?: readonly GuessResult[]): RunGame {
  const results = run.results.map((r, i) => {
    if (i === run.current) return { ...r, guesses: guesses ?? r.guesses, endedAt: now, outcome };
    if (i === run.current + 1) return { ...r, startedAt: now };
    return r;
  });
  const current = run.current + 1;
  return { ...run, results, current, status: current === run.words.length ? 'over' : 'playing' };
}

function checkPlaying(run: RunGame, now: number): RunError | null {
  if (run.status !== 'playing') return 'game-over';
  if (run.pausedAt !== null) return 'paused';
  const deadline = runDeadline(run);
  if (deadline !== null && now > deadline) return 'time-up';
  return null;
}

/** A guess at the word being played. Finding it moves on to the next word. */
export function submitRunGuess(run: RunGame, guess: string, now: number): RunResult {
  const blocked = checkPlaying(run, now);
  if (blocked) return { ok: false, error: blocked };
  const validation = validateGuess(guess);
  if (!validation.ok) return validation;

  const result = evaluateGuess(validation.word, run.words[run.current]);
  const moved: RunGame = { ...run, moves: [...run.moves, { kind: 'guess', word: validation.word, at: now }] };
  const guesses = [...run.results[run.current].guesses, result];
  if (result.isWin) return { ok: true, game: finishWord(moved, 'solved', now, guesses) };
  return {
    ok: true,
    game: { ...moved, results: moved.results.map((r, i) => (i === run.current ? { ...r, guesses } : r)) },
  };
}

/** Gives up the word being played and moves on to the next. */
export function giveUpWord(run: RunGame, now: number): RunResult {
  const blocked = checkPlaying(run, now);
  if (blocked) return { ok: false, error: blocked };
  const moved: RunGame = { ...run, moves: [...run.moves, { kind: 'give-up-word', at: now }] };
  return { ok: true, game: finishWord(moved, 'gave-up', now) };
}

/**
 * Changes difficulty mid-run: any level before the run's first guess, then
 * only easier ones, which lower the difficulty the run is scored at for good.
 * `replaying` accepts a harder one, as records from before that rule hold.
 */
export function setRunDifficulty(run: RunGame, difficulty: Difficulty, now: number, replaying = false): RunResult {
  if (run.status !== 'playing') return { ok: false, error: 'game-over' };
  const guessed = run.results.some((r) => r.guesses.length > 0);
  if (!replaying && !canPickDifficulty(run.playingDifficulty, difficulty, guessed)) return { ok: false, error: 'difficulty-harder' };
  return {
    ok: true,
    game: {
      ...run,
      moves: [...run.moves, { kind: 'difficulty', difficulty, at: now }],
      playingDifficulty: difficulty,
      scoredDifficulty: scoredAfterPick(run.scoredDifficulty, difficulty, guessed),
    },
  };
}

/** Easy's Suggest offered `word` (picked by the app) at the word being played. Limited to `SUGGEST_LIMIT` a word. */
export function suggestRun(run: RunGame, word: string, now: number): RunResult {
  const blocked = checkPlaying(run, now);
  if (blocked) return { ok: false, error: blocked };
  const refused = checkSuggestion(run.playingDifficulty, run.results[run.current].suggested);
  if (refused) return { ok: false, error: refused };
  const validation = validateGuess(word);
  if (!validation.ok) return validation;
  return {
    ok: true,
    game: {
      ...run,
      moves: [...run.moves, { kind: 'suggest', word: validation.word, at: now }],
      results: run.results.map((r, i) => (i === run.current ? { ...r, suggested: r.suggested + 1 } : r)),
    },
  };
}

/** Stops the clock. Only a pausable run can pause. */
export function pauseRun(run: RunGame, now: number): RunResult {
  if (run.status !== 'playing') return { ok: false, error: 'game-over' };
  if (!run.pausable) return { ok: false, error: 'not-pausable' };
  if (run.pausedAt !== null) return { ok: false, error: 'paused' };
  return { ok: true, game: { ...run, moves: [...run.moves, { kind: 'pause', at: now }], pausedAt: now } };
}

/** The paused time so far goes to the word being played, and doesn't count. */
function unpause(run: RunGame, now: number): RunGame {
  if (run.pausedAt === null) return run;
  const paused = Math.max(0, now - run.pausedAt);
  const results = run.results.map((r, i) => (i === run.current ? { ...r, pausedMs: r.pausedMs + paused } : r));
  return { ...run, results, pausedAt: null };
}

/** Starts the clock again. */
export function resumeRun(run: RunGame, now: number): RunResult {
  if (run.status !== 'playing') return { ok: false, error: 'game-over' };
  if (run.pausedAt === null) return { ok: false, error: 'not-paused' };
  return { ok: true, game: unpause({ ...run, moves: [...run.moves, { kind: 'resume', at: now }] }, now) };
}

/**
 * Stops the run at `now`: the word being played and any after it are
 * unsolved. When the timer runs out, pass the deadline as `now`. A paused
 * run can end without resuming.
 */
export function endRun(run: RunGame, now: number): RunResult {
  if (run.status !== 'playing') return { ok: false, error: 'game-over' };
  const deadline = runDeadline(run);
  const at = deadline === null ? now : Math.min(now, deadline);
  let game: RunGame = unpause({ ...run, moves: [...run.moves, { kind: 'end', at }] }, at);
  while (game.status === 'playing') game = finishWord(game, 'unsolved', at);
  // Words never reached have no start time.
  const results = game.results.map((r, i) => (i > run.current ? { ...r, startedAt: null, endedAt: null } : r));
  return { ok: true, game: { ...game, results } };
}

export function applyRunMove(run: RunGame, move: RunMove): RunResult {
  switch (move.kind) {
    case 'guess': return submitRunGuess(run, move.word, move.at);
    case 'give-up-word': return giveUpWord(run, move.at);
    case 'pause': return pauseRun(run, move.at);
    case 'resume': return resumeRun(run, move.at);
    case 'difficulty': return setRunDifficulty(run, move.difficulty, move.at, true);
    case 'suggest': return suggestRun(run, move.word, move.at);
    case 'end': return endRun(run, move.at);
  }
}

export function toRunRecord(run: RunGame): RunRecord {
  const { words, startedAt, timeLimitMs, pausable, difficulty, rankBy, moves } = run;
  return { words, startedAt, timeLimitMs, pausable, difficulty, ...(rankBy ? { rankBy } : {}), moves };
}

/** Rebuilds a run from its record. Fails on the first move the rules refuse. */
export function replayRun(record: RunRecord): RunResult {
  let result = createRun(record.words, record.startedAt, {
    timeLimitMs: record.timeLimitMs, pausable: record.pausable, difficulty: record.difficulty, rankBy: runRankBy(record),
  });
  for (const move of record.moves) {
    if (!result.ok) break;
    result = applyRunMove(result.game, move);
  }
  return result;
}

/** A word's time in seconds, not counting pauses; null if it wasn't reached or is still being played. */
export function wordSeconds(word: RunWord): number | null {
  if (word.startedAt === null || word.endedAt === null) return null;
  return (word.endedAt - word.startedAt - word.pausedMs) / 1000;
}

/** The run's time so far in milliseconds, not counting pauses. Stops when the run is over. */
export function runElapsedMs(run: RunGame, now: number): number {
  const end = run.status === 'over'
    ? Math.max(run.startedAt, ...run.results.map((r) => r.endedAt ?? run.startedAt))
    : run.pausedAt ?? now;
  const paused = run.results.reduce((sum, r) => sum + r.pausedMs, 0);
  return Math.max(0, end - run.startedAt - paused);
}

/**
 * A word's result for scoring, or null while it's being played. A word never
 * reached (the run ended first) used no guesses and no time.
 */
export function toWordResult(word: RunWord): WordResult | null {
  if (word.outcome === null) return null;
  return { solved: word.outcome === 'solved', guesses: word.guesses.length, seconds: wordSeconds(word) ?? 0 };
}

/**
 * Whether the run was stopped before its time was up: a Rush given up. A
 * timed run that ran out of time ended on its deadline, which isn't early.
 */
function endedEarly(run: RunGame): boolean {
  const end = run.moves.find((m) => m.kind === 'end');
  if (!end) return false;
  const deadline = runDeadline(run);
  return deadline === null || end.at < deadline;
}

/**
 * A run's words as scored from this run alone (README "Rush"), or null if it
 * has no score: it isn't over, it was ended early, or no word was found. A
 * word given up, or left unsolved when the time ran out, counts as the worst
 * word found in this run plus the penalty guesses (and, ranked by time, the
 * penalty seconds), and at least the guesses and time used on it. Solo Rush
 * is scored this way; the other Rushes use it for their level badges (README
 * "Achievements").
 */
export function scoreSoloRun(run: RunGame, rankBy: RankBy = runRankBy(run)): ScoredWord[] | null {
  if (run.status !== 'over' || endedEarly(run)) return null;
  const results = run.results.map(toWordResult);
  if (results.some((r) => r === null)) return null;
  const words = results as WordResult[];
  if (!words.some((r) => r.solved)) return null;
  return words.map((r) => penalized(r, [r], words, rankBy));
}

/** A finished solo run's result (README "Scoring"). */
export interface SoloRunSummary {
  /** Each word as scored, penalties included. */
  words: ScoredWord[];
  /** Guesses and seconds per word, on average, penalties included. */
  average: ScoredWord;
  totalSeconds: number;
  /** The easiest difficulty used, and what a guess (or a second) counts as there. */
  difficulty: Difficulty;
  factor: number;
  /** Rush: scored by time. Crush: by guesses. */
  rankBy: RankBy;
  /**
   * Crush: average guesses per word × the difficulty factor. Rush: average
   * seconds per word × the difficulty factor. Lower is better.
   */
  score: number;
  /** The level the score earns: by guesses for a Crush, by time for a Rush. */
  level: Strength;
}

/**
 * Null when the run has no score (see `scoreSoloRun`). `rankBy` is the run's
 * own unless given: a Daily Set run is on both boards, so has both levels.
 */
export function summarizeSoloRun(run: RunGame, rankBy: RankBy = runRankBy(run)): SoloRunSummary | null {
  const words = scoreSoloRun(run, rankBy);
  if (!words) return null;
  const average = averageWord(words);
  const factor = DIFFICULTY_FACTOR[run.scoredDifficulty];
  const score = (rankBy === 'rush' ? average.seconds : average.guesses) * factor;
  return {
    words, average, totalSeconds: totalSeconds(words), difficulty: run.scoredDifficulty, factor, rankBy, score,
    level: rankBy === 'rush' ? strengthForSeconds(score) : strengthForAverage(score),
  };
}

/** Picks `count` different words. `random` returns a number in [0, 1). */
export function pickRunWords(
  words: readonly string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  if (count > words.length) throw new Error(`Cannot pick ${count} words from ${words.length}`);
  // A partial Fisher–Yates shuffle: each pick comes from the words not yet picked.
  const pool = [...words];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/**
 * A shuffled copy, each order equally likely (a Fisher–Yates shuffle, front
 * to back, so a `random` that always returns 0 keeps the order).
 */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const pool = [...items];
  for (let i = 0; i < pool.length - 1; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}
