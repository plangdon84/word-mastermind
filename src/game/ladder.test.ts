import { describe, expect, it } from 'vitest';
import { seededRandom } from './computerRatings';
import { parsePvpRecord } from './records';
import {
  COMPUTER_PAUSE_MS, computerRating, LADDER_CHOICE, ladderAverage, ladderComputer, planComputerGuesses,
} from './ladder';
import { createPvpGame, replayPvp, submitPvpGuess, toPvpRecord } from './pvp';
import { NEW_RATING, rateVsComputer, updateRating } from './rating';
import { scoreGuess } from './scoring';
import { matchesFilter, summarizeGame } from './history';
import { computeStats } from './stats';
import { DAY, dailyWord, friend, solo } from './testGames';
import { SECRET_WORDS } from './wordLists';

const T = Date.UTC(2026, 10, 3);
/** `n` guesses ending with the word (`beach`). */
const guesses = (n: number) => [...Array(n - 1)].map(() => 'crane').concat('beach');

describe('LADDER_CHOICE', () => {
  it('is the one queue: Live 10 at Medium', () => {
    expect(LADDER_CHOICE).toEqual({ timeControl: '10m', difficulty: 'medium' });
  });
});

describe('ladderAverage', () => {
  it('needs five words found', () => {
    const four = [1, 2, 3, 4].map((i) => solo(`s${i}`, T + i * DAY, guesses(8)).replayed);
    expect(ladderAverage(four)).toBeNull();
    expect(ladderAverage([...four, solo('s5', T + 5 * DAY, guesses(13)).replayed])).toBe(9);
  });

  it('takes single player and the Daily Word, found without Suggest, at any difficulty', () => {
    const games = [
      solo('a', T, guesses(10)),
      solo('b', T + 1, guesses(6), { difficulty: 'easy' }),
      dailyWord('c', '2026-11-03', T + 2, guesses(8)),
      solo('d', T + 3, guesses(12), { difficulty: 'extreme' }),
      solo('e', T + 4, guesses(4)),
      // Not counted: a word given up, Suggest, and other modes.
      solo('f', T + 5, ['crane'], { gaveUp: true }),
      solo('g', T + 6, ['beach'], { difficulty: 'easy', suggest: true }),
      friend('h', T + 7, { you: ['beach'], them: ['crane'] }),
    ].map((g) => g.replayed);
    expect(ladderAverage(games)).toBe((10 + 6 + 8 + 12 + 4) / 5);
  });

  it('takes the last 20 words found, by when each started', () => {
    const old = [...Array(10)].map((_, i) => solo(`old${i}`, T + i, guesses(30)).replayed);
    const recent = [...Array(20)].map((_, i) => solo(`new${i}`, T + DAY + i, guesses(9)).replayed);
    expect(ladderAverage([...recent, ...old])).toBe(9);
  });
});

describe('ladderComputer', () => {
  it('is Expert for a provisional player without an average, else by their average', () => {
    expect(ladderComputer(NEW_RATING, null).recall).toBe(0.38);
    expect(ladderComputer(NEW_RATING, 25).recall).toBe(0.38);
    expect(ladderComputer(NEW_RATING, 9.4).recall).toBe(0.6);
    expect(ladderComputer(NEW_RATING, 6).recall).toBe(1);
  });

  it('is by rating once it is settled, never below Expert', () => {
    expect(ladderComputer({ rating: 1800, rd: 80, volatility: 0.06 }, 25).recall).toBe(0.8);
    expect(ladderComputer({ rating: 1100, rd: 80, volatility: 0.06 }, 6).recall).toBe(0.38);
  });
});

describe('planComputerGuesses', () => {
  it('ends on the word, never repeats, and pauses 3 to 8 seconds a guess', () => {
    const random = seededRandom(9);
    for (const recall of [0.38, 1]) {
      const plan = planComputerGuesses('storm', recall, random);
      expect(plan.at(-1)!.word).toBe('storm');
      expect(new Set(plan.map((p) => p.word)).size).toBe(plan.length);
      for (const { word, pauseMs } of plan) {
        expect(SECRET_WORDS).toContain(word);
        expect(pauseMs).toBeGreaterThanOrEqual(COMPUTER_PAUSE_MS[0]);
        expect(pauseMs).toBeLessThanOrEqual(COMPUTER_PAUSE_MS[1]);
      }
    }
  });

  it('with full recall, each guess fits every score before it', () => {
    const plan = planComputerGuesses('storm', 1, seededRandom(3));
    plan.forEach(({ word }, i) => {
      for (const earlier of plan.slice(0, i)) expect(scoreGuess(earlier.word, word)).toBe(scoreGuess(earlier.word, 'storm'));
    });
  });
});

describe('rateVsComputer', () => {
  const computer = computerRating({ rating: 1673 });

  it('moves a settled rating half as far as against a person, win or lose', () => {
    const settled = { rating: 1700, rd: 60, volatility: 0.06 };
    for (const score of [0, 1] as const) {
      const full = updateRating(settled, [{ opponent: computer, score }]);
      const half = rateVsComputer(settled, computer, score);
      expect(half.rating - settled.rating).toBeCloseTo((full.rating - settled.rating) / 2, 9);
      expect(half.rd).toBe(full.rd);
    }
  });

  it('moves a provisional rating the full amount', () => {
    expect(rateVsComputer(NEW_RATING, computer, 1)).toEqual(updateRating(NEW_RATING, [{ opponent: computer, score: 1 }]));
  });

  it('leaves the rating alone on a draw', () => {
    const settled = { rating: 1700, rd: 60, volatility: 0.06 };
    const drawn = rateVsComputer(settled, computer, 0.5);
    expect(drawn.rating).toBe(1700);
    expect(drawn.volatility).toBe(0.06);
  });
});

describe('a ladder record', () => {
  it('keeps `ladder` through moves, saving and replaying, and reads it back', () => {
    const created = createPvpGame({ host: 'storm', guest: 'beach' }, 'host', T, '10m', { host: 'medium', guest: 'medium' }, true);
    if (!created.ok) throw new Error(created.error);
    const moved = submitPvpGuess({ ...created.game, ladder: { computer: 0.7 } }, 'host', 'crane', T + 1000);
    if (!moved.ok) throw new Error(moved.error);
    const record = toPvpRecord(moved.game);
    expect(record.ladder).toEqual({ computer: 0.7 });
    const replayed = replayPvp(record);
    expect(replayed.ok && replayed.game.ladder).toEqual({ computer: 0.7 });
    expect(parsePvpRecord(JSON.parse(JSON.stringify(record)))?.ladder).toEqual({ computer: 0.7 });
    expect(parsePvpRecord({ ...record, ladder: {} })?.ladder).toEqual({});
    expect(parsePvpRecord({ ...record, ladder: { computer: 2 } })).toBeNull();
    expect(parsePvpRecord({ ...record, ladder: 'yes' })).toBeNull();
    expect(parsePvpRecord({ ...record, ladder: undefined })?.ladder).toBeUndefined();
  });
});

describe('ladder games in the history and stats (review of PR #65)', () => {
  const won = { you: ['crane', 'beach'], them: ['house', 'crane'] };

  it('marks a ladder game, and leaves a computer out of the name search', () => {
    const computer = summarizeGame(friend('c', T, { ...won, opponent: '🤖 Computer', ladder: { computer: 0.5 } }).replayed);
    expect(computer.ladder).toBe('computer');
    expect(matchesFilter(computer, { name: 'comp' })).toBe(false);
    const person = summarizeGame(friend('p', T, { ...won, opponent: 'Bob', ladder: {} }).replayed);
    expect(person.ladder).toBe('person');
    expect(matchesFilter(person, { name: 'bo' })).toBe(true);
    expect(summarizeGame(friend('f', T, won).replayed).ladder).toBeUndefined();
  });

  it('keeps a ladder computer game out of friend stats, but in the overall win rate', () => {
    const stats = computeStats([
      friend('f', T, won),
      friend('c', T + DAY, { you: ['crane'], them: ['storm'], ladder: { computer: 1 } }),
    ], T + 2 * DAY);
    expect(stats.modes.friend.played).toBe(1);
    expect(stats.winPct).toBe(50);
  });
});
