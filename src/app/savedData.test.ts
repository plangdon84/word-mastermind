import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAchievements, computeStats, computeUnlocks, replayEntry, type StatsGame } from '../game';
import { parseSession } from './account';
import { parseBackup } from './backup';
import { parseBadgeNotices } from './badges';
import { parseDailySaved, parsePlacements } from './dailyStorage';
import { parseFriendGames } from './friendGames';
import { toHistoryGame } from './historyDb';
import { historyCsv } from './historyCsv';
import { parseLobbySaved } from './lobbyStorage';
import { parsePlayedState } from './playedGames';
import { newProfile, parseProfile } from './profileStorage';
import { parseSyncState } from './profileSync';
import { parseRecentSecrets } from './recentSecrets';
import { parseRushSaved } from './rushStorage';
import { parseSettings } from './settings';
import { parseSaved } from './storage';
import { parseTwoPlayerSaved } from './twoPlayerStorage';

/*
 * Saved data from the 1.0 build (Dev Plan item 17): a backup holding a game
 * of every mode and kind, and everything the app keeps in localStorage,
 * frozen in fixtures/1.0. Players will have data like this when a later
 * version ships, so it must keep loading, and replay to the same results.
 * Never regenerate these files: add a new folder for a new format instead.
 */

const fixture = (name: string) => readFileSync(new URL(`./fixtures/1.0/${name}`, import.meta.url), 'utf8');
const storage: Record<string, string> = JSON.parse(fixture('localStorage.json'));
const key = (name: string) => storage[`word-mastermind:${name}:v1`];
const NOW = Date.UTC(2026, 9, 1);

describe('a 1.0 backup', () => {
  const parsed = parseBackup(fixture('backup.json'), newProfile(NOW, () => 0))!;
  const games: StatsGame[] = parsed.backup.games.map((entry) => ({ id: entry.id, replayed: replayEntry(entry)! }));

  it('loads every game, and each replays to a finished game', () => {
    expect(parsed.skipped).toBe(0);
    expect(parsed.backup.games).toHaveLength(13);
    expect(games.every((g) => g.replayed !== null)).toBe(true);
    expect(new Set(parsed.backup.games.map((g) => g.mode))).toEqual(new Set(['single', 'computer', 'rush', 'friend', 'daily', 'lobby']));
  });

  it('keeps the profile, settings and recent words', () => {
    expect(parsed.backup.profile).toMatchObject({ name: 'Fixture Player', country: 'GB' });
    expect(parsed.backup.settings).toMatchObject({ mode: 'rush', rushKind: 'daily', difficulty: 'hard', showTutorial: false });
    expect(parsed.backup.recentSecrets).toEqual(['storm', 'house']);
  });

  it('replays to the same moves and results', async () => {
    const csv = historyCsv(parsed.backup.games.map((entry) => toHistoryGame(entry)!));
    await expect(csv).toMatchFileSnapshot('./fixtures/1.0/history.csv.snap');
  });

  it('gives the same stats, badges and unlocks', async () => {
    const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
    const derived = {
      stats: computeStats(games, NOW),
      badges: computeAchievements(games, dayOf, parsePlacements(key('daily-placements'))),
      unlocks: computeUnlocks(games),
    };
    await expect(JSON.stringify(derived, null, 2)).toMatchFileSnapshot('./fixtures/1.0/derived.json.snap');
  });
});

describe('1.0 localStorage', () => {
  it('has a parser for every key', () => {
    expect(Object.keys(storage)).toHaveLength(14);
  });

  it('keeps the profile and settings', () => {
    const fallback = newProfile(NOW, () => 0);
    expect(parseProfile(JSON.parse(key('profile')), fallback)).toEqual({
      deviceId: 'fixture-device-0000', guestName: 'Guest-4821', name: 'Fixture Player', country: 'GB', memberSince: 1789769600000,
    });
    // Every 1.0 setting is kept as it was; settings added since take their defaults.
    const { enterRight, shareMarks, rankBy, boardRankBy, findByName, ...settings } = parseSettings(key('settings'));
    expect(settings).toEqual(JSON.parse(key('settings')));
    expect(enterRight).toBe(false);
    expect(shareMarks).toBe(true);
    expect(findByName).toBe(true);
    expect(rankBy).toBe('crush');
    expect(boardRankBy).toBe('crush');
    expect(parseRecentSecrets(key('recent-secrets'))).toEqual(['storm', 'house']);
  });

  it('resumes the games in progress', () => {
    const solo = parseSaved(key('solo'))!;
    expect(solo).toMatchObject({ id: 'fx-solo-playing', marks: { c: 'out' }, draft: 'bea' });
    expect(solo.game.status).toBe('playing');
    expect(solo.game.guesses.map((g) => g.score)).toEqual([3]);

    const two = parseTwoPlayerSaved(key('two-player'))!;
    expect(two).toMatchObject({ id: 'fx-two-playing', marks: { h: 'in' }, draft: 'st' });
    expect(two.game.moves).toHaveLength(2);
    expect(two.game.humanGuesses.map((g) => g.score)).toEqual([3]);

    const rush = parseRushSaved(key('rush'))!;
    expect(rush).toMatchObject({ id: 'fx-rush-playing', marks: [{}, { b: 'in' }, {}, {}] });
    expect(rush.run.current).toBe(1);
    expect(rush.run.pausedAt).not.toBeNull();
  });

  it('keeps the server games this device is in', () => {
    expect(parseDailySaved(key('daily'))).toEqual({ day: '2026-09-30', playing: true, marks: [{}, {}, {}, {}] });
    expect(parsePlacements(key('daily-placements'))).toHaveLength(1);
    expect(parseLobbySaved(key('lobby'))).toMatchObject({ code: 'ABCDEF', kind: 'friends', active: true });
    expect(parseFriendGames(key('friend-games'))).toEqual([
      { id: 'a'.repeat(64), addedAt: 1790769600000, marks: { e: 'in' }, draft: 'cr', done: false },
    ]);
  });

  it('keeps sign-in, sync and notices', () => {
    expect(parseSession(JSON.parse(key('session')))?.account.id).toBe('acct-fixture');
    expect(parseSyncState(key('sync'))).toEqual({ accountId: 'acct-fixture', cursor: 7, pending: ['fx-rush'], profile: null });
    expect(parsePlayedState(key('played'))).toEqual({ who: 'fixture-device-0000', cursor: 12 });
    expect(parseBadgeNotices(key('badges'))).toEqual({ announced: ['clutch'], unseen: [] });
  });
});
