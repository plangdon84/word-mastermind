import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPlayOn, parsePlayOns, PLAY_ON_LIMIT, savePlayOn } from './playOnStorage';

describe('games played on after a loss', () => {
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });

  it('saves and loads each game by its key', () => {
    savePlayOn('computer:a', { words: ['crane'], revealed: false, marks: { c: 'out' } });
    savePlayOn('friend:b', { words: [], revealed: true, marks: {} });
    expect(loadPlayOn('computer:a')).toEqual({ words: ['crane'], revealed: false, marks: { c: 'out' } });
    expect(loadPlayOn('friend:b')?.revealed).toBe(true);
    expect(loadPlayOn('computer:z')).toBeNull();
  });

  it(`keeps only the latest ${PLAY_ON_LIMIT}, counting a game saved again as new`, () => {
    for (let i = 0; i <= PLAY_ON_LIMIT; i++) savePlayOn(`computer:${i}`, { words: [], revealed: false, marks: {} });
    expect(loadPlayOn('computer:0')).toBeNull();
    savePlayOn('computer:1', { words: ['crane'], revealed: false, marks: {} });
    savePlayOn('computer:new', { words: [], revealed: false, marks: {} });
    expect(loadPlayOn('computer:1')?.words).toEqual(['crane']);
    expect(loadPlayOn('computer:2')).toBeNull();
  });

  it('drops junk', () => {
    expect(parsePlayOns('not json')).toEqual({});
    expect(parsePlayOns(JSON.stringify({ a: { words: ['crane', 7, 'TOOLONG'], revealed: 'yes', marks: { c: 'maybe' } }, b: 3 })))
      .toEqual({ a: { words: ['crane'], revealed: false, marks: {} } });
  });
});
