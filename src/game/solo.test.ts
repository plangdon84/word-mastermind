import { describe, expect, it } from 'vitest';
import {
  createSoloGame, giveUp, pickRandomSecret, replaySolo, setSoloDifficulty, submitGuess, toSoloRecord, type SoloGame,
} from './solo';
import { SECRET_WORDS } from './wordLists';

/** A fixed clock reading: the game logic is handed the time, never reads it. */
const T = 1_000;

function newGame(secret: string): SoloGame {
  const result = createSoloGame(secret, T);
  if (!result.ok) throw new Error(`could not create game: ${result.error}`);
  return result.game;
}

describe('createSoloGame', () => {
  it('starts an empty game with the normalized secret', () => {
    expect(createSoloGame('Beach', T)).toEqual({
      ok: true,
      game: {
        secret: 'beach', startedAt: T, difficulty: 'medium', moves: [], guesses: [], status: 'playing',
        playingDifficulty: 'medium', scoredDifficulty: 'medium', suggested: 0,
      },
    });
  });

  it('rejects a secret of the wrong length', () => {
    expect(createSoloGame('bee', T)).toEqual({ ok: false, error: 'wrong-length' });
  });

  it('rejects a secret with repeated letters', () => {
    expect(createSoloGame('bunny', T)).toEqual({ ok: false, error: 'repeated-letters' });
  });

  it('rejects a secret that is not on the secret-word list', () => {
    expect(createSoloGame('nacre', T)).toEqual({ ok: false, error: 'not-in-word-list' });
  });

  it('accepts any secret picked from the secret-word list', () => {
    for (const random of [0, 0.5, 0.999999]) {
      expect(createSoloGame(pickRandomSecret(SECRET_WORDS, () => random), T).ok).toBe(true);
    }
  });
});

describe('submitGuess', () => {
  it('records a scored guess and keeps playing', () => {
    const result = submitGuess(newGame('beach'), 'bunny', T);
    expect(result).toEqual({
      ok: true,
      game: {
        secret: 'beach',
        startedAt: T,
        difficulty: 'medium',
        moves: [{ kind: 'guess', word: 'bunny', at: T }],
        guesses: [{ guess: 'bunny', score: 1, isWin: false }],
        status: 'playing',
        playingDifficulty: 'medium',
        scoredDifficulty: 'medium', suggested: 0,
      },
    });
  });

  it('wins on the exact word, ignoring case', () => {
    const result = submitGuess(newGame('beach'), 'BEACH', T);
    expect(result.ok && result.game.status).toBe('won');
  });

  it('does not win on an anagram', () => {
    const result = submitGuess(newGame('crane'), 'nacre', T);
    expect(result.ok && result.game).toMatchObject({
      status: 'playing',
      guesses: [{ guess: 'nacre', score: 5, isWin: false }],
    });
  });

  it('keeps guess history in order', () => {
    let game = newGame('crane');
    for (const guess of ['plots', 'eerie', 'crane']) {
      const result = submitGuess(game, guess, T);
      if (!result.ok) throw new Error(result.error);
      game = result.game;
    }
    expect(game.guesses.map((g) => [g.guess, g.score])).toEqual([
      ['plots', 0],
      ['eerie', 2],
      ['crane', 5],
    ]);
    expect(game.status).toBe('won');
  });

  it('does not modify the previous game state', () => {
    const game = newGame('beach');
    submitGuess(game, 'bunny', T);
    expect(game.guesses).toEqual([]);
  });

  it('rejects a guess containing non-letters', () => {
    expect(submitGuess(newGame('beach'), 'be4ch', T)).toEqual({ ok: false, error: 'not-letters' });
  });

  it('rejects a guess of the wrong length', () => {
    expect(submitGuess(newGame('beach'), 'bun', T)).toEqual({ ok: false, error: 'wrong-length' });
  });

  it('rejects guesses after the game is won', () => {
    const won = submitGuess(newGame('beach'), 'beach', T);
    if (!won.ok) throw new Error(won.error);
    expect(submitGuess(won.game, 'bunny', T)).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('pickRandomSecret', () => {
  const words = ['beach', 'crane', 'plots'];

  it('uses the random source to pick a word', () => {
    expect(pickRandomSecret(words, () => 0)).toBe('beach');
    expect(pickRandomSecret(words, () => 0.5)).toBe('crane');
    expect(pickRandomSecret(words, () => 0.999)).toBe('plots');
  });

  it('throws on an empty list', () => {
    expect(() => pickRandomSecret([])).toThrow();
  });
});

describe('giveUp', () => {
  it('ends a game in progress, keeping its guesses', () => {
    const played = submitGuess(newGame('beach'), 'bunny', T);
    if (!played.ok) throw new Error(played.error);
    expect(giveUp(played.game, T)).toEqual({
      ok: true,
      game: { ...played.game, moves: [...played.game.moves, { kind: 'give-up', at: T }], status: 'gave-up' },
    });
  });

  it('cannot end a game that is already over', () => {
    const won = submitGuess(newGame('beach'), 'beach', T);
    if (!won.ok) throw new Error(won.error);
    expect(giveUp(won.game, T)).toEqual({ ok: false, error: 'game-over' });
  });

  it('blocks further guesses', () => {
    const over = giveUp(newGame('beach'), T);
    if (!over.ok) throw new Error(over.error);
    expect(submitGuess(over.game, 'crane', T)).toEqual({ ok: false, error: 'game-over' });
  });
});

describe('replaySolo', () => {
  /** Plays guesses one second apart. */
  function play(secret: string, ...guesses: string[]): SoloGame {
    let game = newGame(secret);
    guesses.forEach((guess, i) => {
      const result = submitGuess(game, guess, T + (i + 1) * 1_000);
      if (!result.ok) throw new Error(result.error);
      game = result.game;
    });
    return game;
  }

  it('rebuilds a game from its record, keeping the times passed in', () => {
    const game = play('crane', 'Plots', 'eerie');
    expect(toSoloRecord(game)).toEqual({
      secret: 'crane',
      startedAt: T,
      difficulty: 'medium',
      moves: [{ kind: 'guess', word: 'plots', at: 2_000 }, { kind: 'guess', word: 'eerie', at: 3_000 }],
    });
    expect(replaySolo(toSoloRecord(game))).toEqual({ ok: true, game });
  });

  it('rebuilds a won game and a given-up game', () => {
    const won = play('crane', 'plots', 'crane');
    expect(replaySolo(toSoloRecord(won))).toEqual({ ok: true, game: won });
    const over = giveUp(play('crane', 'plots'), 5_000);
    if (!over.ok) throw new Error(over.error);
    expect(over.game.moves.at(-1)).toEqual({ kind: 'give-up', at: 5_000 });
    expect(replaySolo(toSoloRecord(over.game))).toEqual({ ok: true, game: over.game });
  });

  it('fails on a move the rules refuse', () => {
    const guess = (word: string) => ({ kind: 'guess' as const, word, at: T });
    const record = { secret: 'crane', startedAt: T, difficulty: 'medium' as const };
    expect(replaySolo({ ...record, moves: [guess('zzzzz')] }))
      .toEqual({ ok: false, error: 'not-in-word-list' });
    expect(replaySolo({ ...record, moves: [{ kind: 'give-up', at: T }, guess('plots')] }))
      .toEqual({ ok: false, error: 'game-over' });
    expect(replaySolo({ ...record, moves: [{ kind: 'give-up', at: T }, { kind: 'difficulty', difficulty: 'hard', at: T }] }))
      .toEqual({ ok: false, error: 'game-over' });
    expect(replaySolo({ ...record, secret: 'bunny', moves: [] })).toEqual({ ok: false, error: 'repeated-letters' });
  });
});

describe('setSoloDifficulty', () => {
  it('records the change: any level before the first guess, then only easier ones, scored at the easiest used', () => {
    const created = createSoloGame('crane', T, 'extreme');
    if (!created.ok) throw new Error(created.error);
    const easier = setSoloDifficulty(created.game, 'medium', 2_000);
    if (!easier.ok) throw new Error(easier.error);
    const harder = setSoloDifficulty(easier.game, 'hard', 3_000);
    if (!harder.ok) throw new Error(harder.error);
    // No guess yet, so Hard is what it counts at.
    expect(harder.game).toMatchObject({ difficulty: 'extreme', playingDifficulty: 'hard', scoredDifficulty: 'hard' });
    const guessed = submitGuess(harder.game, 'bunny', 4_000);
    if (!guessed.ok) throw new Error(guessed.error);
    expect(setSoloDifficulty(guessed.game, 'extreme', 5_000)).toEqual({ ok: false, error: 'difficulty-harder' });
    expect(setSoloDifficulty(guessed.game, 'hard', 5_000).ok).toBe(true);
    const down = setSoloDifficulty(guessed.game, 'medium', 5_000);
    if (!down.ok) throw new Error(down.error);
    expect(down.game).toMatchObject({ playingDifficulty: 'medium', scoredDifficulty: 'medium' });
    expect(down.game.moves).toEqual([
      { kind: 'difficulty', difficulty: 'medium', at: 2_000 },
      { kind: 'difficulty', difficulty: 'hard', at: 3_000 },
      { kind: 'guess', word: 'bunny', at: 4_000 },
      { kind: 'difficulty', difficulty: 'medium', at: 5_000 },
    ]);
    expect(replaySolo(toSoloRecord(down.game))).toEqual({ ok: true, game: down.game });
  });

  it('still replays a harder level after a guess, from before that was refused', () => {
    const record = {
      secret: 'crane', startedAt: T, difficulty: 'medium' as const,
      moves: [{ kind: 'guess' as const, word: 'bunny', at: 2_000 }, { kind: 'difficulty' as const, difficulty: 'extreme' as const, at: 3_000 }],
    };
    const replayed = replaySolo(record);
    expect(replayed.ok && replayed.game).toMatchObject({ playingDifficulty: 'extreme', scoredDifficulty: 'medium' });
  });

  it('refuses once the game is over', () => {
    const over = giveUp(newGame('crane'), T);
    if (!over.ok) throw new Error(over.error);
    expect(setSoloDifficulty(over.game, 'hard', T)).toEqual({ ok: false, error: 'game-over' });
  });
});
