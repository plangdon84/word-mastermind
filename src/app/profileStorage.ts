import { guestName, isObject, isTime, validateName } from '../game';
import { isCountry } from './countries';
import { newId } from './ids';

/** This browser's profile (README "Profile"). Games are kept separately, in IndexedDB. */
export interface Profile {
  /** Created on first visit: the guest ID the server knows this device by (`x-guest-id`). A new one on signing out. */
  deviceId: string;
  /** Shown until you set a name, e.g. `Guest-4821`. */
  guestName: string;
  /** Your display name, or null until you set one. */
  name: string | null;
  /** An ISO 3166-1 code such as `GB`, or null for "prefer not to say". */
  country: string | null;
  /** When this profile was created, in milliseconds since the epoch. */
  memberSince: number;
}

export const PROFILE_KEY = 'word-mastermind:profile:v1';

export function newProfile(now: number, random: () => number = Math.random): Profile {
  return { deviceId: newId(), guestName: guestName(random), name: null, country: null, memberSince: now };
}

/** The name shown for this profile. */
export const displayName = (profile: Profile) => profile.name ?? profile.guestName;

/** Reads a profile defensively; a field that doesn't parse falls back to `fallback`'s. */
export function parseProfile(value: unknown, fallback: Profile): Profile {
  if (!isObject(value)) return fallback;
  const { deviceId, guestName: guest, name, country, memberSince } = value;
  const validName = typeof name === 'string' ? validateName(name) : null;
  return {
    deviceId: typeof deviceId === 'string' && deviceId ? deviceId : fallback.deviceId,
    guestName: typeof guest === 'string' && validateName(guest).ok ? guest : fallback.guestName,
    name: validName?.ok ? validName.name : null,
    country: isCountry(country) ? country : null,
    memberSince: isTime(memberSince) ? memberSince : fallback.memberSince,
  };
}

/** Loads this browser's profile, creating and saving one on the first visit. */
export function loadProfile(now: number = Date.now()): Profile {
  const fresh = newProfile(now);
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return parseProfile(JSON.parse(raw), fresh);
  } catch {
    // Unreadable: start again.
  }
  saveProfile(fresh);
  return fresh;
}

export function saveProfile(profile: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage is a convenience; the game works without it.
  }
}
