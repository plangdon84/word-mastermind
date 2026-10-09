import { describe, expect, it } from 'vitest';
import { parseSyncedProfile } from './syncApi';

const profile = (newestFirst: unknown) => ({
  guestName: 'Guest-4821', name: null, country: null, memberSince: 1,
  settings: { difficulty: 'medium', newestFirst, showTutorial: true },
});

describe('parseSyncedProfile', () => {
  it('reads a guess order saved before Easy as oldest first at Easy', () => {
    expect(parseSyncedProfile(profile({ medium: true, hard: false, extreme: true }))?.settings.newestFirst)
      .toEqual({ easy: false, medium: true, hard: false, extreme: true });
  });

  it('still refuses an order missing another difficulty, or a malformed Easy', () => {
    expect(parseSyncedProfile(profile({ easy: true, hard: false, extreme: true }))).toBeNull();
    expect(parseSyncedProfile(profile({ easy: 'yes', medium: true, hard: false, extreme: true }))).toBeNull();
  });

  it('reads settings saved before Share my Medium marks as sharing them', () => {
    const order = { easy: false, medium: true, hard: false, extreme: true };
    expect(parseSyncedProfile(profile(order))?.settings.shareMarks).toBe(true);
    const withShare = (shareMarks: unknown) => ({ ...profile(order), settings: { ...profile(order).settings, shareMarks } });
    expect(parseSyncedProfile(withShare(false))?.settings.shareMarks).toBe(false);
    expect(parseSyncedProfile(withShare('no'))).toBeNull();
  });

  it('reads settings saved before Let players find me by name as findable', () => {
    const order = { easy: false, medium: true, hard: false, extreme: true };
    expect(parseSyncedProfile(profile(order))?.settings.findByName).toBe(true);
    const withFind = (findByName: unknown) => ({ ...profile(order), settings: { ...profile(order).settings, findByName } });
    expect(parseSyncedProfile(withFind(false))?.settings.findByName).toBe(false);
    expect(parseSyncedProfile(withFind('no'))).toBeNull();
  });
});
