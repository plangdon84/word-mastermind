import { canPickDifficulty, isRatedDifficulty, scoredAfterPick, type Difficulty, type DifficultyError } from './difficulty';
import type { Marks } from './marks';
import { evaluateGuess, type GuessResult } from './scoring';
import { deriveStatus } from './twoPlayer';
import { checkSuggestion, type SuggestError } from './suggest';
import { validateGuess, validateSecretWord, type WordError } from './words';

/**
 * Two people playing each other (README "PvP formats"), refereed by the
 * server. The rules are two player's: turns alternate, and the final guess
 * evens out who went first. Either player can concede. A game is either
 * correspondence (a few days per guess) or live (a chess clock each).
 */

/** The host sent the invite; the guest accepted it. */
export type Seat = 'host' | 'guest';

export const otherSeat = (seat: Seat): Seat => (seat === 'host' ? 'guest' : 'host');

/** Correspondence turn times: 1 or 3 days per guess. */
export const TURN_DAYS = [1, 3] as const;
export type TurnDays = (typeof TURN_DAYS)[number];
export const DAY_MS = 24 * 60 * 60 * 1000;

export const isTurnDays = (value: unknown): value is TurnDays => TURN_DAYS.includes(value as TurnDays);

/** Live games: each player's clock, in minutes for the whole game. */
export const CLOCK_MINUTES = [15, 10, 5] as const;
export type ClockMinutes = (typeof CLOCK_MINUTES)[number];
export const MINUTE_MS = 60 * 1000;

/**
 * How a game is timed: a chess clock of 15, 10 or 5 minutes each (live), or
 * 1 or 3 days per guess (correspondence).
 */
export const TIME_CONTROLS = ['15m', '10m', '5m', '1d', '3d'] as const;
export type TimeControl = (typeof TIME_CONTROLS)[number];

export const isTimeControl = (value: unknown): value is TimeControl => TIME_CONTROLS.includes(value as TimeControl);

/** A live game's minutes each, or null for correspondence. */
export function clockMinutesOf(control: TimeControl): ClockMinutes | null {
  return control.endsWith('m') ? (Number(control.slice(0, -1)) as ClockMinutes) : null;
}

/** A correspondence game's days per guess, or null for a live game. */
export function turnDaysOf(control: TimeControl): TurnDays | null {
  return control.endsWith('d') ? (Number(control.slice(0, -1)) as TurnDays) : null;
}

export const isLive = (control: TimeControl) => clockMinutesOf(control) !== null;

/** "10 minutes each" or "1 day per guess". */
export function timeControlText(control: TimeControl): string {
  const minutes = clockMinutesOf(control);
  if (minutes !== null) return `${minutes} minutes each`;
  const days = turnDaysOf(control)!;
  return `${days} ${days === 1 ? 'day' : 'days'} per guess`;
}

export type PvpMove =
  /**
   * `marks`: the guesser's Medium marks as they sent the guess, which their
   * opponent sees (README "Two player vs. a friend"). Absent when they
   * weren't at Medium or don't share them.
   */
  | { seat: Seat; kind: 'guess'; word: string; at: number; marks?: Marks }
  | { seat: Seat; kind: 'concede'; at: number }
  /** The player whose turn it was ran out of time, which loses: `at` is the moment their time ran out. */
  | { seat: Seat; kind: 'timeout'; at: number }
  /** A player changed difficulty. It never affects the result. */
  | { seat: Seat; kind: 'difficulty'; difficulty: Difficulty; at: number }
  /** Easy's Suggest filled a player's input with this word (README "Easy"). It isn't a guess, and any time. */
  | { seat: Seat; kind: 'suggest'; word: string; at: number };

/** What the referee saves; everything else is rebuilt by replaying the moves. */
export interface PvpRecord {
  /** Each player's own word, which the other is trying to find. */
  secrets: Readonly<Record<Seat, string>>;
  /** Who took the first turn, chosen at random when the game starts. */
  first: Seat;
  /** When the game started (the guest joined), in milliseconds since the epoch. */
  startedAt: number;
  /** Correspondence: how long each player has per guess. */
  turnDays?: TurnDays;
  /** Live: each player's clock for the whole game. A record has this or `turnDays`. */
  clockMinutes?: ClockMinutes;
  /** Each player's difficulty when the game started. */
  difficulty: Readonly<Record<Seat, Difficulty>>;
  /** A rated game (README "Rating"): difficulty can't change during it. Absent otherwise. */
  rated?: true;
  moves: readonly PvpMove[];
}

/** How a record is timed. */
export const timeControlOf = (record: Pick<PvpRecord, 'turnDays' | 'clockMinutes'>): TimeControl =>
  record.clockMinutes !== undefined ? `${record.clockMinutes}m` : `${record.turnDays ?? 1}d`;

/** The record's timing fields for a time control. */
function timingOf(control: TimeControl): Pick<PvpRecord, 'turnDays' | 'clockMinutes'> {
  const minutes = clockMinutesOf(control);
  return minutes !== null ? { clockMinutes: minutes } : { turnDays: turnDaysOf(control)! };
}

export type PvpStatus = 'playing' | 'final-guess' | 'over';

/** How a finished game ended. `winner` is null for a draw. */
export interface PvpOutcome {
  winner: Seat | null;
  reason: 'found' | 'draw' | 'conceded' | 'timed-out';
}

export interface PvpGame extends PvpRecord {
  /** Each player's guesses, scored against the other's word. */
  guesses: Readonly<Record<Seat, readonly GuessResult[]>>;
  status: PvpStatus;
  outcome: PvpOutcome | null;
  playingDifficulty: Readonly<Record<Seat, Difficulty>>;
  /** The easiest difficulty each player used at any point. */
  scoredDifficulty: Readonly<Record<Seat, Difficulty>>;
  /** Suggestions each player has taken. */
  suggested: Readonly<Record<Seat, number>>;
  /** The Medium marks each player sent with their latest guess, or null if it carried none. */
  sharedMarks: Readonly<Record<Seat, Marks | null>>;
}

export type PvpError = WordError | SuggestError | 'game-over' | 'not-your-turn' | 'time-up' | 'time-left' | 'difficulty-fixed' | 'easy-unrated' | DifficultyError;

export type PvpResult = { ok: true; game: PvpGame } | { ok: false; error: PvpError };

/** Status and outcome from the guesses alone, with two player's final-guess rule. */
function statusOf(game: Pick<PvpGame, 'first' | 'guesses'>): Pick<PvpGame, 'status' | 'outcome'> {
  // Two player's rules, with the host in the human's place.
  const status = deriveStatus({
    first: game.first === 'host' ? 'human' : 'computer',
    humanGuesses: game.guesses.host,
    computerGuesses: game.guesses.guest,
  });
  switch (status) {
    case 'playing':
    case 'final-guess': return { status, outcome: null };
    case 'human-won': return { status: 'over', outcome: { winner: 'host', reason: 'found' } };
    case 'computer-won': return { status: 'over', outcome: { winner: 'guest', reason: 'found' } };
    default: return { status: 'over', outcome: { winner: null, reason: 'draw' } };
  }
}

/** Whose turn it is, or null once the game is over. */
export function pvpTurn(game: PvpGame): Seat | null {
  if (game.status === 'over') return null;
  if (game.status === 'final-guess') return otherSeat(game.first);
  const firstCount = game.guesses[game.first].length;
  return firstCount === game.guesses[otherSeat(game.first)].length ? game.first : otherSeat(game.first);
}

/** When the current turn started: the last guess, or the start of the game. */
function turnStart(game: PvpRecord): number {
  let since = game.startedAt;
  for (const move of game.moves) if (move.kind === 'guess') since = move.at;
  return since;
}

/**
 * A live game's clocks: the time each player has left, not counting the
 * turn now running. A player's clock runs from the other's guess (the first
 * player's, from the start) to their own. Null for correspondence.
 */
export function pvpClocks(game: PvpRecord): Record<Seat, number> | null {
  if (game.clockMinutes === undefined) return null;
  const left = { host: game.clockMinutes * MINUTE_MS, guest: game.clockMinutes * MINUTE_MS };
  let since = game.startedAt;
  for (const move of game.moves) {
    if (move.kind !== 'guess') continue;
    left[move.seat] -= move.at - since;
    since = move.at;
  }
  return left;
}

/**
 * When the player to move runs out of time, or null once the game is over.
 * Correspondence: each player has `turnDays` from the other's last guess (the
 * first player, from the start). Live: what's left on their clock, from the
 * same moment. Changing difficulty doesn't reset either.
 */
export function pvpDeadline(game: PvpGame): number | null {
  const turn = pvpTurn(game);
  if (turn === null) return null;
  const clocks = pvpClocks(game);
  return turnStart(game) + (clocks ? clocks[turn] : (game.turnDays ?? 1) * DAY_MS);
}

/** Both words must be valid secret words, and a rated game refuses Easy. */
export function createPvpGame(
  secrets: Record<Seat, string>,
  first: Seat,
  now: number,
  control: TimeControl,
  difficulty: Record<Seat, Difficulty>,
  rated = false,
): PvpResult {
  const host = validateSecretWord(secrets.host);
  if (!host.ok) return host;
  const guest = validateSecretWord(secrets.guest);
  if (!guest.ok) return guest;
  if (rated && !(isRatedDifficulty(difficulty.host) && isRatedDifficulty(difficulty.guest))) return { ok: false, error: 'easy-unrated' };
  return {
    ok: true,
    game: {
      secrets: { host: host.word, guest: guest.word },
      first,
      startedAt: now,
      ...timingOf(control),
      difficulty,
      ...(rated ? { rated: true as const } : {}),
      moves: [],
      guesses: { host: [], guest: [] },
      status: 'playing',
      outcome: null,
      playingDifficulty: difficulty,
      scoredDifficulty: difficulty,
      suggested: { host: 0, guest: 0 },
      sharedMarks: { host: null, guest: null },
    },
  };
}

/**
 * `seat` guesses the other player's word. A rejected guess (not on the word
 * list, say) doesn't use up the turn. `marks` are their Medium marks to
 * share with the opponent, kept only while they play at Medium.
 */
export function submitPvpGuess(game: PvpGame, seat: Seat, guess: string, now: number, marks?: Marks): PvpResult {
  const turn = pvpTurn(game);
  if (turn === null) return { ok: false, error: 'game-over' };
  if (turn !== seat) return { ok: false, error: 'not-your-turn' };
  if (now >= pvpDeadline(game)!) return { ok: false, error: 'time-up' };
  const validation = validateGuess(guess);
  if (!validation.ok) return validation;
  const result = evaluateGuess(validation.word, game.secrets[otherSeat(seat)]);
  const guesses = { ...game.guesses, [seat]: [...game.guesses[seat], result] };
  const shared = marks && game.playingDifficulty[seat] === 'medium' ? sortedMarks(marks) : null;
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { seat, kind: 'guess', word: validation.word, at: now, ...(shared ? { marks: shared } : {}) }],
      guesses,
      sharedMarks: { ...game.sharedMarks, [seat]: shared },
      ...statusOf({ first: game.first, guesses }),
    },
  };
}

/** Only real marks (a–z, in or out), in letter order. */
function sortedMarks(marks: Marks): Marks {
  const kept: Partial<Record<string, 'in' | 'out'>> = {};
  for (const letter of Object.keys(marks).sort()) {
    const mark = marks[letter];
    if (/^[a-z]$/.test(letter) && (mark === 'in' || mark === 'out')) kept[letter] = mark;
  }
  return kept;
}

/** `seat` gives up, which loses, at any point until the game is over. */
export function concedePvp(game: PvpGame, seat: Seat, now: number): PvpResult {
  if (game.status === 'over') return { ok: false, error: 'game-over' };
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { seat, kind: 'concede', at: now }],
      status: 'over',
      outcome: { winner: otherSeat(seat), reason: 'conceded' },
    },
  };
}

/**
 * The player to move ran out of time and loses. The referee calls this once
 * the deadline has passed (`now` is the deadline, or any time after it); the
 * move records the deadline itself.
 */
export function timeOutPvp(game: PvpGame, now: number): PvpResult {
  const turn = pvpTurn(game);
  if (turn === null) return { ok: false, error: 'game-over' };
  const deadline = pvpDeadline(game)!;
  if (now < deadline) return { ok: false, error: 'time-left' };
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { seat: turn, kind: 'timeout', at: deadline }],
      status: 'over',
      outcome: { winner: otherSeat(turn), reason: 'timed-out' },
    },
  };
}

/**
 * `seat` changes difficulty, which doesn't use a turn: any level before their
 * first guess, then only easier ones. A rated game's difficulty is fixed.
 * `replaying` accepts a harder one, as records from before that rule hold.
 */
export function setPvpDifficulty(game: PvpGame, seat: Seat, difficulty: Difficulty, now: number, replaying = false): PvpResult {
  if (game.status === 'over') return { ok: false, error: 'game-over' };
  if (game.rated) return { ok: false, error: 'difficulty-fixed' };
  const guessed = game.guesses[seat].length > 0;
  if (!replaying && !canPickDifficulty(game.playingDifficulty[seat], difficulty, guessed)) return { ok: false, error: 'difficulty-harder' };
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { seat, kind: 'difficulty', difficulty, at: now }],
      playingDifficulty: { ...game.playingDifficulty, [seat]: difficulty },
      scoredDifficulty: { ...game.scoredDifficulty, [seat]: scoredAfterPick(game.scoredDifficulty[seat], difficulty, guessed) },
    },
  };
}

/** Easy's Suggest offered `seat` `word` (picked by their app). Limited to `SUGGEST_LIMIT` a game each. */
export function suggestPvp(game: PvpGame, seat: Seat, word: string, now: number): PvpResult {
  if (game.status === 'over') return { ok: false, error: 'game-over' };
  const refused = checkSuggestion(game.playingDifficulty[seat], game.suggested[seat]);
  if (refused) return { ok: false, error: refused };
  const validation = validateGuess(word);
  if (!validation.ok) return validation;
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { seat, kind: 'suggest', word: validation.word, at: now }],
      suggested: { ...game.suggested, [seat]: game.suggested[seat] + 1 },
    },
  };
}

export function applyPvpMove(game: PvpGame, move: PvpMove): PvpResult {
  switch (move.kind) {
    case 'guess': return submitPvpGuess(game, move.seat, move.word, move.at, move.marks);
    case 'concede': return concedePvp(game, move.seat, move.at);
    case 'timeout': return pvpTurn(game) === move.seat ? timeOutPvp(game, move.at) : { ok: false, error: 'not-your-turn' };
    case 'difficulty': return setPvpDifficulty(game, move.seat, move.difficulty, move.at, true);
    case 'suggest': return suggestPvp(game, move.seat, move.word, move.at);
  }
}

export function toPvpRecord(game: PvpGame): PvpRecord {
  const { secrets, first, startedAt, difficulty, rated, moves } = game;
  return { secrets, first, startedAt, ...timingOf(timeControlOf(game)), difficulty, ...(rated ? { rated } : {}), moves };
}

/** Rebuilds a game from its record, failing on the first move the rules refuse. */
export function replayPvp(record: PvpRecord): PvpResult {
  let result = createPvpGame(
    record.secrets, record.first, record.startedAt, timeControlOf(record), record.difficulty, record.rated === true,
  );
  for (const move of record.moves) {
    if (!result.ok) break;
    result = applyPvpMove(result.game, move);
  }
  return result;
}

/**
 * A game as one player may see it, from their side: the opponent's word is
 * null until they've found it or the game is over.
 */
export interface PvpView {
  first: 'you' | 'opponent';
  yourSecret: string;
  theirSecret: string | null;
  yourGuesses: readonly GuessResult[];
  theirGuesses: readonly GuessResult[];
  turn: 'you' | 'opponent' | null;
  status: PvpStatus;
  /** From your side: null while the game is on. */
  outcome: { result: 'won' | 'lost' | 'draw'; reason: PvpOutcome['reason'] } | null;
  startedAt: number;
  timeControl: TimeControl;
  /** When the player to move runs out of time; null once the game is over. */
  deadline: number | null;
  /**
   * Live: the time each player has left, not counting the turn now running
   * (the player to move has until `deadline`). Null for correspondence.
   */
  clocks: { you: number; opponent: number } | null;
  /** Your difficulty now. */
  difficulty: Difficulty;
  /** A rated game: difficulty can't change. */
  rated: boolean;
  /** Suggestions you've taken (Easy). */
  suggested: number;
  /**
   * Your opponent's difficulty now, which sets what their board shows
   * (README "Two player vs. a friend"). Null only from an older server.
   */
  theirDifficulty: Difficulty | null;
  /** At Medium, the marks they sent with their latest guess; null otherwise, or if they don't share them. */
  theirMarks: Marks | null;
}

const fromSide = (seat: Seat, who: Seat): 'you' | 'opponent' => (who === seat ? 'you' : 'opponent');

/** What to send `seat`, so the referee never gives away the opponent's word. */
export function pvpView(game: PvpGame, seat: Seat): PvpView {
  const other = otherSeat(seat);
  const turn = pvpTurn(game);
  const reveal = game.status === 'over' || game.guesses[seat].some((g) => g.isWin);
  const { outcome } = game;
  const clocks = pvpClocks(game);
  return {
    first: fromSide(seat, game.first),
    yourSecret: game.secrets[seat],
    theirSecret: reveal ? game.secrets[other] : null,
    yourGuesses: game.guesses[seat],
    theirGuesses: game.guesses[other],
    turn: turn && fromSide(seat, turn),
    status: game.status,
    outcome: outcome && {
      result: outcome.winner === null ? 'draw' : outcome.winner === seat ? 'won' : 'lost',
      reason: outcome.reason,
    },
    startedAt: game.startedAt,
    timeControl: timeControlOf(game),
    deadline: pvpDeadline(game),
    clocks: clocks && { you: clocks[seat], opponent: clocks[other] },
    difficulty: game.playingDifficulty[seat],
    rated: game.rated === true,
    suggested: game.suggested[seat],
    theirDifficulty: game.playingDifficulty[other],
    theirMarks: game.playingDifficulty[other] === 'medium' ? game.sharedMarks[other] : null,
  };
}

/** Random turn order: `random` returns a number in [0, 1). */
export function pickFirstSeat(random: () => number = Math.random): Seat {
  return random() < 0.5 ? 'host' : 'guest';
}
