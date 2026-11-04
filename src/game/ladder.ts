import { pickGuessWithRecall } from './computer';
import { COMPUTER_RATINGS, computerForAverage, computerForRating, type RatedComputer } from './computerRatings';
import type { Difficulty } from './difficulty';
import type { ReplayedGame } from './history';
import type { TimeControl } from './pvp';
import { isProvisional, type Rating } from './rating';
import { evaluateGuess, type GuessResult } from './scoring';

/*
 * The rated ladder's computers (Dev Plan item 19p, README "Random
 * opponent"): a player in the Live 10 queue who isn't matched with a person
 * within 30 seconds plays a computer at about their level, labelled openly
 * as one. Its rating (`computerRatings.ts`) never changes.
 */

/** Which matchmaking queue: a time control and a difficulty. */
export interface QueueChoice {
  timeControl: TimeControl;
  difficulty: Difficulty;
}

/**
 * The rated ladder's one queue: Live 10 minutes each at Medium (the owner,
 * 3 November 2026), with queues per difficulty once there are enough players.
 */
export const LADDER_CHOICE: Readonly<QueueChoice> = { timeControl: '10m', difficulty: 'medium' };

/** How long the queue looks for a person before offering a computer. */
export const COMPUTER_AFTER_MS = 30_000;

/** The name a ladder computer plays under: openly a computer, never a made-up person. */
export const LADDER_COMPUTER_NAME = '🤖 Computer';

/** How sure a computer's rating is, for Glicko-2: measured over 20,000 solves, so far surer than any player's. */
export const COMPUTER_RD = 50;

/** A ladder computer's rating as Glicko-2 reads an opponent's. */
export const computerRating = (computer: Pick<RatedComputer, 'rating'>): Rating => ({ rating: computer.rating, rd: COMPUTER_RD, volatility: 0.06 });

/** The most recent words an average guesses per word is taken over, and the fewest it needs. */
export const LADDER_AVERAGE_WORDS = 20;
export const LADDER_AVERAGE_MIN_WORDS = 5;

/**
 * A player's average guesses per word for picking their first computers:
 * the last 20 words found in single player and the Daily Word (games played
 * to the end, so a word given up doesn't count), without Suggest, at any
 * difficulty, Easy included. Null with fewer than 5 such words. `games` in
 * any order: they're sorted by when each started.
 */
export function ladderAverage(games: readonly ReplayedGame[]): number | null {
  const found: { at: number; guesses: number }[] = [];
  for (const replayed of games) {
    if (replayed.mode === 'single') {
      const { game } = replayed;
      if (game.status === 'won' && game.suggested === 0) found.push({ at: game.startedAt, guesses: game.guesses.length });
    } else if (replayed.mode === 'dailyWord') {
      const word = replayed.game.results[0];
      if (word?.outcome === 'solved' && word.suggested === 0) found.push({ at: replayed.game.startedAt, guesses: word.guesses.length });
    }
  }
  if (found.length < LADDER_AVERAGE_MIN_WORDS) return null;
  const recent = found.sort((a, b) => a.at - b.at).slice(-LADDER_AVERAGE_WORDS);
  return recent.reduce((sum, w) => sum + w.guesses, 0) / recent.length;
}

/**
 * The computer a player gets: from their rating once it's settled; while
 * it's provisional, from their average guesses per word (`ladderAverage`),
 * or Expert without one. Never below Expert.
 */
export function ladderComputer(rating: Rating, average: number | null): RatedComputer {
  if (!isProvisional(rating)) return computerForRating(rating.rating);
  return average === null ? COMPUTER_RATINGS[0] : computerForAverage(average);
}

/** The shortest and longest pause before the computer's guess, from the start of its turn. */
export const COMPUTER_PAUSE_MS = [3_000, 8_000] as const;

/** One of the computer's guesses, and how long after its turn starts it's played. */
export interface PlannedGuess {
  word: string;
  pauseMs: number;
}

/**
 * Every guess a ladder computer will make at `secret` (the player's word),
 * worked out when the game starts: its guesses depend only on its own
 * scores against that word, never on the player's moves, as a lobby's
 * computers' do. The last one finds it. Each comes with a pause of 3 to 8
 * seconds, so it doesn't answer in an instant.
 */
export function planComputerGuesses(secret: string, recall: number, random: () => number): PlannedGuess[] {
  const history: GuessResult[] = [];
  const plan: PlannedGuess[] = [];
  const [shortest, longest] = COMPUTER_PAUSE_MS;
  for (;;) {
    const result = evaluateGuess(pickGuessWithRecall(history, recall, random), secret);
    history.push(result);
    plan.push({ word: result.guess, pauseMs: Math.round(shortest + random() * (longest - shortest)) });
    if (result.isWin) return plan;
  }
}
