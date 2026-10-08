import { dayStart, ordinal, strengthForAverage, type DailyDay, type Difficulty, type Strength } from '../game';
import { DIFFICULTY_LABEL, STRENGTH_LABEL } from './components';
import { guessCount } from './messages';

/**
 * The results a player can share (Dev Plan item 18k): short and spoiler-free,
 * so never a word, a guess or a day's theme. Each ends with the address.
 */

export const SHARE_ADDRESS = 'wordmastermind.app';

/** Daily Rush #1: the first day in the calendar (kept in a private repo; README "Daily Rush"). */
const FIRST_DAILY: DailyDay = '2026-10-01';

/** A day's number, counting the calendar's first day as #1. */
export const dailyNumber = (day: DailyDay): number =>
  Math.round((dayStart(day) - dayStart(FIRST_DAILY)) / 86_400_000) + 1;

/** A word's emoji: the computer strength its guesses match (`strengthForAverage`), black if not found. */
const WORD_EMOJI: Record<Strength, string> = {
  mastermind: '🟩', expert: '🟨', skilled: '🟧', casual: '🟥',
};
const NOT_FOUND = '⬛';

/** A word as shared: its guesses, and whether it was found. */
export interface SharedWord {
  guesses: number;
  found: boolean;
}

/** One emoji per word, in the order played. */
export const wordEmoji = (words: readonly SharedWord[]) =>
  words.map((w) => (w.found ? WORD_EMOJI[strengthForAverage(w.guesses)] : NOT_FOUND)).join('');

/** "Daily Rush #2 · Hard", the emoji, "23 guesses · 12th of 340 · better than 96%". */
export function dailyShareText({ day, difficulty, words, place }: {
  day: DailyDay;
  difficulty: Difficulty;
  words: readonly SharedWord[];
  /** `placeText`, once the server has sent it. */
  place: string | null;
}): string {
  const total = words.reduce((sum, w) => sum + w.guesses, 0);
  return [
    `Word Mastermind Daily Set #${dailyNumber(day)} · ${DIFFICULTY_LABEL[difficulty]}`,
    wordEmoji(words),
    guessCount(total) + (place ? ` · ${place}` : ''),
    SHARE_ADDRESS,
  ].join('\n');
}

/** "Solo Rush · Medium", the emoji, "Score 11.3 · Expert level". */
export function soloRushShareText({ difficulty, words, score, level }: {
  difficulty: Difficulty;
  words: readonly SharedWord[];
  score: number;
  level: Strength;
}): string {
  return [
    `Word Mastermind Solo Rush · ${DIFFICULTY_LABEL[difficulty]}`,
    wordEmoji(words),
    `Score ${score.toFixed(1)} · ${STRENGTH_LABEL[level]} level`,
    SHARE_ADDRESS,
  ].join('\n');
}

/**
 * A shared two player result, from your side: a win, a clutch draw (they
 * found your word first and your final guess found theirs), or the other
 * side of it, a draw they found with their final guess. Draws are 🔥 either way.
 */
export type SharedResult = 'won' | 'clutch' | 'tied';

/**
 * Against the computer: "I beat the computer (Expert) in 9 guesses on Hard 🏆",
 * "Clutch! I tied the computer (Expert) with my last guess: 12 guesses on Hard 🔥"
 * or "Clutch! The computer (Expert) found the draw with its last guess: …".
 */
export const twoPlayerShareText = ({ strength, difficulty, guesses, result = 'won' }: {
  strength: Strength;
  difficulty: Difficulty;
  guesses: number;
  result?: SharedResult;
}): string => resultText({ name: `the computer (${STRENGTH_LABEL[strength]})`, its: 'its' }, difficulty, guesses, result);

/** The same against a friend, by name: "Clutch! Sam found the draw with their last guess: …". */
export const friendShareText = ({ opponent, difficulty, guesses, result = 'won' }: {
  /** Their name, as the result shows it. */
  opponent: string;
  difficulty: Difficulty;
  guesses: number;
  result?: SharedResult;
}): string => resultText({ name: opponent, its: 'their' }, difficulty, guesses, result);

/** `guesses` is always yours. */
function resultText(them: { name: string; its: string }, difficulty: Difficulty, guesses: number, result: SharedResult): string {
  const how = `${guessCount(guesses)} on ${DIFFICULTY_LABEL[difficulty]}`;
  const capitalized = them.name.charAt(0).toUpperCase() + them.name.slice(1);
  return [
    'Word Mastermind',
    {
      won: `I beat ${them.name} in ${how} 🏆`,
      clutch: `Clutch! I tied ${them.name} with my last guess: ${how} 🔥`,
      tied: `Clutch! ${capitalized} found the draw with ${them.its} last guess: ${how} 🔥`,
    }[result],
    SHARE_ADDRESS,
  ].join('\n');
}

/** A lobby player as shared: their place, name and words. */
export interface SharedPlayer {
  rank: number;
  name: string;
  /** A computer player's strength; null for a person. */
  strength: Strength | null;
  you: boolean;
  words: readonly SharedWord[];
}

/**
 * A finished lobby, everyone in it, best first:
 * "I came in 2nd place in Word Mastermind Rush with Friends!", then a row per
 * player, "1st 🟩🟨🟩🟧 41 guesses Sam" (the emoji before the name, so they
 * line up), and the address.
 */
export function lobbyShareText({ mode, players }: {
  /** "Rush with Friends" or "Competitive Rush". */
  mode: string;
  players: readonly SharedPlayer[];
}): string {
  const you = players.find((p) => p.you)!;
  const tied = players.filter((p) => p.rank === you.rank).length > 1;
  const place = `${ordinal(you.rank)} place`;
  return [
    `I ${tied ? 'tied for' : 'came in'} ${place} in Word Mastermind ${mode}!`,
    ...players.map((p) => [
      ordinal(p.rank),
      wordEmoji(p.words),
      guessCount(p.words.reduce((sum, w) => sum + w.guesses, 0)),
      p.strength ? `${p.name} (${STRENGTH_LABEL[p.strength]})` : p.name,
    ].join(' ')),
    SHARE_ADDRESS,
  ].join('\n');
}
