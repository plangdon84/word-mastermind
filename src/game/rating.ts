import { DAY_MS, type PvpOutcome, type Seat, type TimeControl } from './pvp';

/*
 * Ratings (README "Rating"): Glicko-2 (Mark Glickman,
 * http://www.glicko.net/glicko/glicko2.pdf), applied by the server to the
 * results it recorded. Like the rest of the game logic, it never reads the
 * clock: the time is passed in.
 */

/** A player's rating in one pool, on the familiar scale (a new player is 1500 ± 350). */
export interface Rating {
  rating: number;
  /** Rating deviation: how uncertain the rating is, in rating points (like a standard deviation). */
  rd: number;
  /** How erratic the player's results are; it sets how fast `rd` grows back. */
  volatility: number;
}

export const NEW_RATING: Readonly<Rating> = { rating: 1500, rd: 350, volatility: 0.06 };

/** Glicko-2's system constant: how fast volatility may change (0.3 to 1.2 is usual). */
export const TAU = 0.5;

/** Over this RD, a rating is provisional: shown with a "?", as Lichess does. */
export const PROVISIONAL_RD = 110;

/**
 * Each game is its own rating period. Time away counts as one empty period
 * per week, which widens RD, so a returning player's first games move them
 * more.
 */
export const IDLE_PERIOD_MS = 7 * DAY_MS;

/** Glicko-2's internal scale: 400 / ln 10 rating points per unit. */
const SCALE = 173.7178;
const CONVERGENCE = 1e-6;

/**
 * Each live clock has its own rating, as blitz and rapid do in chess;
 * correspondence (1 or 3 days per guess) has one, and so does Competitive
 * Rush.
 */
export const RATING_POOLS = ['15m', '10m', '5m', 'correspondence', 'rush'] as const;
export type RatingPool = (typeof RATING_POOLS)[number];

export const isRatingPool = (value: unknown): value is RatingPool => RATING_POOLS.includes(value as RatingPool);

export const ratingPool = (control: TimeControl): RatingPool => (control.endsWith('d') ? 'correspondence' : control as RatingPool);

export const isProvisional = (rating: Rating) => rating.rd > PROVISIONAL_RD;

/** One result in a rating period: the opponent's rating going in, and the score (1 win, ½ draw, 0 loss). */
export interface RatedResult {
  opponent: Rating;
  score: 0 | 0.5 | 1;
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/** Widens RD for `periods` rating periods without games, never past a new player's. */
function widen(rating: Rating, periods: number): Rating {
  const phi = rating.rd / SCALE;
  const widened = Math.sqrt(phi * phi + periods * rating.volatility * rating.volatility) * SCALE;
  return { ...rating, rd: Math.min(widened, NEW_RATING.rd) };
}

/** A rating after `idleMs` without a rated game: one empty period per whole week. */
export function ageRating(rating: Rating, idleMs: number): Rating {
  const periods = Math.floor(Math.max(0, idleMs) / IDLE_PERIOD_MS);
  return periods === 0 ? rating : widen(rating, periods);
}

/**
 * The new volatility (step 5 of Glickman's paper): the root of f by the
 * Illinois method.
 */
function newVolatility(phi: number, sigma: number, v: number, delta: number, tau: number): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const d = phi * phi + v + ex;
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * d * d) - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > CONVERGENCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * A player's rating after one rating period's results, every opponent
 * rated as they were going in. No results widens RD for the period only.
 */
export function updateRating(player: Rating, results: readonly RatedResult[], tau = TAU): Rating {
  if (results.length === 0) return widen(player, 1);
  const mu = (player.rating - NEW_RATING.rating) / SCALE;
  const phi = player.rd / SCALE;
  let vInverse = 0;
  let sum = 0;
  for (const { opponent, score } of results) {
    const phij = opponent.rd / SCALE;
    const e = expected(mu, (opponent.rating - NEW_RATING.rating) / SCALE, phij);
    vInverse += g(phij) ** 2 * e * (1 - e);
    sum += g(phij) * (score - e);
  }
  const v = 1 / vInverse;
  const volatility = newVolatility(phi, player.volatility, v, v * sum, tau);
  const phiStar = Math.sqrt(phi * phi + volatility * volatility);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  return {
    rating: (mu + phiNew * phiNew * sum) * SCALE + NEW_RATING.rating,
    rd: phiNew * SCALE,
    volatility,
  };
}

/**
 * Both players' ratings after one game between them, `scoreA` being A's
 * score. A draw changes neither rating nor volatility (README "Rating",
 * issue #131): it still counts as a game, so RD narrows as Glicko-2 has it.
 */
export function rateGame(a: Rating, b: Rating, scoreA: 0 | 0.5 | 1): [Rating, Rating] {
  const scoreB = (1 - scoreA) as 0 | 0.5 | 1;
  const rated: [Rating, Rating] = [updateRating(a, [{ opponent: b, score: scoreA }]), updateRating(b, [{ opponent: a, score: scoreB }])];
  return scoreA === 0.5
    ? [{ ...rated[0], rating: a.rating, volatility: a.volatility }, { ...rated[1], rating: b.rating, volatility: b.volatility }]
    : rated;
}

/** One player's score against another by their places: the better place wins, the same place draws. */
export const placeScore = (place: number, other: number): 0 | 0.5 | 1 => (place < other ? 1 : place === other ? 0.5 : 0);

/**
 * Everyone's ratings after one game of several players (Competitive Rush),
 * in the same order: each pair of players is a result by their final places
 * (1 for a lower place, a draw for a shared one), all in one rating period,
 * every opponent rated as they were going in.
 */
export function rateGroup(players: readonly { rating: Rating; place: number }[], tau = TAU): Rating[] {
  return players.map((player, i) => updateRating(player.rating, players.filter((_, j) => j !== i)
    .map((other) => ({ opponent: other.rating, score: placeScore(player.place, other.place) })), tau));
}

/** The host's score in a finished game: a draw counts as half a win; conceding or timing out loses. */
export const hostScore = (outcome: PvpOutcome): 0 | 0.5 | 1 =>
  outcome.winner === null ? 0.5 : outcome.winner === ('host' satisfies Seat) ? 1 : 0;

/** The most `gamesUntilListed` counts to. */
export const MAX_GAMES_UNTIL_LISTED = 30;

/**
 * About how many more rated games until a provisional rating is listed on
 * its board (RD at or under 110): drawn games against an established
 * player of the same rating, as a typical opponent. 0 once it's listed.
 */
export function gamesUntilListed(rating: Rating): number {
  let current = rating;
  let games = 0;
  while (isProvisional(current) && games < MAX_GAMES_UNTIL_LISTED) {
    current = updateRating(current, [{ opponent: { ...current, rd: PROVISIONAL_RD }, score: 0.5 }]);
    games++;
  }
  return games;
}
