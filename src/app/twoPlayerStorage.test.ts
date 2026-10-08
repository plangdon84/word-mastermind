import { describe, expect, it } from 'vitest';
import { concede, createTwoPlayerGame, submitTurn } from '../game';
import { parseTwoPlayerSaved, serializeTwoPlayerSaved } from './twoPlayerStorage';

/** A fixed clock reading: the game logic is handed the time, never reads it. */
const T = 1_000;

const saved = (record: object, extra: object = {}) =>
  JSON.stringify({
    id: 'game-1',
    record: {
      humanSecret: 'storm', computerSecret: 'beach', first: 'human', startedAt: T,
      difficulty: 'hard', strength: 'expert', moves: [], ...record,
    },
    marks: { a: 'in' }, draft: 'cr', ...extra,
  });

const human = (word: string, at = T) => ({ side: 'human', kind: 'guess', word, at });
const computer = (word: string, at = T) => ({ side: 'computer', kind: 'guess', word, at });

describe('parseTwoPlayerSaved', () => {
  it('replays the moves, computing the scores', () => {
    expect(parseTwoPlayerSaved(saved({ moves: [human('bunny'), computer('moist')] }))).toEqual({
      id: 'game-1',
      game: {
        humanSecret: 'storm', computerSecret: 'beach', first: 'human', startedAt: T,
        difficulty: 'hard', strength: 'expert',
        moves: [human('bunny'), computer('moist')],
        humanGuesses: [{ guess: 'bunny', score: 1, isWin: false }],
        computerGuesses: [{ guess: 'moist', score: 4, isWin: false }],
        status: 'playing',
        playingDifficulty: 'hard',
        scoredDifficulty: 'hard', suggested: 0,
      },
      marks: { a: 'in' },
      draft: 'cr',
    });
  });

  it('round-trips a saved game', () => {
    const created = createTwoPlayerGame('storm', 'beach', 'computer', T);
    if (!created.ok) throw new Error(created.error);
    const played = submitTurn(created.game, 'computer', 'crane', T);
    if (!played.ok) throw new Error(played.error);
    const conceded = concede(played.game, T);
    if (!conceded.ok) throw new Error(conceded.error);
    const state = { id: 'game-1', game: conceded.game, marks: {}, draft: '' };
    expect(parseTwoPlayerSaved(serializeTwoPlayerSaved(state))).toEqual(state);
  });

  it('computes the result from the moves', () => {
    expect(parseTwoPlayerSaved(saved({ moves: [human('beach')] }))?.game.status).toBe('final-guess');
    expect(parseTwoPlayerSaved(saved({ moves: [human('beach'), computer('storm')] }))?.game.status).toBe('draw');
    expect(parseTwoPlayerSaved(saved({ moves: [{ side: 'human', kind: 'concede', at: T }] }))?.game.status)
      .toBe('gave-up');
  });

  it('rejects moves that do not replay', () => {
    expect(parseTwoPlayerSaved(saved({ moves: [computer('crane')] }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ moves: [human('beach'), computer('crane'), human('plots')] }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ moves: [human('zzzzz')] }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ moves: [{ side: 'computer', kind: 'concede', at: T }] }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ moves: [{ side: 'human', kind: 'guess', word: 'crane' }] }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ humanSecret: 'bunny' }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ computerSecret: 'zzzzz' }))).toBeNull();
  });

  it('rejects an unknown first player or strength', () => {
    expect(parseTwoPlayerSaved(saved({ first: 'nobody' }))).toBeNull();
    expect(parseTwoPlayerSaved(saved({ strength: 'godlike' }))).toBeNull();
  });

  it('reads a save from before the record held the strength and difficulty', () => {
    const raw = saved({ strength: undefined, difficulty: undefined }, { strength: 'casual' });
    expect(parseTwoPlayerSaved(raw)?.game).toMatchObject({ strength: 'casual', difficulty: 'medium' });
    expect(parseTwoPlayerSaved(saved({ strength: undefined }))).toBeNull();
  });

  it('keeps difficulty changes (before a guess, the level picked is the one it counts at)', () => {
    const raw = saved({ moves: [{ side: 'human', kind: 'difficulty', difficulty: 'extreme', at: T }] });
    expect(parseTwoPlayerSaved(raw)?.game).toMatchObject({ playingDifficulty: 'extreme', scoredDifficulty: 'extreme' });
    expect(parseTwoPlayerSaved(saved({ moves: [{ side: 'computer', kind: 'difficulty', difficulty: 'hard', at: T }] })))
      .toBeNull();
  });

  it('drops a malformed draft and marks', () => {
    expect(parseTwoPlayerSaved(saved({}, { draft: 'TOOLONG1', marks: 'x' }))).toMatchObject({ marks: {}, draft: '' });
  });

  it('returns null for missing or broken data', () => {
    expect(parseTwoPlayerSaved(null)).toBeNull();
    expect(parseTwoPlayerSaved('{not json')).toBeNull();
    expect(parseTwoPlayerSaved('[]')).toBeNull();
  });
});

describe('parseTwoPlayerSaved on a save from before moves were recorded', () => {
  const guesses = (...words: string[]) => words.map((guess) => ({ guess, score: 9, isWin: false }));
  const legacy = (game: object) =>
    JSON.stringify({
      game: {
        humanSecret: 'storm', computerSecret: 'beach', first: 'human',
        humanGuesses: [], computerGuesses: [], status: 'playing', ...game,
      },
      strength: 'expert', marks: { a: 'in' }, draft: 'cr',
    });

  it('restores the game in turn order and recomputes its scores', () => {
    const game = parseTwoPlayerSaved(legacy({ humanGuesses: guesses('bunny'), computerGuesses: guesses('moist') }))?.game;
    expect(game?.moves).toEqual([human('bunny', 0), computer('moist', 0)]);
    expect(game?.computerGuesses).toEqual([{ guess: 'moist', score: 4, isWin: false }]);
  });

  it('recomputes the result, whatever the stored status', () => {
    expect(parseTwoPlayerSaved(legacy({ humanGuesses: guesses('beach'), status: 'human-won' }))?.game.status)
      .toBe('final-guess');
  });

  it('keeps a game the player gave up on', () => {
    expect(parseTwoPlayerSaved(legacy({ status: 'gave-up' }))?.game.status).toBe('gave-up');
  });

  it('rejects guesses that could not have been played in turn', () => {
    expect(parseTwoPlayerSaved(legacy({ computerGuesses: guesses('crane', 'plots') }))).toBeNull();
    expect(parseTwoPlayerSaved(legacy({ humanGuesses: guesses('beach', 'crane'), computerGuesses: guesses('plots') })))
      .toBeNull();
  });
});
