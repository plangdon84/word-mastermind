import { describe, expect, it } from 'vitest';
import { deduceMarks } from './deduce';
import { marksFitScores } from './marks';

const g = (guess: string, score: number) => ({ guess, score });

describe('deduceMarks', () => {
  it('marks nothing before any guess', () => {
    expect(deduceMarks([])).toEqual({});
  });

  it('marks every letter of a guess that scored 0 out', () => {
    expect(deduceMarks([g('crane', 0)])).toEqual({ c: 'out', r: 'out', a: 'out', n: 'out', e: 'out' });
  });

  it('marks every letter of a guess that scored 5 in, and the rest out', () => {
    const marks = deduceMarks([g('crane', 5)]);
    expect(Object.keys(marks).filter((c) => marks[c] === 'in').sort()).toEqual(['a', 'c', 'e', 'n', 'r']);
    expect(Object.values(marks).filter((m) => m === 'out')).toHaveLength(21);
  });

  it('leaves letters a single partial score does not settle unmarked', () => {
    expect(deduceMarks([g('crane', 2)])).toEqual({});
  });

  it('counts a repeated letter once', () => {
    // bunny scored 1 and the n's are out: b, u or y is in, none settled.
    expect(deduceMarks([g('bunny', 1), g('nerds', 0)])).toEqual({ n: 'out', e: 'out', r: 'out', d: 'out', s: 'out' });
  });

  it('settles letters only visible across guesses', () => {
    // brick 0 rules out b, r, i, c, k; so brine 2 needs n and e in.
    expect(deduceMarks([g('brick', 0), g('brine', 2)])).toMatchObject({ n: 'in', e: 'in', b: 'out', k: 'out' });
  });

  it('marks letters out when a guess\'s score is already used up', () => {
    // crane 1 then crank 0 leaves e as crane's letter; eight 1 then puts i,
    // g, h, t out.
    const marks = deduceMarks([g('crane', 1), g('crank', 0), g('eight', 1)]);
    expect(marks).toMatchObject({ e: 'in', c: 'out', a: 'out', i: 'out', g: 'out', h: 'out', t: 'out' });
  });

  it('marks nothing when the scores contradict each other', () => {
    expect(deduceMarks([g('crane', 0), g('crane', 1)])).toEqual({});
  });

  it('always gives marks that fit the scores, and fit the real secret', () => {
    // Secret "adios".
    const guesses = [g('drift', 2), g('ghoul', 1), g('grubs', 1), g('crane', 1)];
    const marks = deduceMarks(guesses);
    expect(marksFitScores(marks, guesses)).toBe(true);
    for (const [c, m] of Object.entries(marks)) expect('adios'.includes(c)).toBe(m === 'in');
  });
});
