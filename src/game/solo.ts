import { canPickDifficulty, scoredAfterPick, type Difficulty, type DifficultyError } from './difficulty';
import { evaluateGuess, type GuessResult } from './scoring';
import { checkSuggestion, type SuggestError } from './suggest';
import { validateGuess, validateSecretWord, type WordError } from './words';

/**
 * One thing the player did. A game is its secret plus its moves, in order.
 * `at` is when, in milliseconds since the epoch: callers pass the time in
 * (`Date.now()` in the app, the server's clock on a server), and game logic
 * never reads a clock itself.
 */
export type SoloMove =
  | { kind: 'guess'; word: string; at: number }
  | { kind: 'give-up'; at: number }
  /** The player changed difficulty; the game is scored at the easiest one used. */
  | { kind: 'difficulty'; difficulty: Difficulty; at: number }
  /** Easy's Suggest filled the input with this word (README "Easy"). It isn't a guess. */
  | { kind: 'suggest'; word: string; at: number };

/**
 * What to save: everything else is rebuilt by replaying the moves
 * (`replaySolo`), so scores and the result are never stored.
 */
export interface SoloRecord {
  secret: string;
  /** When the game started, in milliseconds since the epoch. */
  startedAt: number;
  /** The difficulty the game started at. */
  difficulty: Difficulty;
  moves: readonly SoloMove[];
}

/** Solo vs. computer: the computer holds a secret word and the human guesses it. */
export interface SoloGame extends SoloRecord {
  guesses: readonly GuessResult[];
  /** `gave-up`: the player asked to see the word, which ends the game. */
  status: 'playing' | 'won' | 'gave-up';
  /** The difficulty being played now. */
  playingDifficulty: Difficulty;
  /** The easiest difficulty used at any point, which the game is scored at. */
  scoredDifficulty: Difficulty;
  /** Suggestions taken so far. */
  suggested: number;
}

export type SoloGameError = WordError | SuggestError | DifficultyError | 'game-over';

export type SoloGameResult =
  | { ok: true; game: SoloGame }
  | { ok: false; error: SoloGameError };

export function createSoloGame(secret: string, now: number, difficulty: Difficulty = 'medium'): SoloGameResult {
  const validation = validateSecretWord(secret);
  if (!validation.ok) return validation;
  return {
    ok: true,
    game: {
      secret: validation.word, startedAt: now, difficulty, moves: [], guesses: [], status: 'playing',
      playingDifficulty: difficulty, scoredDifficulty: difficulty, suggested: 0,
    },
  };
}

/** Returns a new game state; the input game is never modified. */
export function submitGuess(game: SoloGame, guess: string, now: number): SoloGameResult {
  if (game.status !== 'playing') return { ok: false, error: 'game-over' };

  const validation = validateGuess(guess);
  if (!validation.ok) return validation;

  const result = evaluateGuess(validation.word, game.secret);
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { kind: 'guess', word: validation.word, at: now }],
      guesses: [...game.guesses, result],
      status: result.isWin ? 'won' : 'playing',
    },
  };
}

/** Ends the game without a win. Returns a new game state. */
export function giveUp(game: SoloGame, now: number): SoloGameResult {
  if (game.status !== 'playing') return { ok: false, error: 'game-over' };
  return { ok: true, game: { ...game, moves: [...game.moves, { kind: 'give-up', at: now }], status: 'gave-up' } };
}

/**
 * Changes difficulty mid-game: any level before the first guess, then only
 * easier ones, which lower the difficulty the game is scored at for good.
 * `replaying` accepts a harder one, as records from before that rule hold.
 */
export function setSoloDifficulty(game: SoloGame, difficulty: Difficulty, now: number, replaying = false): SoloGameResult {
  if (game.status !== 'playing') return { ok: false, error: 'game-over' };
  const guessed = game.guesses.length > 0;
  if (!replaying && !canPickDifficulty(game.playingDifficulty, difficulty, guessed)) return { ok: false, error: 'difficulty-harder' };
  return {
    ok: true,
    game: {
      ...game,
      moves: [...game.moves, { kind: 'difficulty', difficulty, at: now }],
      playingDifficulty: difficulty,
      scoredDifficulty: scoredAfterPick(game.scoredDifficulty, difficulty, guessed),
    },
  };
}

/** Easy's Suggest offered `word` (picked by the app, `suggestWord`). Limited to `SUGGEST_LIMIT` a game. */
export function suggestSolo(game: SoloGame, word: string, now: number): SoloGameResult {
  if (game.status !== 'playing') return { ok: false, error: 'game-over' };
  const refused = checkSuggestion(game.playingDifficulty, game.suggested);
  if (refused) return { ok: false, error: refused };
  const validation = validateGuess(word);
  if (!validation.ok) return validation;
  return {
    ok: true,
    game: { ...game, moves: [...game.moves, { kind: 'suggest', word: validation.word, at: now }], suggested: game.suggested + 1 },
  };
}

export function applySoloMove(game: SoloGame, move: SoloMove): SoloGameResult {
  switch (move.kind) {
    case 'guess': return submitGuess(game, move.word, move.at);
    case 'give-up': return giveUp(game, move.at);
    case 'difficulty': return setSoloDifficulty(game, move.difficulty, move.at, true);
    case 'suggest': return suggestSolo(game, move.word, move.at);
  }
}

export function toSoloRecord(game: SoloGame): SoloRecord {
  const { secret, startedAt, difficulty, moves } = game;
  return { secret, startedAt, difficulty, moves };
}

/** Rebuilds a game from its record. Fails on the first move the rules refuse. */
export function replaySolo(record: SoloRecord): SoloGameResult {
  let result = createSoloGame(record.secret, record.startedAt, record.difficulty);
  for (const move of record.moves) {
    if (!result.ok) break;
    result = applySoloMove(result.game, move);
  }
  return result;
}

/** Picks the computer's secret word. `random` returns a number in [0, 1). */
export function pickRandomSecret(
  words: readonly string[],
  random: () => number = Math.random,
): string {
  if (words.length === 0) throw new Error('Cannot pick from an empty word list');
  return words[Math.floor(random() * words.length)];
}
