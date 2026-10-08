import { describe, expect, it } from 'vitest';
import { applySynced, mergeFirstSync, parseSyncState, profileKey, syncedOf } from './profileSync';
import { DEFAULT_SETTINGS } from './settings';
import type { SyncedProfile } from './syncApi';

const here = {
  deviceId: '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41', guestName: 'Guest-1111', name: 'Ann', country: 'GB', memberSince: 5,
};
const account: SyncedProfile = {
  guestName: 'Guest-4821', name: null, country: null, memberSince: 9,
  settings: { difficulty: 'hard', newestFirst: { easy: false, medium: true, hard: true, extreme: false }, showTutorial: false, shareMarks: true },
};

describe('the synced profile', () => {
  it("takes the account's, filling what it hasn't set from this device, with the earlier member-since", () => {
    expect(mergeFirstSync(syncedOf(here, DEFAULT_SETTINGS), account)).toEqual({
      ...account, name: 'Ann', country: 'GB', memberSince: 5,
    });
  });

  it("applies the account's profile and settings, keeping this device's ID and title-screen choices", () => {
    const { profile, settings } = applySynced(here, { ...DEFAULT_SETTINGS, mode: 'rush' }, account);
    expect(profile).toEqual({ ...here, guestName: 'Guest-4821', name: null, country: null, memberSince: 9 });
    expect(settings).toMatchObject({ mode: 'rush', difficulty: 'hard', showTutorial: false });
    expect(profileKey(syncedOf(profile, settings))).toBe(profileKey(account));
  });

  it('compares profiles whatever order their keys came in', () => {
    const shuffled = { settings: { ...account.settings }, memberSince: 9, country: null, name: null, guestName: 'Guest-4821' };
    expect(profileKey(shuffled)).toBe(profileKey(account));
  });

  it('reads the sync state defensively', () => {
    expect(parseSyncState('{"accountId":"a","cursor":3,"pending":["x",4],"profile":null}'))
      .toEqual({ accountId: 'a', cursor: 3, pending: ['x'], profile: null });
    expect(parseSyncState('{"accountId":"a","cursor":"3","pending":[]}')).toBeNull();
    expect(parseSyncState('nope')).toBeNull();
  });
});
