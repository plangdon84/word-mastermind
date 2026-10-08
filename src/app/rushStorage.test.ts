import { describe, expect, it } from 'vitest';
import { createRun, submitRunGuess } from '../game';
import { parseRushSaved, serializeRushSaved } from './rushStorage';

const T = 1_000_000;

const saved = (record: object, extra: object = {}) =>
  JSON.stringify({
    record: {
      words: ['beach', 'crane'], startedAt: T, timeLimitMs: null, pausable: true, difficulty: 'extreme', moves: [],
      ...record,
    },
    id: 'run-1', marks: [{ a: 'in' }, {}], draft: 'cr', ...extra,
  });

const guess = (word: string, at = T) => ({ kind: 'guess', word, at });

describe('parseRushSaved', () => {
  it('round-trips a saved run', () => {
    const created = createRun(['beach', 'crane'], T, { pausable: true, difficulty: 'hard' });
    if (!created.ok) throw new Error(created.error);
    const played = submitRunGuess(created.game, 'beach', T + 5_000);
    if (!played.ok) throw new Error(played.error);
    const state = { id: 'run-1', run: played.game, marks: [{ b: 'in' as const }, {}], draft: 'cr' };
    expect(parseRushSaved(serializeRushSaved(state))).toEqual(state);
  });

  it('replays the moves, computing each word\'s result', () => {
    const run = parseRushSaved(saved({ moves: [guess('bunny'), guess('beach', T + 9_000)] }))?.run;
    expect(run?.current).toBe(1);
    expect(run?.results[0]).toMatchObject({ outcome: 'solved', endedAt: T + 9_000 });
    expect(run?.results[0].guesses[0]).toEqual({ guess: 'bunny', score: 1, isWin: false });
  });

  it('keeps a paused run paused', () => {
    expect(parseRushSaved(saved({ moves: [{ kind: 'pause', at: T + 3_000 }] }))?.run.pausedAt).toBe(T + 3_000);
  });

  it('keeps the difficulties used', () => {
    const run = parseRushSaved(saved({ moves: [{ kind: 'difficulty', difficulty: 'hard', at: T }] }))?.run;
    expect(run).toMatchObject({ difficulty: 'extreme', playingDifficulty: 'hard', scoredDifficulty: 'hard' });
    expect(parseRushSaved(saved({ difficulty: undefined }))?.run.scoredDifficulty).toBe('medium');
  });

  it('keeps a run that was given up', () => {
    expect(parseRushSaved(saved({ moves: [{ kind: 'end', at: T }] }))?.run.status).toBe('over');
  });

  it('rejects anything that does not replay', () => {
    expect(parseRushSaved(saved({ words: ['bunny'] }))).toBeNull();
    expect(parseRushSaved(saved({ words: 'beach' }))).toBeNull();
    expect(parseRushSaved(saved({ moves: [guess('zzzzz')] }))).toBeNull();
    expect(parseRushSaved(saved({ moves: [{ kind: 'guess', word: 'bunny' }] }))).toBeNull();
    expect(parseRushSaved(saved({ moves: [{ kind: 'cheat', at: T }] }))).toBeNull();
    expect(parseRushSaved(saved({ timeLimitMs: 'soon' }))).toBeNull();
    expect(parseRushSaved(saved({ pausable: 'yes' }))).toBeNull();
    expect(parseRushSaved(saved({ difficulty: 'novice' }))).toBeNull();
    expect(parseRushSaved(saved({ moves: [{ kind: 'difficulty', difficulty: 'godlike', at: T }] }))).toBeNull();
    expect(parseRushSaved(saved({ timeLimitMs: 60_000 }))).toBeNull();
  });

  it('drops a malformed draft and marks', () => {
    expect(parseRushSaved(saved({}, { draft: 'TOOLONG1', marks: 'x' }))).toMatchObject({ marks: [{}, {}], draft: '' });
    expect(parseRushSaved(saved({}, { marks: [{ a: 'in' }] }))?.marks).toEqual([{ a: 'in' }, {}]);
  });

  it("reads a save from before marks were kept per word as the current word's", () => {
    const raw = saved({ moves: [guess('beach')] }, { marks: { c: 'out' }, id: undefined });
    expect(parseRushSaved(raw, () => 'new-id')).toMatchObject({ id: 'new-id', marks: [{}, { c: 'out' }] });
  });

  it('returns null for missing or broken data', () => {
    expect(parseRushSaved(null)).toBeNull();
    expect(parseRushSaved('{not json')).toBeNull();
    expect(parseRushSaved('[]')).toBeNull();
  });
});
