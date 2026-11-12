import { describe, expect, it } from 'vitest';
import { isSentWord, sentName } from './requestChecks';

describe('the shared name and word checks (Dev Plan item 19zp)', () => {
  it('takes a short string as a word, for its referee to check', () => {
    expect(isSentWord('storm')).toBe(true);
    expect(isSentWord('x'.repeat(64))).toBe(true);
    for (const bad of ['x'.repeat(65), 5, null, undefined, ['storm']]) expect(isSentWord(bad)).toBe(false);
  });

  it('normalizes a name, answers offensive-name for one the filter refuses and bad-request for anything else', () => {
    expect(sentName('  Ann  ')).toEqual({ ok: true, name: 'Ann' });
    expect(sentName('Shithead')).toEqual({ ok: false, error: 'offensive-name' });
    for (const bad of ['x', 'x'.repeat(65), 7, undefined]) expect(sentName(bad)).toEqual({ ok: false, error: 'bad-request' });
  });
});
