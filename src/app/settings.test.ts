import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('restores saved settings', () => {
    const settings = {
      mode: 'two', opponent: 'friend', rushKind: 'daily', strength: 'expert', timeControl: '5m', difficulty: 'extreme',
      newestFirst: { easy: true, medium: false, hard: true, extreme: true }, showTutorial: false,
      enterRight: true, shareMarks: false,
    };
    expect(parseSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it("falls back to 1 day per guess for a time control that isn't offered", () => {
    expect(parseSettings(JSON.stringify({ timeControl: '2d' })).timeControl).toBe('1d');
  });

  it('keeps the days per guess saved before live games', () => {
    expect(parseSettings(JSON.stringify({ turnDays: 3 })).timeControl).toBe('3d');
  });

  it('restores Rush as the mode', () => {
    expect(parseSettings(JSON.stringify({ mode: 'rush' })).mode).toBe('rush');
  });

  it('defaults to Solo Rush, as before Rush had kinds', () => {
    expect(parseSettings(JSON.stringify({ mode: 'rush' })).rushKind).toBe('solo');
    expect(parseSettings(JSON.stringify({ rushKind: 'friends' })).rushKind).toBe('friends');
    const allOn = { randomOpponent: true, ratingBoards: true, competitiveRush: true, suggest: true, dailyTopTenPercent: true };
    expect(parseSettings(JSON.stringify({ rushKind: 'competitive' }), null, allOn).rushKind).toBe('competitive');
    // Switched off for the launch: back to the defaults.
    expect(parseSettings(JSON.stringify({ rushKind: 'competitive' })).rushKind).toBe('solo');
    expect(parseSettings(JSON.stringify({ opponent: 'random' }), null, allOn).opponent).toBe('random');
    expect(parseSettings(JSON.stringify({ opponent: 'random' })).opponent).toBe('computer');
    expect(parseSettings(JSON.stringify({ rushKind: 'tournament' })).rushKind).toBe('solo');
  });

  it('defaults to single player at Medium', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({ mode: 'single', difficulty: 'medium' });
  });

  it('replaces unknown or malformed values with the defaults', () => {
    const raw = JSON.stringify({ mode: 'three', strength: 'perfect', difficulty: 'novice', newestFirst: 'yes' });
    expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS);
  });

  it('carries over the preferences saved with a solo game before settings existed', () => {
    const legacy = JSON.stringify({ game: {}, prefs: { difficulty: 'hard', newestFirst: true } });
    expect(parseSettings(null, legacy)).toEqual({
      ...DEFAULT_SETTINGS, difficulty: 'hard', newestFirst: { easy: true, medium: true, hard: true, extreme: true },
    });
  });

  it('applies a guess order saved before it was per difficulty to every difficulty', () => {
    expect(parseSettings(JSON.stringify({ newestFirst: true })).newestFirst)
      .toEqual({ easy: true, medium: true, hard: true, extreme: true });
    expect(parseSettings(JSON.stringify({ newestFirst: { hard: true, extreme: 'yes' } })).newestFirst)
      .toEqual({ easy: false, medium: false, hard: true, extreme: false });
  });

  it('restores Easy as the difficulty', () => {
    expect(parseSettings(JSON.stringify({ difficulty: 'easy' })).difficulty).toBe('easy');
  });

  it('prefers saved settings over the legacy preferences', () => {
    const legacy = JSON.stringify({ prefs: { difficulty: 'hard' } });
    expect(parseSettings(JSON.stringify({ difficulty: 'medium' }), legacy).difficulty).toBe('medium');
  });

  it('shares Medium marks until it is turned off', () => {
    expect(parseSettings(JSON.stringify({})).shareMarks).toBe(true);
    expect(parseSettings(JSON.stringify({ shareMarks: false })).shareMarks).toBe(false);
  });

  it('offers the tutorial until it is turned off', () => {
    expect(parseSettings(JSON.stringify({})).showTutorial).toBe(true);
    expect(parseSettings(JSON.stringify({ showTutorial: 'no' })).showTutorial).toBe(true);
    expect(parseSettings(JSON.stringify({ showTutorial: false })).showTutorial).toBe(false);
  });

  it('keeps Enter on the left unless it was moved', () => {
    expect(parseSettings(JSON.stringify({})).enterRight).toBe(false);
    expect(parseSettings(JSON.stringify({ enterRight: 'yes' })).enterRight).toBe(false);
    expect(parseSettings(JSON.stringify({ enterRight: true })).enterRight).toBe(true);
  });
});
