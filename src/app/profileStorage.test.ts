import { describe, expect, it } from 'vitest';
import { displayName, newProfile, parseProfile } from './profileStorage';

const T = 1_000_000;
const fallback = newProfile(T, () => 0.5);

describe('newProfile', () => {
  it('starts with a guest name, a device ID and no name or country', () => {
    expect(fallback).toMatchObject({ guestName: 'Guest-5500', name: null, country: null, memberSince: T });
    expect(fallback.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(displayName(fallback)).toBe('Guest-5500');
  });
});

describe('parseProfile', () => {
  it('keeps valid fields', () => {
    const profile = { deviceId: 'd', guestName: 'Guest-1234', name: 'Ann Lee', country: 'GB', memberSince: 5 };
    expect(parseProfile(profile, fallback)).toEqual(profile);
    expect(displayName(profile)).toBe('Ann Lee');
  });

  it('drops fields that are invalid', () => {
    expect(parseProfile({ name: 'Al', country: 'XX', memberSince: 'soon', guestName: '' }, fallback))
      .toEqual({ ...fallback, name: null, country: null });
    expect(parseProfile('nope', fallback)).toBe(fallback);
  });
});
