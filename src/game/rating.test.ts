import { describe, expect, it } from 'vitest';
import { DAY_MS } from './pvp';
import {
  ageRating, gamesUntilListed, hostScore, isProvisional, placeScore, rateGroup, MAX_GAMES_UNTIL_LISTED, NEW_RATING, rateGame, ratingPool, updateRating, type Rating,
} from './rating';

describe('updateRating', () => {
  it("matches the worked example in Glickman's Glicko-2 paper", () => {
    const player = { rating: 1500, rd: 200, volatility: 0.06 };
    const updated = updateRating(player, [
      { opponent: { rating: 1400, rd: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, rd: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, rd: 300, volatility: 0.06 }, score: 0 },
    ]);
    expect(updated.rating).toBeCloseTo(1464.06, 1);
    expect(updated.rd).toBeCloseTo(151.52, 1);
    // The paper rounds it to 0.05999.
    expect(updated.volatility).toBeCloseTo(0.059996, 6);
  });

  it('only widens RD for a period without games', () => {
    const player = { rating: 1600, rd: 50, volatility: 0.06 };
    const idle = updateRating(player, []);
    expect(idle.rating).toBe(1600);
    expect(idle.rd).toBeCloseTo(Math.sqrt(50 ** 2 + (0.06 * 173.7178) ** 2), 6);
  });
});

describe('rateGame', () => {
  it('moves an uncertain rating far more than an established one', () => {
    const settled: Rating = { rating: 1500, rd: 50, volatility: 0.06 };
    const [winner, loser] = rateGame(NEW_RATING, settled, 1);
    expect(winner.rating - 1500).toBeCloseTo(175.1, 1);
    expect(1500 - loser.rating).toBeLessThan(10);
    expect(winner.rd).toBeLessThan(NEW_RATING.rd);
  });

  it('gives equal players an even draw, narrowing both', () => {
    const [a, b] = rateGame(NEW_RATING, NEW_RATING, 0.5);
    expect(a.rating).toBeCloseTo(1500, 6);
    expect(b).toEqual(a);
    expect(a.rd).toBeLessThan(350);
  });

  it('leaves both ratings where they were after a draw between unequal players, still narrowing both', () => {
    const strong: Rating = { rating: 1700, rd: 120, volatility: 0.06 };
    const weak: Rating = { rating: 1400, rd: 200, volatility: 0.06 };
    const [a, b] = rateGame(strong, weak, 0.5);
    expect(a.rating).toBe(1700);
    expect(b.rating).toBe(1400);
    expect([a.volatility, b.volatility]).toEqual([strong.volatility, weak.volatility]);
    expect(a.rd).toBeLessThan(strong.rd);
    expect(b.rd).toBeLessThan(weak.rd);
  });

  it('rewards beating a stronger player more than a weaker one', () => {
    const me = { rating: 1500, rd: 100, volatility: 0.06 };
    const up = rateGame(me, { rating: 1700, rd: 100, volatility: 0.06 }, 1)[0].rating;
    const down = rateGame(me, { rating: 1300, rd: 100, volatility: 0.06 }, 1)[0].rating;
    expect(up - 1500).toBeGreaterThan(down - 1500);
  });
});

describe('ageRating', () => {
  const settled = { rating: 1500, rd: 50, volatility: 0.06 };

  it('adds one empty rating period per whole week away', () => {
    expect(ageRating(settled, 6 * DAY_MS)).toBe(settled);
    expect(ageRating(settled, 15 * DAY_MS).rd).toBeCloseTo(updateRating(updateRating(settled, []), []).rd, 6);
  });

  it("never widens RD past a new player's", () => {
    expect(ageRating(settled, 10_000 * DAY_MS).rd).toBe(350);
  });
});

describe('pools and results', () => {
  it('rates each live clock on its own, and correspondence as one', () => {
    expect(ratingPool('5m')).toBe('5m');
    expect(ratingPool('15m')).toBe('15m');
    expect(ratingPool('1d')).toBe('correspondence');
    expect(ratingPool('3d')).toBe('correspondence');
  });

  it('marks ratings provisional until RD falls to 110', () => {
    expect(isProvisional(NEW_RATING)).toBe(true);
    expect(isProvisional({ ...NEW_RATING, rd: 110 })).toBe(false);
  });

  it("scores the host's side of a game", () => {
    expect(hostScore({ winner: 'host', reason: 'found' })).toBe(1);
    expect(hostScore({ winner: 'guest', reason: 'timed-out' })).toBe(0);
    expect(hostScore({ winner: null, reason: 'draw' })).toBe(0.5);
  });
});

describe('gamesUntilListed', () => {
  it('counts the rated games until a provisional rating is listed', () => {
    expect(gamesUntilListed(NEW_RATING)).toBe(11);
    expect(gamesUntilListed({ rating: 1500, rd: 150, volatility: 0.06 })).toBe(6);
    expect(gamesUntilListed({ rating: 1500, rd: 111, volatility: 0.06 })).toBe(1);
    expect(gamesUntilListed({ rating: 1500, rd: 100, volatility: 0.06 })).toBe(0);
  });

  it('stops counting at a limit', () => {
    expect(gamesUntilListed({ ...NEW_RATING, volatility: 2 })).toBe(MAX_GAMES_UNTIL_LISTED);
  });
});

describe('rateGroup', () => {
  const settled = { rating: 1500, rd: 80, volatility: 0.06 };

  it('rates each pair by their places, as one rating period', () => {
    const [first, second, third] = rateGroup([
      { rating: settled, place: 1 }, { rating: settled, place: 2 }, { rating: settled, place: 3 },
    ]);
    expect(first.rating).toBeGreaterThan(1500);
    expect(second.rating).toBeCloseTo(1500, 6);
    expect(third.rating).toBeLessThan(1500);
    expect(first.rating - 1500).toBeCloseTo(1500 - third.rating, 6);
    // The same as rating the game's results one by one, in one period.
    expect(first).toEqual(updateRating(settled, [{ opponent: settled, score: 1 }, { opponent: settled, score: 1 }]));
  });

  it('draws a shared place, and a two-player group is one game', () => {
    const [a, b] = rateGroup([{ rating: NEW_RATING, place: 1 }, { rating: NEW_RATING, place: 1 }]);
    expect(a).toEqual(b);
    expect(a.rating).toBeCloseTo(1500, 6);
    expect(rateGroup([{ rating: NEW_RATING, place: 1 }, { rating: settled, place: 2 }]))
      .toEqual(rateGame(NEW_RATING, settled, 1));
    expect([placeScore(1, 2), placeScore(2, 2), placeScore(3, 2)]).toEqual([1, 0.5, 0]);
  });
});
