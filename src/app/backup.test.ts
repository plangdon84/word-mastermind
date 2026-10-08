import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../game';
import { mergeProfile, mergeRecentSecrets, parseBackup, serializeBackup, type Backup } from './backup';
import type { Profile } from './profileStorage';
import { DEFAULT_SETTINGS } from './settings';

const T = 1_000_000;

const profile: Profile = { deviceId: 'device-1', guestName: 'Guest-1234', name: 'Ann Lee', country: 'GB', memberSince: T };
const here: Profile = { deviceId: 'device-2', guestName: 'Guest-5678', name: null, country: null, memberSince: T + 5 };

const game: HistoryEntry = {
  id: 'game-1', version: 1, mode: 'single', marks: { b: 'in' },
  record: { secret: 'beach', startedAt: T, difficulty: 'hard', moves: [{ kind: 'guess', word: 'beach', at: T }] },
};

const backup: Backup = {
  profile, settings: { ...DEFAULT_SETTINGS, newestFirst: { easy: false, medium: false, hard: true, extreme: true } }, recentSecrets: ['storm'], games: [game],
};

describe('parseBackup', () => {
  it('round-trips a backup', () => {
    expect(parseBackup(serializeBackup(backup, T), here)).toEqual({ backup, skipped: 0 });
  });

  it("skips games that don't replay, and counts them", () => {
    const raw = JSON.stringify({ ...JSON.parse(serializeBackup(backup, T)), games: [game, { ...game, id: '' }, 7] });
    expect(parseBackup(raw, here)).toMatchObject({ backup: { games: [game] }, skipped: 2 });
  });

  it('falls back to defaults for a damaged profile or settings', () => {
    const raw = JSON.stringify({ ...JSON.parse(serializeBackup(backup, T)), profile: 'x', settings: [], recentSecrets: 3 });
    expect(parseBackup(raw, here)?.backup).toMatchObject({ profile: here, settings: DEFAULT_SETTINGS, recentSecrets: [] });
  });

  it("refuses a file that isn't a backup", () => {
    expect(parseBackup('{not json', here)).toBeNull();
    expect(parseBackup('{}', here)).toBeNull();
    expect(parseBackup(JSON.stringify({ app: 'word-mastermind', version: 2, games: [] }), here)).toBeNull();
  });
});

describe('mergeProfile', () => {
  it("takes the backup's name, country and earlier start, keeping this browser's device ID", () => {
    expect(mergeProfile(here, profile)).toEqual({
      deviceId: 'device-2', guestName: 'Guest-5678', name: 'Ann Lee', country: 'GB', memberSince: T,
    });
  });
});

describe('mergeRecentSecrets', () => {
  it("keeps this browser's words first, without duplicates, up to 10", () => {
    const many = ['crane', 'plots', 'storm', 'beach', 'moist', 'least', 'worth', 'dunce', 'glory', 'fight', 'quick'];
    expect(mergeRecentSecrets(['storm', 'beach'], many)).toEqual([
      'storm', 'beach', 'crane', 'plots', 'moist', 'least', 'worth', 'dunce', 'glory', 'fight',
    ]);
  });
});
