import { describe, expect, it } from 'vitest';
import { addRecentSecret, parseRecentSecrets, RECENT_LIMIT } from './recentSecrets';

describe('addRecentSecret', () => {
  it('puts the newest word first', () => {
    expect(addRecentSecret(['beach', 'storm'], 'crane')).toEqual(['crane', 'beach', 'storm']);
  });

  it('moves a reused word to the front instead of repeating it', () => {
    expect(addRecentSecret(['beach', 'storm', 'crane'], 'storm')).toEqual(['storm', 'beach', 'crane']);
  });

  it('keeps only the last 10', () => {
    const words = ['beach', 'storm', 'crane', 'plots', 'moist', 'fight', 'judge', 'vixen', 'quilt', 'dwarf'];
    const recent = addRecentSecret(words, 'flush');
    expect(RECENT_LIMIT).toBe(10);
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe('flush');
    expect(recent).not.toContain('dwarf');
  });
});

describe('parseRecentSecrets', () => {
  it('restores saved words', () => {
    expect(parseRecentSecrets(JSON.stringify(['beach', 'storm']))).toEqual(['beach', 'storm']);
  });

  it('drops words off the secret list, duplicates and junk', () => {
    expect(parseRecentSecrets(JSON.stringify(['beach', 'bunny', 7, 'beach', 'storm']))).toEqual(['beach', 'storm']);
  });

  it('returns an empty list for missing or broken data', () => {
    expect(parseRecentSecrets(null)).toEqual([]);
    expect(parseRecentSecrets('{not json')).toEqual([]);
    expect(parseRecentSecrets('{"a":1}')).toEqual([]);
  });
});
