import { describe, expect, it } from 'vitest';
import {
  concede, createTwoPlayerGame, deriveStatus, pickFirstSide, replayTwoPlayer, setTwoPlayerDifficulty, submitTurn,
  toTwoPlayerRecord, twoPlayerView, whoseTurn, type Side, type TwoPlayerGame,
} from './twoPlayer';

/** A fixed clock reading: the game logic is handed the time, never reads it. */
const T = 1_000;

// The human's word is `storm`; the computer's is `beach`.
function newGame(first: Side): TwoPlayerGame {
  const result = createTwoPlayerGame('storm', 'beach', first, T);
  if (!result.ok) throw new Error(`could not create game: ${result.error}`);
  return result.game;
}

/** Plays guesses in order, alternating from whoever's turn it is. */
function play(game: TwoPlayerGame, ...guesses: string[]): TwoPlayerGame {
  for (const guess of guesses) {
    const side = whoseTurn(game);
    if (!side) throw new Error(`game over before ${guess}`);
    const result = submitTurn(game, side, guess, T);
    if (!result.ok) throw new Error(`${guess} rejected: ${result.error}`);
    game = result.game;
  }
  return game;
}

describe('createTwoPlayerGame', () => {
  it('starts an empty game with normalized secrets', () => {
    expect(createTwoPlayerGame(' Storm', 'BEACH', 'human', T, { difficulty: 'hard', strength: 'expert' })).toEqual({
      ok: true,
      game: {
        humanSecret: 'storm', computerSecret: 'beach', first: 'human', startedAt: T,
        difficulty: 'hard', strength: 'expert', moves: [],
        humanGuesses: [], computerGuesses: [], status: 'playing',
        playingDifficulty: 'hard', scoredDifficulty: 'hard', suggested: 0,
      },
    });
  });

  it("rejects an invalid human secret with the word's error", () => {
    expect(createTwoPlayerGame('bunny', 'beach', 'human', T)).toEqual({ ok: false, error: 'repeated-letters' });
    expect(createTwoPlayerGame('nacre', 'beach', 'human', T)).toEqual({ ok: false, error: 'not-in-word-list' });
    expect(createTwoPlayerGame('abc', 'beach', 'human', T)).toEqual({ ok: false, error: 'wrong-length' });
  });
});

describe('turns', () => {
  it('alternates, starting with the first player', () => {
    let game = newGame('computer');
    expect(whoseTurn(game)).toBe('computer');
    game = play(game, 'crane');
    expect(whoseTurn(game)).toBe('human');
    game = play(game, 'plots');
    expect(whoseTurn(game)).toBe('computer');
  });

  it("scores each side against the other side's word", () => {
    const game = play(newGame('human'), 'bunny', 'moist');
    expect(game.humanGuesses).toEqual([{ guess: 'bunny', score: 1, isWin: false }]);
    expect(game.computerGuesses).toEqual([{ guess: 'moist', score: 4, isWin: false }]);
  });

  it('rejects a guess out of turn', () => {
    expect(submitTurn(newGame('human'), 'computer', 'crane', T)).toEqual({ ok: false, error: 'not-your-turn' });
  });

  it('rejects an invalid guess without using up the turn', () => {
    const game = newGame('human');
    expect(submitTurn(game, 'human', 'zzzzz', T)).toEqual({ ok: false, error: 'not-in-word-list' });
    expect(whoseTurn(game)).toBe('human');
  });

  it('allows repeated letters in a guess', () => {
    expect(submitTurn(newGame('human'), 'human', 'bunny', T).ok).toBe(true);
  });
});

describe('the final guess', () => {
  it('gives the second player one final guess when the first player finds the word', () => {
    const game = play(newGame('human'), 'crane', 'plots', 'beach');
    expect(game.status).toBe('final-guess');
    expect(whoseTurn(game)).toBe('computer');
    expect(submitTurn(game, 'human', 'crane', T)).toEqual({ ok: false, error: 'not-your-turn' });
  });

  it('is a draw when the final guess finds the word', () => {
    const game = play(newGame('human'), 'crane', 'plots', 'beach', 'storm');
    expect(game.status).toBe('draw');
    expect(whoseTurn(game)).toBeNull();
  });

  it('is a win for the first player when the final guess misses', () => {
    const game = play(newGame('human'), 'beach', 'crane');
    expect(game.status).toBe('human-won');
  });

  it('works the same when the computer goes first', () => {
    const final = play(newGame('computer'), 'crane', 'plots', 'storm');
    expect(final.status).toBe('final-guess');
    expect(whoseTurn(final)).toBe('human');
    expect(play(final, 'beach').status).toBe('draw');
    expect(play(final, 'bunny').status).toBe('computer-won');
  });

  it('keeps the final guess open after an invalid word', () => {
    const final = play(newGame('computer'), 'storm');
    expect(submitTurn(final, 'human', 'bunny x', T).ok).toBe(false);
    expect(whoseTurn(final)).toBe('human');
  });

  it('gives no final guess when the second player finds the word first', () => {
    const game = play(newGame('computer'), 'crane', 'beach');
    expect(game.status).toBe('human-won');
    expect(whoseTurn(game)).toBeNull();
    expect(submitTurn(game, 'computer', 'storm', T)).toEqual({ ok: false, error: 'game-over' });
  });

  it('does not count an anagram as finding the word', () => {
    // `storm` and `morts` share all 5 letters.
    const game = play(newGame('computer'), 'morts');
    expect(game.computerGuesses[0]).toEqual({ guess: 'morts', score: 5, isWin: false });
    expect(game.status).toBe('playing');
  });
});

describe('concede', () => {
  it('ends the game as a loss for the human', () => {
    const result = concede(newGame('human'), T);
    expect(result.ok && result.game.status).toBe('gave-up');
  });

  it('can be used on the final guess', () => {
    const result = concede(play(newGame('computer'), 'storm'), T);
    expect(result.ok && result.game.status).toBe('gave-up');
  });

  it('is refused once the game is over', () => {
    expect(concede(play(newGame('human'), 'beach', 'crane'), T)).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('deriveStatus', () => {
  it('matches the status reached by playing the same guesses', () => {
    for (const guesses of [
      ['crane'], ['crane', 'plots', 'beach'], ['beach', 'storm'], ['beach', 'crane'], ['crane', 'storm'],
    ]) {
      for (const first of ['human', 'computer'] as const) {
        let game: TwoPlayerGame;
        try {
          game = play(newGame(first), ...guesses);
        } catch {
          continue; // e.g. game over before all guesses were played
        }
        expect(deriveStatus(game)).toBe(game.status);
      }
    }
  });
});

describe('replayTwoPlayer', () => {
  it('records both sides\' moves in the order played', () => {
    const game = play(newGame('computer'), 'crane', 'Plots');
    expect(toTwoPlayerRecord(game)).toEqual({
      humanSecret: 'storm', computerSecret: 'beach', first: 'computer', startedAt: T,
      difficulty: 'medium', strength: 'skilled',
      moves: [
        { side: 'computer', kind: 'guess', word: 'crane', at: T },
        { side: 'human', kind: 'guess', word: 'plots', at: T },
      ],
    });
  });

  it('rebuilds games from their records', () => {
    const conceded = concede(play(newGame('human'), 'crane', 'plots'), T);
    if (!conceded.ok) throw new Error(conceded.error);
    for (const game of [
      newGame('human'),
      play(newGame('human'), 'crane', 'plots', 'beach'),
      play(newGame('computer'), 'crane', 'plots', 'storm', 'beach'),
      conceded.game,
    ]) {
      expect(replayTwoPlayer(toTwoPlayerRecord(game))).toEqual({ ok: true, game });
    }
  });

  it('fails on a move the rules refuse', () => {
    const record = {
      humanSecret: 'storm', computerSecret: 'beach', first: 'human' as const, startedAt: T,
      difficulty: 'medium' as const, strength: 'skilled' as const,
    };
    expect(replayTwoPlayer({ ...record, moves: [{ side: 'computer', kind: 'guess', word: 'crane', at: T }] }))
      .toEqual({ ok: false, error: 'not-your-turn' });
    expect(replayTwoPlayer({ ...record, moves: [{ side: 'human', kind: 'guess', word: 'zzzzz', at: T }] }))
      .toEqual({ ok: false, error: 'not-in-word-list' });
    expect(replayTwoPlayer({ ...record, computerSecret: 'bunny', moves: [] }))
      .toEqual({ ok: false, error: 'repeated-letters' });
  });
});

describe('setTwoPlayerDifficulty', () => {
  it("records the change without using a turn, and keeps the easiest difficulty used", () => {
    const started = play(newGame('human'), 'crane');
    const easier = setTwoPlayerDifficulty(started, 'medium', 2_000);
    if (!easier.ok) throw new Error(easier.error);
    expect(whoseTurn(easier.game)).toBe('computer');
    // After a guess, never a harder level.
    expect(setTwoPlayerDifficulty(easier.game, 'extreme', 3_000)).toEqual({ ok: false, error: 'difficulty-harder' });
    const harder = setTwoPlayerDifficulty(easier.game, 'easy', 3_000);
    if (!harder.ok) throw new Error(harder.error);
    expect(harder.game).toMatchObject({ playingDifficulty: 'easy', scoredDifficulty: 'easy' });
    const played = play(harder.game, 'plots', 'beach');
    expect(played.status).toBe('final-guess');
    expect(replayTwoPlayer(toTwoPlayerRecord(played))).toEqual({ ok: true, game: played });
  });

  it('refuses once the game is over', () => {
    const conceded = concede(newGame('human'), T);
    if (!conceded.ok) throw new Error(conceded.error);
    expect(setTwoPlayerDifficulty(conceded.game, 'hard', T)).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('twoPlayerView', () => {
  it("hides the opponent's word from each side while the game is on", () => {
    const game = play(newGame('human'), 'crane', 'plots');
    expect(twoPlayerView(game, 'human')).toEqual({ ...game, computerSecret: null });
    expect(twoPlayerView(game, 'computer')).toEqual({ ...game, humanSecret: null });
  });

  it('shows it to a side that has found it, while the other side makes its final guess', () => {
    const game = play(newGame('human'), 'beach');
    expect(twoPlayerView(game, 'human').computerSecret).toBe('beach');
    expect(twoPlayerView(game, 'computer').humanSecret).toBeNull();
  });

  it('shows both words once the game is over', () => {
    const conceded = concede(newGame('human'), T);
    if (!conceded.ok) throw new Error(conceded.error);
    expect(twoPlayerView(conceded.game, 'human')).toEqual(conceded.game);
    expect(twoPlayerView(conceded.game, 'computer')).toEqual(conceded.game);
  });
});

describe('pickFirstSide', () => {
  it('picks either side', () => {
    expect(pickFirstSide(() => 0)).toBe('human');
    expect(pickFirstSide(() => 0.999)).toBe('computer');
  });
});
