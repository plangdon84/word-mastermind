import { describe, expect, it } from 'vitest';
import { createSoloGame, submitGuess } from '../game';
import { parseSaved, serializeSaved } from './storage';

/** A fixed clock reading: the game logic is handed the time, never reads it. */
const T = 1_000;

const saved = (record: object, extra: object = {}) =>
  JSON.stringify({ id: 'game-1', record: { startedAt: T, ...record }, marks: { a: 'in' }, draft: 'cr', ...extra });

const guess = (word: string) => ({ kind: 'guess', word, at: T });

describe('parseSaved', () => {
  it('replays the moves, computing the scores', () => {
    expect(parseSaved(saved({ secret: 'beach', moves: [guess('bunny')] }))).toEqual({
      id: 'game-1',
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
      marks: { a: 'in' },
      draft: 'cr',
    });
  });

  it('round-trips a saved game', () => {
    const created = createSoloGame('beach', T);
    if (!created.ok) throw new Error(created.error);
    const played = submitGuess(created.game, 'bunny', T);
    if (!played.ok) throw new Error(played.error);
    const state = { id: 'game-1', game: played.game, marks: { b: 'in' as const }, draft: 'be' };
    expect(parseSaved(serializeSaved(state))).toEqual(state);
  });

  it('keeps difficulty changes, reading a save from before they were recorded as Medium', () => {
    const moves = [{ kind: 'difficulty', difficulty: 'medium', at: T }];
    expect(parseSaved(saved({ secret: 'beach', difficulty: 'hard', moves }))?.game)
      .toMatchObject({ difficulty: 'hard', playingDifficulty: 'medium', scoredDifficulty: 'medium' });
    expect(parseSaved(saved({ secret: 'beach', moves: [] }))?.game.difficulty).toBe('medium');
    expect(parseSaved(saved({ secret: 'beach', difficulty: 'novice', moves: [] }))).toBeNull();
  });

  it('gives a save from before game history an ID', () => {
    expect(parseSaved(saved({ secret: 'beach', moves: [] }, { id: undefined }), () => 'new-id')?.id).toBe('new-id');
  });

  it('keeps a game the player gave up on', () => {
    expect(parseSaved(saved({ secret: 'beach', moves: [{ kind: 'give-up', at: T }] }))?.game.status)
      .toBe('gave-up');
  });

  it('rejects moves that do not replay', () => {
    expect(parseSaved(saved({ secret: 'bunny', moves: [] }))).toBeNull();
    expect(parseSaved(saved({ secret: 'beach', moves: [guess('zzzzz')] }))).toBeNull();
    expect(parseSaved(saved({ secret: 'beach', moves: [guess('beach'), guess('crane')] }))).toBeNull();
    expect(parseSaved(saved({ secret: 'beach', moves: [{ kind: 'cheat', at: T }] }))).toBeNull();
    expect(parseSaved(saved({ secret: 'beach', moves: [{ kind: 'guess', word: 'crane' }] }))).toBeNull();
    expect(parseSaved(saved({ secret: 'beach', startedAt: 'now', moves: [] }))).toBeNull();
  });

  it('drops a malformed draft and marks', () => {
    expect(parseSaved(saved({ secret: 'beach', moves: [] }, { draft: 'TOOLONG1', marks: 'x' })))
      .toMatchObject({ marks: {}, draft: '' });
  });

  it('returns null for missing or broken data', () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved('{not json')).toBeNull();
    expect(parseSaved('[]')).toBeNull();
  });
});

describe('parseSaved on a save from before moves were recorded', () => {
  const legacy = (game: object) => JSON.stringify({ game, marks: { a: 'in' }, draft: 'cr' });

  it('restores the game and recomputes its scores', () => {
    const raw = legacy({ secret: 'beach', guesses: [{ guess: 'bunny', score: 4 }], status: 'playing' });
    expect(parseSaved(raw)?.game.guesses).toEqual([{ guess: 'bunny', score: 1, isWin: false }]);
  });

  it('marks a game won when a guess matches, whatever the stored status', () => {
    const raw = legacy({ secret: 'beach', guesses: [{ guess: 'beach' }, { guess: 'crane' }], status: 'playing' });
    const game = parseSaved(raw)?.game;
    expect(game?.status).toBe('won');
    expect(game?.guesses).toHaveLength(1);
  });

  it('keeps a game the player gave up on', () => {
    expect(parseSaved(legacy({ secret: 'beach', guesses: [], status: 'gave-up' }))?.game.status)
      .toBe('gave-up');
  });

  it('rejects words off the lists', () => {
    expect(parseSaved(legacy({ secret: 'bunny', guesses: [], status: 'playing' }))).toBeNull();
    expect(parseSaved(legacy({ secret: 'beach', guesses: [{ guess: 'zzzzz' }], status: 'playing' }))).toBeNull();
  });
});
