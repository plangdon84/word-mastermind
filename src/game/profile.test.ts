import { describe, expect, it } from 'vitest';
import { guestName, initials, isOffensive, validateName } from './profile';

describe('validateName', () => {
  it('accepts 3 to 20 characters, trimmed with spaces collapsed', () => {
    expect(validateName('  Ann   Lee ')).toEqual({ ok: true, name: 'Ann Lee' });
    expect(validateName('Bob')).toEqual({ ok: true, name: 'Bob' });
    expect(validateName('x'.repeat(20))).toEqual({ ok: true, name: 'x'.repeat(20) });
  });

  it('refuses names too short or too long', () => {
    expect(validateName('  Al  ')).toEqual({ ok: false, error: 'too-short' });
    expect(validateName('x'.repeat(21))).toEqual({ ok: false, error: 'too-long' });
  });

  it('counts an emoji or accented letter as one character', () => {
    expect(validateName('Zoë🙂')).toEqual({ ok: true, name: 'Zoë🙂' });
    expect(validateName('🙂'.repeat(20)).ok).toBe(true);
  });

  it('refuses control and invisible characters', () => {
    expect(validateName('Ann\u0000Lee')).toEqual({ ok: false, error: 'invalid-characters' });
    expect(validateName('Ann​Lee')).toEqual({ ok: false, error: 'invalid-characters' });
  });
});

describe('the profanity filter', () => {
  it('refuses offensive names, however they are spelled', () => {
    for (const name of ['Fuckface', 'f u c k', 'SH1T happens', 'b!tch', 'Big Dick', 'fuuuck', 'asses', 'Nazi 88']) {
      expect(isOffensive(name), name).toBe(true);
    }
    expect(validateName('Big Dick')).toEqual({ ok: false, error: 'offensive' });
  });

  it("allows names that only contain one of the words", () => {
    for (const name of ['Cassie', 'Dickens', 'Scott Hancock', 'Grape Ape', 'Homogenous', 'Class Act', 'Guest-4821', 'Zoë']) {
      expect(isOffensive(name), name).toBe(false);
    }
  });
});

describe('guestName', () => {
  it('makes a name like Guest-4821', () => {
    expect(guestName(() => 0)).toBe('Guest-1000');
    expect(guestName(() => 0.999999)).toBe('Guest-9999');
  });
});

describe('initials', () => {
  it('takes the first and last words, or one letter for one word', () => {
    expect(initials('ann lee')).toBe('AL');
    expect(initials('Mary Ann Lee')).toBe('ML');
    expect(initials('Jean-Luc')).toBe('JL');
    expect(initials('Zoë')).toBe('Z');
    expect(initials('🙂 Sam')).toBe('🙂S');
  });
});
