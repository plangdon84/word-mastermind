import { describe, expect, it } from 'vitest';
import { cycleMark, marksFitScores, parseMarks } from './marks';

describe('cycleMark', () => {
  it('cycles unmarked → in → out → unmarked', () => {
    const once = cycleMark({}, 'a');
    const twice = cycleMark(once, 'a');
    const thrice = cycleMark(twice, 'a');
    expect([once, twice, thrice]).toEqual([{ a: 'in' }, { a: 'out' }, {}]);
  });

  it('leaves other letters alone and never modifies its input', () => {
    const marks = { a: 'in', b: 'out' } as const;
    expect(cycleMark(marks, 'b')).toEqual({ a: 'in' });
    expect(marks).toEqual({ a: 'in', b: 'out' });
  });
});

describe('parseMarks', () => {
  it('keeps valid letter marks only', () => {
    expect(parseMarks({ a: 'in', b: 'out', c: 'maybe', AB: 'in', '1': 'out' }))
      .toEqual({ a: 'in', b: 'out' });
  });

  it('returns no marks for anything else', () => {
    expect(parseMarks(null)).toEqual({});
    expect(parseMarks('a')).toEqual({});
  });
});

describe('marksFitScores', () => {
  const g = (guess: string, score: number) => ({ guess, score });

  it('accepts no marks, or marks the scores allow', () => {
    expect(marksFitScores({}, [])).toBe(true);
    expect(marksFitScores({}, [g('bunny', 1)])).toBe(true);
    expect(marksFitScores({ b: 'in', u: 'out', n: 'out', y: 'out' }, [g('bunny', 1)])).toBe(true);
  });

  it('rejects more letters marked in than a guess scored', () => {
    expect(marksFitScores({ b: 'in', u: 'in' }, [g('bunny', 1)])).toBe(false);
  });

  it('rejects a letter marked in from a guess that scored 0', () => {
    expect(marksFitScores({ c: 'in' }, [g('crane', 0)])).toBe(false);
  });

  it('rejects marking out every letter of a guess that scored', () => {
    expect(marksFitScores({ b: 'out', u: 'out', n: 'out', y: 'out' }, [g('bunny', 1)])).toBe(false);
  });

  it('rejects contradictions only visible across guesses', () => {
    // ghoul 1 and grubs 1 with o and s both in: g, h, u, l, r, b must be out,
    // which is fine; but marking u in too puts two letters in ghoul.
    const guesses = [g('ghoul', 1), g('grubs', 1)];
    expect(marksFitScores({ o: 'in', s: 'in' }, guesses)).toBe(true);
    expect(marksFitScores({ o: 'in', s: 'in', u: 'in' }, guesses)).toBe(false);
  });

  it('rejects more than 5 letters marked in', () => {
    expect(marksFitScores({ a: 'in', b: 'in', c: 'in', d: 'in', e: 'in', f: 'in' }, [])).toBe(false);
  });

  it('accepts the true secret\'s letters marked in', () => {
    const guesses = [g('drift', 2), g('ghoul', 1), g('grubs', 1), g('crane', 1)];
    expect(marksFitScores({ a: 'in', d: 'in', i: 'in', o: 'in', s: 'in' }, guesses)).toBe(true);
  });
});
