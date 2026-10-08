import type { Strength } from './computer';
import { canPickDifficulty, scoredAfterPick, type Difficulty, type DifficultyError } from './difficulty';
import { evaluateGuess, type GuessResult } from './scoring';
import { checkSuggestion, type SuggestError } from './suggest';
import { validateGuess, validateSecretWord, type WordError } from './words';

/**
 * Two player: the human and the computer each hold a secret word and take
 * turns guessing the other's. See README "Final guess and draws".
 */
export type Side = 'human' | 'computer';

export type TwoPlayerStatus =
  | 'playing'
  /** The first player found the word; the second player's one final guess is pending. */
  | 'final-guess'
  | 'human-won'
  | 'computer-won'
  /** The second player found the word with their final guess. */
  | 'draw'
  /** The human gave up, which loses. */
  | 'gave-up';

/**
 * One thing a side did. Only the human can concede or change difficulty. `at`
 * is when, in milliseconds since the epoch: callers pass the time in, and game
 * logic never reads a clock itself.
 */
export type TwoPlayerMove =
  | { side: Side; kind: 'guess'; word: string; at: number }
  | { side: 'human'; kind: 'concede'; at: number }
  /** The human changed difficulty. It never affects the result, but is recorded as a solo game's is. */
  | { side: 'human'; kind: 'difficulty'; difficulty: Difficulty; at: number }
  /** Easy's Suggest filled the human's input with this word (README "Easy"). It isn't a guess, and any side's turn. */
  | { side: 'human'; kind: 'suggest'; word: string; at: number };

/**
 * What to save: everything else is rebuilt by replaying the moves
 * (`replayTwoPlayer`), so scores, turns and the result are never stored.
 */
export interface TwoPlayerRecord {
  /** The human's word, which the computer is trying to find. */
  humanSecret: string;
  /** The computer's word, which the human is trying to find. */
  computerSecret: string;
  /** Who took the first turn, chosen at random when the game starts. */
  first: Side;
  /** When the game started, in milliseconds since the epoch. */
  startedAt: number;
  /** The human's difficulty when the game started. */
  difficulty: Difficulty;
  /** The computer's strength, fixed for the game. */
  strength: Strength;
  /** Both sides' moves, in the order they were played. */
  moves: readonly TwoPlayerMove[];
}

export interface TwoPlayerGame extends TwoPlayerRecord {
  /** The human's guesses, scored against `computerSecret`. */
  humanGuesses: readonly GuessResult[];
  /** The computer's guesses, scored against `humanSecret`. */
  computerGuesses: readonly GuessResult[];
  status: TwoPlayerStatus;
  /** The human's difficulty now. */
  playingDifficulty: Difficulty;
  /** The easiest difficulty the human used at any point. */
  scoredDifficulty: Difficulty;
  /** Suggestions the human has taken. */
  suggested: number;
}

export type TwoPlayerError = WordError | SuggestError | DifficultyError | 'game-over' | 'not-your-turn';

export type TwoPlayerResult =
  | { ok: true; game: TwoPlayerGame }
  | { ok: false; error: TwoPlayerError };

export const otherSide = (side: Side): Side => (side === 'human' ? 'computer' : 'human');

const guessesOf = (game: Pick<TwoPlayerGame, 'humanGuesses' | 'computerGuesses'>, side: Side) =>
  side === 'human' ? game.humanGuesses : game.computerGuesses;

const WON: Record<Side, TwoPlayerStatus> = { human: 'human-won', computer: 'computer-won' };

/**
 * Works out the status from the guesses alone. Turns alternate, first player
 * first, so the second player's guess number k always follows the first
 * player's guess number k.
 */
export function deriveStatus(
  game: Pick<TwoPlayerGame, 'first' | 'humanGuesses' | 'computerGuesses'>,
): TwoPlayerStatus {
  const first = guessesOf(game, game.first);
  const second = guessesOf(game, otherSide(game.first));
  const firstWin = first.findIndex((g) => g.isWin);
  const secondWin = second.findIndex((g) => g.isWin);

  if (firstWin >= 0 && (secondWin < 0 || firstWin <= secondWin)) {
    // The second player's guess number `firstWin` is their final guess.
    if (second.length <= firstWin) return 'final-guess';
    return second[firstWin].isWin ? 'draw' : WON[game.first];
  }
  // The second player found it first, with both on the same number of turns.
  if (secondWin >= 0) return WON[otherSide(game.first)];
  return 'playing';
}

/** Whose turn it is, or null once the game is over. */
export function whoseTurn(game: TwoPlayerGame): Side | null {
  if (game.status === 'final-guess') return otherSide(game.first);
  if (game.status !== 'playing') return null;
  const firstCount = guessesOf(game, game.first).length;
  const secondCount = guessesOf(game, otherSide(game.first)).length;
  return firstCount === secondCount ? game.first : otherSide(game.first);
}

export function isTwoPlayerOver(game: TwoPlayerGame): boolean {
  return whoseTurn(game) === null;
}

export interface TwoPlayerOptions {
  difficulty?: Difficulty;
  strength?: Strength;
}

/** Both secrets must be valid secret words. */
export function createTwoPlayerGame(
  humanSecret: string,
  computerSecret: string,
  first: Side,
  now: number,
  { difficulty = 'medium', strength = 'skilled' }: TwoPlayerOptions = {},
): TwoPlayerResult {
  const human = validateSecretWord(humanSecret);
  if (!human.ok) return human;
  const computer = validateSecretWord(computerSecret);
  if (!computer.ok) throw new Error(`Invalid computer secret: ${computer.error}`);
  return {
    ok: true,
    game: {
      humanSecret: human.word,
      computerSecret: computer.word,
      first,
      startedAt: now,
      difficulty,
      strength,
      moves: [],
      humanGuesses: [],
      computerGuesses: [],
      status: 'playing',
      playingDifficulty: difficulty,
      scoredDifficulty: difficulty,
      suggested: 0,
    },
  };
}

/**
 * One turn: `side` guesses the other side's word. Returns a new game state;
 * the input game is never modified. A rejected guess (not on the word list,
 * say) doesn't use up the turn, including a final guess.
 */
export function submitTurn(game: TwoPlayerGame, side: Side, guess: string, now: number): TwoPlayerResult {
  const turn = whoseTurn(game);
  if (turn === null) return { ok: false, error: 'game-over' };
  if (turn !== side) return { ok: false, error: 'not-your-turn' };

  const validation = validateGuess(guess);
  if (!validation.ok) return validation;

  const target = side === 'human' ? game.computerSecret : game.humanSecret;
  const result = evaluateGuess(validation.word, target);
  const moved = { ...game, moves: [...game.moves, { side, kind: 'guess' as const, word: validation.word, at: now }] };
  const next = side === 'human'
    ? { ...moved, humanGuesses: [...game.humanGuesses, result] }
    : { ...moved, computerGuesses: [...game.computerGuesses, result] };
  return { ok: true, game: { ...next, status: deriveStatus(next) } };
}

/** The human gives up, which loses, including during a final guess. */
export function concede(game: TwoPlayerGame, now: number): TwoPlayerResult {
  if (isTwoPlayerOver(game)) return { ok: false, error: 'game-over' };
  return {
    ok: true,
    game: { ...game, moves: [...game.moves, { side: 'human', kind: 'concede', at: now }], status: 'gave-up' },
  };
}

/**
 * The human changes difficulty mid-game, which doesn't use a turn: any level
 * before their first guess, then only easier ones. `replaying` accepts a
 * harder one, as records from before that rule hold.
 */
export function setTwoPlayerDifficulty(game: TwoPlayerGame, difficulty: Difficulty, now: number, replaying = false): TwoPlayerResult {
  if (isTwoPlayerOver(game)) return { ok: false, error: 'game-over' };
  const guessed = game.humanGuesses.length > 0;
  if (!replaying && !canPickDifficulty(game.playingDifficulty, difficulty, guessed)) return { ok: false, error: 'difficulty-harder' };
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { side: 'human', kind: 'difficulty', difficulty, at: now }],
      playingDifficulty: difficulty,
      scoredDifficulty: scoredAfterPick(game.scoredDifficulty, difficulty, guessed),
    },
  };
}

/** Easy's Suggest offered the human `word` (picked by the app). Limited to `SUGGEST_LIMIT` a game. */
export function suggestTwoPlayer(game: TwoPlayerGame, word: string, now: number): TwoPlayerResult {
  if (isTwoPlayerOver(game)) return { ok: false, error: 'game-over' };
  const refused = checkSuggestion(game.playingDifficulty, game.suggested);
  if (refused) return { ok: false, error: refused };
  const validation = validateGuess(word);
  if (!validation.ok) return validation;
  return {
    ok: true,
    game: {
      ...game, moves: [...game.moves, { side: 'human', kind: 'suggest', word: validation.word, at: now }], suggested: game.suggested + 1,
    },
  };
}

export function applyTwoPlayerMove(game: TwoPlayerGame, move: TwoPlayerMove): TwoPlayerResult {
  switch (move.kind) {
    case 'guess': return submitTurn(game, move.side, move.word, move.at);
    case 'concede': return concede(game, move.at);
    case 'difficulty': return setTwoPlayerDifficulty(game, move.difficulty, move.at, true);
    case 'suggest': return suggestTwoPlayer(game, move.word, move.at);
  }
}

export function toTwoPlayerRecord(game: TwoPlayerGame): TwoPlayerRecord {
  const { humanSecret, computerSecret, first, startedAt, difficulty, strength, moves } = game;
  return { humanSecret, computerSecret, first, startedAt, difficulty, strength, moves };
}

/**
 * Rebuilds a game from its record. Fails on the first move the rules refuse,
 * including one played out of turn.
 */
export function replayTwoPlayer(record: TwoPlayerRecord): TwoPlayerResult {
  const computer = validateSecretWord(record.computerSecret);
  if (!computer.ok) return computer;
  let result = createTwoPlayerGame(record.humanSecret, computer.word, record.first, record.startedAt, {
    difficulty: record.difficulty, strength: record.strength,
  });
  for (const move of record.moves) {
    if (!result.ok) break;
    result = applyTwoPlayerMove(result.game, move);
  }
  return result;
}

/**
 * A game as one side may see it: the opponent's word is null until that side
 * has found it or the game is over. Its own word is always shown.
 */
export type TwoPlayerView = Omit<TwoPlayerGame, 'humanSecret' | 'computerSecret'> & {
  humanSecret: string | null;
  computerSecret: string | null;
};

/** What to send `side`, so a referee never gives away the opponent's word. */
export function twoPlayerView(game: TwoPlayerGame, side: Side): TwoPlayerView {
  const reveal = isTwoPlayerOver(game) || guessesOf(game, side).some((g) => g.isWin);
  return side === 'human'
    ? { ...game, computerSecret: reveal ? game.computerSecret : null }
    : { ...game, humanSecret: reveal ? game.humanSecret : null };
}

/** Random turn order: `random` returns a number in [0, 1). */
export function pickFirstSide(random: () => number = Math.random): Side {
  return random() < 0.5 ? 'human' : 'computer';
}
