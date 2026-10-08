import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKS_KEPT, checksUsed, countCheck, parseChecks } from './checkLimit';

describe('Check for mistakes, counted per game', () => {
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });

  it('counts each game by its key', () => {
    countCheck('solo:a');
    countCheck('rush:b:2');
    countCheck('rush:b:2');
    expect(checksUsed('solo:a')).toBe(1);
    expect(checksUsed('rush:b:2')).toBe(2);
    expect(checksUsed('rush:b:3')).toBe(0);
  });

  it(`keeps only the latest ${CHECKS_KEPT}, counting a game checked again as new`, () => {
    for (let i = 0; i <= CHECKS_KEPT; i++) countCheck(`solo:${i}`);
    expect(checksUsed('solo:0')).toBe(0);
    countCheck('solo:1');
    countCheck('solo:new');
    expect(checksUsed('solo:1')).toBe(2);
    expect(checksUsed('solo:2')).toBe(0);
  });

  it('drops junk', () => {
    expect(parseChecks('not json')).toEqual({});
    expect(parseChecks('[1]')).toEqual({});
    expect(parseChecks(JSON.stringify({ a: 1, b: 'x', c: -1, d: 1.5 }))).toEqual({ a: 1 });
  });
});
