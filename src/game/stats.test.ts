import { describe, expect, it } from 'vitest';
import { replayEntry, type HistoryEntry } from './history';
import { computeStats, IDLE_CAP_MS } from './stats';
import type { Strength } from './computer';
import { daily, DAY, friend, friendEntry, lobby, rush, solo, soloEntry, versus } from './testGames';
import { GUESS_WORDS, SECRET_WORDS } from './wordLists';

const T = Date.UTC(2026, 0, 1);
const NOW = T + 100 * DAY;

// vs. Computer: your word is `storm`, the computer's `beach`.
const win = (id: string, at: number, strength: Strength = 'skilled') =>
  versus(id, at, { first: 'human', you: ['crane', 'beach'], computer: ['house', 'teach'], strength });
const loss = (id: string, at: number) =>
  versus(id, at, { first: 'computer', computer: ['house', 'storm'], you: ['crane', 'teach'] });
const draw = (id: string, at: number) =>
  versus(id, at, { first: 'computer', computer: ['storm'], you: ['beach'] });
const conceded = (id: string, at: number) =>
  versus(id, at, { first: 'human', you: ['crane'], computer: ['house'], concede: true });

describe('computeStats', () => {
  it('has nothing to show with no games', () => {
    const stats = computeStats([], NOW);
    expect(stats.played).toBe(0);
    expect(stats.winPct).toBeNull();
    expect(stats.modes.single).toMatchObject({ played: 0, averageGuesses: null, best: null, fastest: null, record: null });
    expect(stats.modes.computer.record).toMatchObject({ wins: 0, winPct: null, currentStreak: 0, bestStreak: 0 });
    expect(stats.topGuesses).toEqual([]);
  });

  it('averages single-player games without the ones given up, and ranks the best by difficulty', () => {
    const stats = computeStats([
      solo('a', T, ['crane', 'house', 'teach', 'cheap', 'truck', 'beach']),
      solo('b', T + DAY, ['crane', 'house', 'teach', 'cheap', 'beach'], { difficulty: 'hard' }),
      solo('c', T + 2 * DAY, ['crane', 'house'], { gaveUp: true }),
      solo('d', T + 3 * DAY, ['crane', 'teach', 'cheap', 'truck', 'beach']),
    ], NOW);
    const single = stats.modes.single;
    expect(single).toMatchObject({ played: 4, gaveUp: 1, averageGuesses: 16 / 3, record: null });
    // 5 guesses at Hard (× 0.9) beats 5 at Medium.
    expect(single.best).toEqual({ id: 'b', value: 4.5 });
    // Moves are 10 seconds apart, so the fewest guesses is also the fastest; the earliest wins a tie.
    expect(single.fastest).toEqual({ id: 'b', value: 50 });
    expect(stats.winPct).toBeNull();
  });

  it('keeps a win record against the computer, with give-ups as losses', () => {
    const stats = computeStats([
      win('w1', T, 'expert'), loss('l1', T + DAY), win('w2', T + 2 * DAY, 'mastermind'),
      win('w3', T + 3 * DAY), draw('d1', T + 4 * DAY), conceded('g1', T + 5 * DAY), win('w4', T + 6 * DAY),
    ], NOW);
    const { computer } = stats.modes;
    expect(computer.record).toMatchObject({ wins: 4, draws: 1, losses: 2, winPct: (4 / 7) * 100 });
    expect(computer.record).toMatchObject({ currentStreak: 1, bestStreak: 2 });
    expect(computer.record!.byStrength!.mastermind).toEqual({ wins: 1, draws: 0, losses: 0, winPct: 100 });
    expect(computer.record!.byStrength!.skilled).toEqual({ wins: 2, draws: 1, losses: 2, winPct: 40 });
    expect(computer.record!.byStrength!.casual.winPct).toBeNull();
    expect(computer.gaveUp).toBe(1);
    // Found in 2 in each win and 1 in the draw.
    expect(computer.averageGuesses).toBeCloseTo(9 / 5);
    expect(computer.best).toEqual({ id: 'w1', value: 2 });
    // The draw's hit was your first guess, 10 seconds into your turn; a win's took two turns.
    expect(computer.fastest).toEqual({ id: 'd1', value: 10 });
    expect(stats.winPct).toBe(computer.record!.winPct);
  });

  it('averages a Rush per word, penalties included, and leaves a Rush with no score out', () => {
    const stats = computeStats([
      rush('r1', T, [['beach'], ['crane'], ['house', 'storm'], ['house']]),
      rush('r2', T + DAY, [['beach'], 'give-up', ['storm'], ['house']]),
      rush('r3', T + 2 * DAY, [['beach']], { end: true }),
    ], NOW);
    const r = stats.modes.rush;
    expect(r).toMatchObject({ played: 3, gaveUp: 1 });
    // r1: 1, 1, 2, 1. r2: 1, 1 + 10 penalty, 1, 1.
    expect(r.averageGuesses).toBeCloseTo((5 + 14) / 8);
    expect(r.best).toEqual({ id: 'r1', value: 1.25 });
    expect(r.fastest?.value).toBe(10);
  });

  it('counts games by the easiest difficulty, every guess, and the time played', () => {
    const stats = computeStats([
      solo('a', T, ['beach'], { difficulty: 'extreme' }),
      rush('r', T, [['beach'], ['crane'], ['storm'], ['house']], { difficulty: 'hard' }),
      win('w', T),
    ], NOW);
    expect(stats.byDifficulty).toEqual({ easy: 0, medium: 1, hard: 1, extreme: 1 });
    expect(stats.played).toBe(3);
    expect(stats.totalGuesses).toBe(1 + 4 + 2);
    // vs. Computer: your two turns only, not the computer's.
    expect(stats.secondsPlayed).toBe(10 + 40 + 20);
  });

  it("counts only your turns against an opponent, so a game over days isn't days played", () => {
    const slow = versus('s', T, {
      first: 'computer', computer: ['house', 'teach', 'cheap'], you: ['crane', 'truck', 'beach'], theirTurn: DAY,
    });
    const stats = computeStats([slow], NOW);
    // Three turns of 10 seconds each, though the game took three days.
    expect(stats.secondsPlayed).toBe(30);
    expect(stats.modes.computer.fastest).toEqual({ id: 's', value: 30 });
  });

  it('counts at most 5 minutes between moves, so a game left open is not hours played', () => {
    // Single player: three guesses an hour apart count 5 minutes each.
    const left = solo('s', T, ['crane', 'house', 'beach'], { step: 60 * 60 * 1000 });
    // vs. a friend: you guess at +10s, they at +20s, and you come back 2 hours later.
    const entry = friendEntry('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'] });
    if (entry.mode !== 'friend') throw new Error('not a friend game');
    const moves = entry.record.moves.map((m, i) => (i < 2 ? m : { ...m, at: m.at + 2 * 60 * 60 * 1000 }));
    const away = replayEntry({ ...entry, record: { ...entry.record, moves } });
    if (!away) throw new Error('does not replay');
    expect(computeStats([left], NOW).secondsPlayed).toBe(3 * 5 * 60);
    // Your first turn in full; your second, 2 hours and 10 seconds, counts 5 minutes.
    expect(computeStats([{ id: 'f', replayed: away }], NOW).secondsPlayed).toBe(10 + 5 * 60);
    expect(IDLE_CAP_MS).toBe(5 * 60 * 1000);
  });

  it("doesn't count an Easy suggestion on your friend's turn as your time", () => {
    // You (host) guess at +10s and +30s; your friend at +20s. You take a suggestion
    // at +15s, early in your friend's turn: your turns are still 10 seconds each.
    const entry = friendEntry('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'], difficulty: 'easy' });
    if (entry.mode !== 'friend') throw new Error('not a friend game');
    const moves = [...entry.record.moves];
    moves.splice(1, 0, { seat: 'host', kind: 'suggest', word: 'peach', at: T + 15_000 });
    const game = replayEntry({ ...entry, record: { ...entry.record, moves } });
    if (!game) throw new Error('does not replay');
    expect(computeStats([{ id: 'f', replayed: game }], NOW).secondsPlayed).toBe(20);
  });

  it('lists the ten most used guesses, cutting a tie for tenth alphabetically', () => {
    const words = ['crane', 'house', 'teach', 'cheap', 'truck', 'world', 'light', 'mouse', 'zebra', 'quick', 'night', 'peach'];
    const games = [
      solo('a', T, [...words, 'beach']),
      solo('b', T + 1, ['crane', 'house', 'beach']),
    ];
    const top = computeStats(games, NOW).topGuesses;
    expect(top.slice(0, 3)).toEqual([{ word: 'beach', count: 2 }, { word: 'crane', count: 2 }, { word: 'house', count: 2 }]);
    // Ten words guessed once share 4th to 13th place; the first seven alphabetically make the list.
    expect(top.map((g) => g.word).slice(3)).toEqual(['cheap', 'light', 'mouse', 'night', 'peach', 'quick', 'teach']);
    expect(computeStats([solo('a', T, ['crane', 'beach'])], NOW).topGuesses).toHaveLength(2);
  });

  it('shows a trend only with 5 games in each 30 days', () => {
    const recent = (n: number) => [...Array(n)].map((_, i) => win(`n${i}`, NOW - (i + 1) * DAY));
    const before = (n: number) => [...Array(n)].map((_, i) => loss(`o${i}`, NOW - (31 + i) * DAY));
    const both = computeStats([...before(5), ...recent(5)], NOW).modes.computer;
    expect(both.record!.winPctTrend).toEqual({ current: 100, previous: 0, change: 100 });
    // Found in 2 in each win, and never in a loss, so there's no earlier average to compare.
    expect(both.averageTrend).toBeNull();
    expect(computeStats([...before(4), ...recent(5)], NOW).modes.computer.record!.winPctTrend).toBeNull();

    const soloGames = [
      ...[...Array(5)].map((_, i) => solo(`s${i}`, NOW - (i + 1) * DAY, ['crane', 'beach'])),
      ...[...Array(5)].map((_, i) => solo(`t${i}`, NOW - (31 + i) * DAY, ['crane', 'house', 'teach', 'beach'])),
    ];
    // Fewer guesses than before: the average went down by 2.
    expect(computeStats(soloGames, NOW).modes.single.averageTrend).toEqual({ current: 2, previous: 4, change: -2 });
  });
});

describe('computeStats speed', () => {
  // Real-looking games: 4 to 20 guesses from the guess list, then the secret.
  const entries = (count: number): HistoryEntry[] =>
    [...Array(count)].map((_, i) => {
      const secret = SECRET_WORDS[(i * 7919) % SECRET_WORDS.length];
      const guesses = [...Array(4 + (i % 17))].map((_, j) => GUESS_WORDS[(i * 31 + j * 997) % GUESS_WORDS.length])
        .filter((w) => w !== secret);
      return soloEntry(`g${i}`, T + i * 60_000, [...guesses, secret], { secret });
    });

  for (const count of [1_000, 10_000]) {
    it(`handles ${count.toLocaleString('en')} games, replaying them first`, () => {
      const list = entries(count);
      const start = performance.now();
      const stats = computeStats(list.map((e) => ({ id: e.id, replayed: replayEntry(e)! })), NOW);
      const ms = performance.now() - start;
      console.info(`replay + computeStats: ${count} games in ${ms.toFixed(0)} ms`);
      expect(stats.played).toBe(count);
      // Generous, for slow CI machines; the time logged above is what to watch.
      expect(ms).toBeLessThan(count === 1_000 ? 500 : 5_000);
    });
  }
});

describe("the server's modes", () => {
  it('count games against a friend like the computer, in the headline win % too', () => {
    const stats = computeStats([
      win('c1', T),
      friend('f1', T + DAY, { you: ['crane', 'beach'], them: ['house', 'crane'] }),
      friend('f2', T + 2 * DAY, { first: 'them', them: ['storm'], you: ['crane'] }),
    ], NOW);
    expect(stats.modes.friend.record).toMatchObject({ wins: 1, draws: 0, losses: 1, byStrength: null });
    expect(stats.modes.computer.played).toBe(1);
    expect(stats.modes.friend.best).toEqual({ id: 'f1', value: 2 });
    expect(stats.winPct).toBeCloseTo((2 / 3) * 100);
  });

  it("leaves a win out of the best win when you didn't find their word", () => {
    // They give up after your first guess: a win in 1, but not a find.
    const gaveUp = friendEntry('f1', T, { you: ['crane'], them: ['house'] });
    if (gaveUp.mode !== 'friend') throw new Error('a friend game');
    const record = { ...gaveUp.record, moves: [...gaveUp.record.moves, { seat: 'guest' as const, kind: 'concede' as const, at: T + DAY }] };
    const stats = computeStats([
      { id: 'f1', replayed: replayEntry({ ...gaveUp, record })! },
      friend('f2', T + 2 * DAY, { you: ['crane', 'beach'], them: ['house', 'crane'] }),
    ], NOW);
    expect(stats.modes.friend.record).toMatchObject({ wins: 2 });
    expect(stats.modes.friend.best).toEqual({ id: 'f2', value: 2 });
  });

  it("count a Daily Rush's total guesses as its best, and a lobby's first places", () => {
    const words = [['beach'], ['crane', 'crane'], ['storm'], ['house']];
    const stats = computeStats([
      daily('d1', '2026-01-01', T, words),
      lobby('l1', T + DAY, words, { rank: 1 }),
      lobby('l2', T + 2 * DAY, words, { rank: 3 }),
    ], NOW);
    expect(stats.modes.daily).toMatchObject({ played: 1, best: { id: 'd1', value: 5 }, averageGuesses: 1.25 });
    expect(stats.modes.lobby).toMatchObject({ played: 2, firsts: 1, record: null, best: { id: 'l1', value: 5 } });
  });
});
