import { describe, expect, it, vi } from 'vitest';
import { BADGES, computeAchievements, cpuBadgeId, FEW_GUESSES, HUNTED_BADGES, suggestVoidedFewGuesses } from './achievements';
import { DIFFICULTIES, type Difficulty } from './difficulty';
import { STRENGTHS } from './records';
import type { StatsGame } from './stats';
import { daily, DAY, friend, lobby, rush, solo, versus } from './testGames';

// Every mode on, so every badge is offered; features.test.ts checks the launch's switches.
vi.mock('./features', () => ({
  FEATURES: { randomOpponent: true, ratingBoards: true, competitiveRush: true, suggest: true, dailyTopTenPercent: true },
}));

const T = Date.UTC(2026, 0, 1);
/** UTC days, so tests don't depend on the machine's time zone. */
const utcDay = (ms: number) => Math.floor(ms / DAY);
/** Achievement Hunter's and the unlocks' badges follow from the rest, and are tested on their own. */
const own = (id: string) => !id.startsWith('hunter-') && !id.startsWith('unlock-');
const ids = (games: StatsGame[]) => computeAchievements(games, utcDay).map((b) => b.id).filter(own).sort();

const guesses = (n: number) => [...Array(n - 1)].map(() => 'crane').concat('beach');

// vs. Computer: your word is `storm`, the computer's `beach`.
const win = (id: string, at: number, options: object = {}) =>
  versus(id, at, { first: 'human', you: ['crane', 'beach'], computer: ['house', 'teach'], ...options });
const loss = (id: string, at: number) =>
  versus(id, at, { first: 'computer', computer: ['house', 'storm'], you: ['crane', 'teach'] });

/** Every Solo badge for a word found in 2 guesses at Medium: its difficulty, the easier one, and every guess count. */
const SOLVED_MEDIUM = ['solo-easy', 'solo-guesses-10', 'solo-guesses-15', 'solo-guesses-20', 'solo-medium'];
const cpu = (ids: string[]) => ids.filter((id) => id.includes('cpu-'));

describe('BADGES', () => {
  it('has a unique ID for each badge', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
});

describe('computeAchievements', () => {
  it('earns nothing without games', () => {
    expect(computeAchievements([], utcDay)).toEqual([]);
  });

  it('gives a single-player word its difficulty and the easier ones, and every guess count it meets', () => {
    expect(ids([solo('a', T, guesses(12), { difficulty: 'hard' })])).toEqual(
      ['solo-easy', 'solo-guesses-15', 'solo-guesses-20', 'solo-hard', 'solo-medium'],
    );
    expect(ids([solo('a', T, guesses(8), { difficulty: 'extreme' })])).toEqual([
      'solo-easy', 'solo-extreme', 'solo-guesses-10', 'solo-guesses-15', 'solo-guesses-20', 'solo-hard', 'solo-medium',
    ]);
  });

  it('counts nothing for a game given up, and dates a badge by the game that first earned it', () => {
    expect(ids([solo('a', T, ['crane'], { gaveUp: true })])).toEqual([]);
    const earned = computeAchievements([
      solo('late', T + DAY, guesses(3)),
      solo('early', T, guesses(30)),
    ], utcDay);
    const medium = earned.find((b) => b.id === 'solo-medium');
    expect(medium).toMatchObject({ gameId: 'early' });
    expect(medium!.at).toBeGreaterThan(T);
    expect(earned.find((b) => b.id === 'solo-guesses-10')).toMatchObject({ gameId: 'late' });
  });

  it('counts every word solved in a Rush as solo, and awards its level and the ones below', () => {
    const scored = rush('r', T, [['beach'], ['crane'], ['storm'], ['house']], { difficulty: 'hard' });
    expect(ids([scored])).toEqual([
      'clairvoyant', 'rush-casual', 'rush-expert', 'rush-mastermind', 'rush-skilled', 'solo-easy',
      'solo-guesses-10', 'solo-guesses-15', 'solo-guesses-20', 'solo-hard', 'solo-medium',
    ]);
    // Ended early: no level, but the word found still counts.
    expect(ids([rush('r', T, [['beach']], { end: true })])).toEqual([
      'clairvoyant', 'solo-easy', 'solo-guesses-10', 'solo-guesses-15', 'solo-guesses-20', 'solo-medium',
    ]);
  });

  it('awards a win against the computer its strength and the weaker ones, each at its difficulty and the easier ones', () => {
    const all = STRENGTHS.flatMap((s) => DIFFICULTIES.map((d) => cpuBadgeId(s, d)));
    expect(cpu(ids([win('w', T, { strength: 'mastermind', difficulty: 'extreme' })]))).toEqual(
      [...all, 'cpu-guesses-10', 'cpu-guesses-15', 'cpu-guesses-20'].sort(),
    );
    expect(cpu(ids([win('w', T, { strength: 'skilled', difficulty: 'medium' })]))).toEqual([
      'casual-cpu-easy', 'casual-cpu-medium', 'cpu-guesses-10', 'cpu-guesses-15', 'cpu-guesses-20',
      'skilled-cpu-easy', 'skilled-cpu-medium',
    ]);
    expect(ids([loss('l', T)])).toEqual([]);
  });

  it('counts finding the word in two player as a Solo solve, a win or a draw (issue #65)', () => {
    // Beat the computer in 2 guesses at Medium.
    expect(ids([win('w', T)]).filter((id) => id.startsWith('solo-'))).toEqual(SOLVED_MEDIUM);
    // Tied it with your final guess.
    expect(ids([versus('d', T, { first: 'computer', computer: ['storm'], you: ['beach'] })]).filter((id) => id.startsWith('solo-')))
      .toEqual(SOLVED_MEDIUM);
    // A friend game won in 3 guesses, as in issue #65.
    expect(ids([friend('f', T, { first: 'them', them: ['house', 'crane', 'teach'], you: ['crane', 'house', 'beach'] })]))
      .toEqual(expect.arrayContaining([...SOLVED_MEDIUM, 'friend-win']));
    // Never found: nothing Solo.
    expect(ids([friend('f', T, { first: 'them', them: ['storm'], you: ['crane'] })]).filter((id) => id.startsWith('solo-'))).toEqual([]);
  });

  it('awards Clutch for tying on your last chance only', () => {
    // The computer found your word first; your final guess tied it.
    expect(ids([versus('d', T, { first: 'computer', computer: ['storm'], you: ['beach'] })])).toContain('clutch');
    // You found it first and the computer tied: a draw, but not your clutch.
    expect(ids([versus('d', T, { first: 'human', you: ['beach'], computer: ['storm'] })])).not.toContain('clutch');
  });

  it("doesn't award the few-guesses badges for a word or game where you used Suggest, but still the rest", () => {
    expect(ids([solo('s', T, ['crane', 'beach'], { difficulty: 'easy', suggest: true })])).toEqual(['solo-easy']);
    expect(ids([win('w', T, { difficulty: 'easy', strength: 'mastermind', suggest: true })])).toEqual(
      ['casual-cpu-easy', 'expert-cpu-easy', 'mastermind-cpu-easy', 'skilled-cpu-easy', 'solo-easy'],
    );
    expect(ids([friend('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'], difficulty: 'easy', suggest: true })]))
      .toEqual(['friend-win', 'solo-easy']);
    // In a Rush, only the word Suggest helped with loses them.
    const helped = rush('r', T, [['?beach', 'beach'], ['crane'], ['storm'], ['house']], { difficulty: 'easy' });
    expect(computeAchievements([helped], utcDay).find((b) => b.id === 'solo-guesses-10')).toBeDefined();
    const onlyHelped = rush('r', T, [['?beach', 'beach'], 'give-up', 'give-up', 'give-up'], { difficulty: 'easy' });
    expect(ids([onlyHelped]).filter((id) => id.startsWith('solo-'))).toEqual(['solo-easy']);
  });

  it('counts win streaks against an opponent, ended by a loss, draw or give-up', () => {
    const games = [
      win('a', T), win('b', T + 1_000_000), loss('c', T + 2_000_000),
      win('d', T + 3_000_000), win('e', T + 4_000_000), win('f', T + 5_000_000),
    ];
    const earned = computeAchievements(games, utcDay);
    expect(earned.find((b) => b.id === 'win-streak-3')).toMatchObject({ gameId: 'f' });
    expect(earned.some((b) => b.id === 'win-streak-5')).toBe(false);
    const conceded = versus('g', T + 3_500_000, { first: 'human', you: ['crane'], computer: ['house'], concede: true });
    expect(ids([...games, conceded]).includes('win-streak-3')).toBe(false);
    // Solo games in between don't break a streak.
    expect(ids([win('a', T), solo('s', T + 1, guesses(40)), win('b', T + 2), win('c', T + 3)])).toContain('win-streak-3');
  });

  it('counts a daily streak of finished games in any mode on consecutive days', () => {
    const week = [...Array(7)].map((_, i) => (i % 2 ? win(`w${i}`, T + i * DAY) : solo(`s${i}`, T + i * DAY, guesses(40))));
    expect(computeAchievements(week, utcDay).find((b) => b.id === 'daily-7')).toMatchObject({ gameId: 's6' });
    // Two games on one day count once; a missed day starts again.
    const gap = [...week.slice(0, 3), solo('x', T + 2 * DAY + 60_000, guesses(40)), ...week.slice(4)];
    expect(ids(gap)).not.toContain('daily-7');
  });
});

describe('Daily Rush badges', () => {
  const place = (day: string, rank: number, total: number, finishedAt: number) =>
    ({ day, difficulty: 'medium' as const, rank, total, behind: total - rank, finishedAt });

  it('are earned by a final place in the top 10, or the top 10%', () => {
    expect(computeAchievements([], utcDay, [place('2026-10-01', 11, 50, T)])).toEqual([]);
    expect(computeAchievements([], utcDay, [place('2026-10-01', 10, 50, T)]).map((b) => b.id)).toEqual(['daily-top-10']);
    expect(computeAchievements([], utcDay, [place('2026-10-02', 30, 400, T + DAY)])).toEqual([
      { id: 'daily-top-10-percent', at: T + DAY, gameId: 'daily:2026-10-02' },
    ]);
  });

  it('date each badge by the first day that earned it, among the other badges', () => {
    const earned = computeAchievements([solo('a', T + DAY, guesses(25))], utcDay, [
      place('2026-10-03', 1, 20, T + 2 * DAY), place('2026-10-01', 2, 3, T),
    ]);
    expect(earned.map((b) => [b.id, b.gameId]).filter(([id]) => own(id))).toEqual([
      ['daily-top-10', 'daily:2026-10-01'], ['solo-easy', 'a'], ['solo-medium', 'a'], ['daily-top-10-percent', 'daily:2026-10-03'],
    ]);
  });
});

describe("the server's games' badges", () => {
  const words = [['beach'], ['crane'], ['storm'], ['house']];

  it('award a win against a friend, and Clutch for tying one on your last chance', () => {
    expect(ids([friend('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'] })])).toContain('friend-win');
    expect(ids([friend('f', T, { first: 'them', them: ['storm'], you: ['crane'] })])).not.toContain('friend-win');
    expect(ids([friend('f', T, { first: 'them', them: ['storm'], you: ['beach'] })])).toContain('clutch');
  });

  it('award beating a friend at a harder level, and two or more harder', () => {
    const won = { you: ['crane', 'beach'], them: ['house', 'crane'] };
    const harder = (yours: Difficulty, theirs: Difficulty, more = {}) =>
      ids([friend('f', T, { ...won, difficulty: yours, theirDifficulty: theirs, ...more })]).filter((id) => id.startsWith('friend-harder'));
    expect(harder('medium', 'medium')).toEqual([]);
    expect(harder('hard', 'extreme')).toEqual([]);
    expect(harder('hard', 'medium')).toEqual(['friend-harder']);
    expect(harder('extreme', 'medium')).toEqual(['friend-harder', 'friend-harder-2']);
    expect(harder('hard', 'easy', { seat: 'guest' })).toEqual(['friend-harder', 'friend-harder-2']);
    // A loss or a draw doesn't count.
    expect(ids([friend('f', T, { you: ['crane'], them: ['storm'], difficulty: 'extreme', theirDifficulty: 'easy' })]))
      .not.toContain('friend-harder');
    expect(ids([friend('f', T, { first: 'them', them: ['storm'], you: ['beach'], difficulty: 'extreme', theirDifficulty: 'easy' })]))
      .not.toContain('friend-harder');
    // Won without finding their word: they gave up, or ran out of time.
    expect(harder('extreme', 'easy', { you: ['crane'], them: ['house'], concede: 'them' })).toEqual([]);
    expect(harder('extreme', 'easy', { you: ['crane'], them: [], timeOut: true })).toEqual([]);
    // Their time ran out on their final guess, after you found their word: it counts.
    expect(harder('extreme', 'easy', { you: ['beach'], them: [], timeOut: true })).toEqual(['friend-harder', 'friend-harder-2']);
    // Your level is the easiest you used: switching down mid-game can't earn it.
    expect(harder('extreme', 'medium', { you: ['crane', 'house', 'beach'], them: ['house', 'crane', 'teach'], yourSwitch: 'easy' }))
      .toEqual([]);
  });

  it('award Clairvoyant for a word found with the first guess, in any mode, not with Suggest', () => {
    expect(ids([solo('s', T, ['beach'])])).toContain('clairvoyant');
    expect(ids([solo('s', T, ['crane', 'beach'])])).not.toContain('clairvoyant');
    expect(ids([win('w', T, { you: ['beach'], computer: ['house'] })])).toContain('clairvoyant');
    expect(ids([friend('f', T, { you: ['beach'], them: ['house'] })])).toContain('clairvoyant');
    expect(ids([rush('r', T, [guesses(5), ['crane'], guesses(3).map(() => 'storm'), ['house']])])).toContain('clairvoyant');
    expect(ids([solo('s', T, ['beach'], { difficulty: 'easy', suggest: true })])).not.toContain('clairvoyant');
    const helped = [['?beach', 'beach'], ['house', 'crane'], ['house', 'storm'], ['crane', 'house']];
    expect(ids([rush('r', T, helped, { difficulty: 'easy' })])).not.toContain('clairvoyant');
  });

  it('count friend wins in the win streak', () => {
    const games = [win('a', T), friend('b', T + 1, { you: ['crane', 'beach'], them: ['house', 'crane'] }), win('c', T + 2)];
    expect(ids(games)).toContain('win-streak-3');
  });

  it('award the Daily Rush at its difficulty only, and count its days in a row by Daily Rush day', () => {
    expect(ids([daily('d', '2026-10-01', T, words, { difficulty: 'hard' })])).toEqual(expect.arrayContaining(['daily-rush-hard']));
    expect(ids([daily('d', '2026-10-01', T, words, { difficulty: 'hard' })])).not.toContain('daily-rush-medium');
    const week = [...Array(7)].map((_, i) => daily(`d${i}`, `2026-10-0${i + 1}`, T + i * DAY, words));
    expect(computeAchievements(week, utcDay).find((b) => b.id === 'daily-rush-streak-7')).toMatchObject({ gameId: 'd6' });
    expect(ids([...week.slice(0, 3), ...week.slice(4)])).not.toContain('daily-rush-streak-7');
    // A run finished after its day ended (an hour into the next) isn't on the streak.
    const late = daily('d3', '2026-10-04', Date.UTC(2026, 9, 5, 1), words);
    expect(ids([...week.slice(0, 3), late, ...week.slice(4)])).not.toContain('daily-rush-streak-7');
  });

  it('award finishing first in a lobby, and in a Competitive Rush against a person', () => {
    expect(ids([lobby('l', T, words, { rank: 1 })])).toContain('lobby-win');
    expect(ids([lobby('l', T, words, { rank: 2 })])).not.toContain('lobby-win');
    expect(ids([lobby('l', T, words, { rank: 1, kind: 'competitive' })])).toEqual(expect.arrayContaining(['competitive-win']));
    expect(ids([lobby('l', T, words, { rank: 1, kind: 'competitive' })])).not.toContain('lobby-win');
  });

  it('award a Rush level in every Rush, scored from your own run', () => {
    const levels = (game: StatsGame) => ids([game]).filter((id) => id.startsWith('rush-'));
    const every = ['rush-casual', 'rush-expert', 'rush-mastermind', 'rush-skilled'];
    expect(levels(daily('d', '2026-10-01', T, words))).toEqual(every);
    expect(levels(lobby('l', T, words, { rank: 2 }))).toEqual(every);
    expect(levels(lobby('l', T, words, { rank: 2, kind: 'competitive' }))).toEqual(every);
    // Time ran out on the last two: each counts as your worst solved word (1 guess) + 10, so 6 a word.
    expect(levels(lobby('l', T, [['beach'], ['crane']], { rank: 2, end: 'time-up' }))).toEqual(every);
    // 12 + 2 unsolved at 22: an average of 17, Skilled.
    const slow = [guesses(12), [...Array(11)].map(() => 'house').concat('crane')];
    expect(levels(lobby('l', T, slow, { rank: 2, end: 'time-up' }))).toEqual(['rush-casual', 'rush-skilled']);
    // Given up before the time ran out: no level.
    expect(levels(lobby('l', T, [['beach'], ['crane']], { rank: 2, end: true }))).toEqual([]);
  });
});

describe('Achievement Hunter', () => {
  it('is earned with the badge that takes you past each share of the others', () => {
    const houses = [...Array(25)].map(() => 'house');
    const games = [
      versus('w', T, { strength: 'casual', you: guesses(25), computer: houses }),
      friend('f', T + 1_000_000, { you: guesses(25), them: houses }),
    ];
    const earned = computeAchievements(games, utcDay);
    const others = earned.filter((b) => !b.id.startsWith('hunter-'));
    expect(others.length).toBeLessThan(HUNTED_BADGES / 4);
    expect(earned.some((b) => b.id.startsWith('hunter-'))).toBe(false);
    // Enough badges from a few games: two slow wins, then a Rush at Mastermind level at Extreme.
    const more = [...games, rush('r', T + DAY, [['beach'], ['crane'], ['storm'], ['house']], { difficulty: 'extreme' })];
    const all = computeAchievements(more, utcDay);
    const count = all.filter((b) => !b.id.startsWith('hunter-')).length;
    expect(count).toBeGreaterThanOrEqual(Math.ceil(HUNTED_BADGES / 4));
    expect(all.find((b) => b.id === 'hunter-25')).toMatchObject({ gameId: 'r' });
    expect(all.find((b) => b.id === 'hunter-50')).toBeUndefined();
  });

  it('keeps a level reached before the badges added later, which count only toward levels not yet reached', () => {
    const added = BADGES.filter((b) => b.addedLater).map((b) => b.id);
    expect(added).toEqual(['friend-harder', 'friend-harder-2', 'clairvoyant']);
    const before = HUNTED_BADGES - added.length;
    // Just enough badges for 25% of those from before: a slow vs. computer win and a slow friend win,
    // then a Rush at Mastermind level at Hard, which the larger count needs one more than.
    const houses = [...Array(25)].map(() => 'house');
    const games = [
      versus('w', T, { strength: 'casual', you: guesses(25), computer: houses }),
      friend('f', T + 1_000_000, { you: guesses(25), them: houses }),
      rush('r', T + DAY, [['crane', 'beach'], ['beach', 'crane'], ['crane', 'storm'], ['crane', 'house']], { difficulty: 'hard' }),
    ];
    const earned = computeAchievements(games, utcDay);
    const others = earned.filter((b) => !b.id.startsWith('hunter-')).length;
    expect(others).toBeGreaterThanOrEqual(Math.ceil(before / 4));
    expect(others).toBeLessThan(Math.ceil(HUNTED_BADGES / 4));
    expect(earned.find((b) => b.id === 'hunter-25')).toMatchObject({ gameId: 'r' });
  });

  it("counts every badge but its own, Easy's included", () => {
    expect(HUNTED_BADGES).toBe(BADGES.length - 4);
    const easyOnly = computeAchievements([solo('s', T, guesses(25), { difficulty: 'easy' })], utcDay);
    expect(easyOnly.map((b) => b.id)).toEqual(['solo-easy', 'unlock-two-player']);
  });
});

describe('the unlock badges', () => {
  it('are earned with each step of unlocking modes, by the game that opened it', () => {
    const games = [solo('s', T, ['crane', 'beach']), win('w', T + DAY), rush('r', T + 2 * DAY, [['beach'], ['crane'], ['storm'], ['house']])];
    const unlocks = computeAchievements(games, utcDay).filter((b) => b.id.startsWith('unlock-')).map((b) => [b.id, b.gameId]);
    expect(unlocks).toEqual([['unlock-two-player', 's'], ['unlock-solo-rush', 'w'], ['unlock-all-rush', 'r']]);
  });
});

describe('suggestVoidedFewGuesses', () => {
  it('says so only for a word found with Suggest, in few enough guesses for a badge', () => {
    expect(suggestVoidedFewGuesses(true, 10, 1)).toBe(true);
    expect(suggestVoidedFewGuesses(true, FEW_GUESSES[0], 1)).toBe(true);
    expect(suggestVoidedFewGuesses(true, FEW_GUESSES[0] + 1, 1)).toBe(false);
    expect(suggestVoidedFewGuesses(true, 10, 0)).toBe(false);
    expect(suggestVoidedFewGuesses(false, 10, 1)).toBe(false);
  });
});
