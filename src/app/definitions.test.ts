import { describe, expect, it } from 'vitest';
import definitionsJson from '../../wordlist/lists/definitions.json?raw';
import { preloadDefinition } from './definitions';

// The 26 files by first letter (a plugin in vite.config.ts, Dev Plan item 19zn) together hold every definition once.
describe('definitions by first letter', () => {
  it('splits definitions.json by first letter without losing or repeating a word', async () => {
    const all = JSON.parse(definitionsJson) as Record<string, unknown>;
    const seen = new Set<string>();
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      const file = (await import(`virtual:definitions-${letter}`)) as { default: string };
      for (const [word, entries] of Object.entries(JSON.parse(file.default) as Record<string, unknown>)) {
        expect(word.startsWith(letter)).toBe(true);
        expect(entries).toEqual(all[word]);
        expect(seen.has(word)).toBe(false);
        seen.add(word);
      }
    }
    expect(seen.size).toBe(Object.keys(all).length);
  });

  it('preloading a word that is not ours does nothing', () => {
    expect(() => preloadDefinition('')).not.toThrow();
    expect(() => preloadDefinition('1abc')).not.toThrow();
  });
});
