import { describe, expect, it } from 'vitest';
import {
  dailyNumber, dailyShareText, friendShareText, lobbyShareText, soloRushShareText, twoPlayerShareText, wordEmoji,
} from './shareText';

describe('dailyNumber', () => {
  it("counts the calendar's first day as #1", () => {
    expect(dailyNumber('2026-10-01')).toBe(1);
    expect(dailyNumber('2026-10-02')).toBe(2);
    expect(dailyNumber('2027-10-01')).toBe(366);
  });
});

describe('wordEmoji', () => {
  it("colours each word by the computer strength its guesses match, black if it wasn't found", () => {
    expect(wordEmoji([
      { guesses: 9, found: true },
      { guesses: 10, found: true },
      { guesses: 20, found: true },
      { guesses: 21, found: true },
      { guesses: 30, found: false },
    ])).toBe('🟩🟨🟧🟥⬛');
  });
});

describe('dailyShareText', () => {
  const words = [4, 12, 7, 18].map((guesses) => ({ guesses, found: true }));

  it('gives the day, difficulty, emoji, total and place, and nothing about the words', () => {
    expect(dailyShareText({ day: '2026-10-02', difficulty: 'hard', words, place: '12th of 340 · better than 96%' }))
      .toBe('Word Mastermind Daily Set #2 · Hard\n🟩🟨🟩🟧\n41 guesses · 12th of 340 · better than 96%\nwordmastermind.app');
  });

  it('leaves the place out until it is known', () => {
    expect(dailyShareText({ day: '2026-10-02', difficulty: 'medium', words, place: null }).split('\n')[2])
      .toBe('41 guesses');
  });

  it("names the Daily Word, numbered as the day's Daily Set is, with one emoji", () => {
    expect(dailyShareText({ mode: 'dailyWord', day: '2026-10-12', difficulty: 'easy', words: [{ guesses: 6, found: true }], place: '3rd of 40 · better than 94%' }))
      .toBe('Word Mastermind Daily Word #12 · Easy\n🟩\n6 guesses · 3rd of 40 · better than 94%\nwordmastermind.app');
  });
});

describe('soloRushShareText', () => {
  it('gives the difficulty, emoji, score and level', () => {
    expect(soloRushShareText({
      difficulty: 'medium',
      words: [{ guesses: 8, found: true }, { guesses: 14, found: true }, { guesses: 6, found: false }, { guesses: 11, found: true }],
      score: 11.25,
      level: 'expert',
    })).toBe('Word Mastermind Solo Crush · Medium\n🟩🟨⬛🟨\nScore 11.3 · Expert level\nwordmastermind.app');
  });

  it('gives a Solo Rush its score as a time', () => {
    expect(soloRushShareText({
      difficulty: 'hard',
      rankBy: 'rush',
      words: [{ guesses: 8, found: true }],
      score: 125.4,
      level: 'skilled',
    })).toBe('Word Mastermind Solo Rush · Hard\n🟩\nScore 2:05 · Skilled level\nwordmastermind.app');
  });
});

describe('twoPlayerShareText', () => {
  it('gives the strength, difficulty and guesses', () => {
    expect(twoPlayerShareText({ strength: 'expert', difficulty: 'hard', guesses: 9 }))
      .toBe('Word Mastermind\nI beat the computer (Expert) in 9 guesses on Hard 🏆\nwordmastermind.app');
  });
});

describe('friendShareText', () => {
  it("gives the friend's name, difficulty and guesses", () => {
    expect(friendShareText({ opponent: 'Sam', difficulty: 'medium', guesses: 1 }))
      .toBe('Word Mastermind\nI beat Sam in 1 guess on Medium 🏆\nwordmastermind.app');
  });
});

describe('a clutch draw', () => {
  it('says you tied it with your last guess', () => {
    expect(twoPlayerShareText({ strength: 'mastermind', difficulty: 'extreme', guesses: 12, result: 'clutch' }))
      .toBe('Word Mastermind\nClutch! I tied the computer (Mastermind) with my last guess: 12 guesses on Extreme 🔥\nwordmastermind.app');
    expect(friendShareText({ opponent: 'Sam', difficulty: 'hard', guesses: 8, result: 'clutch' }).split('\n')[1])
      .toBe('Clutch! I tied Sam with my last guess: 8 guesses on Hard 🔥');
  });

  it('says they found the draw with their last guess, on the other side of it', () => {
    expect(twoPlayerShareText({ strength: 'expert', difficulty: 'hard', guesses: 12, result: 'tied' }).split('\n')[1])
      .toBe('Clutch! The computer (Expert) found the draw with its last guess: 12 guesses on Hard 🔥');
    expect(friendShareText({ opponent: 'Sam', difficulty: 'hard', guesses: 12, result: 'tied' }).split('\n')[1])
      .toBe('Clutch! Sam found the draw with their last guess: 12 guesses on Hard 🔥');
  });
});

describe('lobbyShareText', () => {
  const words = (...guesses: number[]) => guesses.map((g) => ({ guesses: g, found: g < 30 }));

  it('gives your place, then a row per player with their place, name, emoji and guesses', () => {
    expect(lobbyShareText({
      mode: 'Rush with Friends',
      players: [
        { rank: 1, name: 'Sam', strength: null, you: false, words: words(4, 8, 6, 9) },
        { rank: 2, name: 'Paul', strength: null, you: true, words: words(12, 7, 16, 6) },
        { rank: 3, name: 'Computer 1', strength: 'expert', you: false, words: words(11, 13, 30, 12) },
      ],
    })).toBe([
      'I came in 2nd place in Word Mastermind Rush with Friends!',
      '1st 🟩🟩🟩🟩 27 guesses Sam',
      '2nd 🟨🟩🟧🟩 41 guesses Paul',
      '3rd 🟨🟨⬛🟨 66 guesses Computer 1 (Expert)',
      'wordmastermind.app',
    ].join('\n'));
  });

  it('says when you tied for a place', () => {
    expect(lobbyShareText({
      mode: 'Rush with Friends',
      players: [
        { rank: 1, name: 'Sam', strength: null, you: false, words: words(5, 5, 5, 5) },
        { rank: 1, name: 'Paul', strength: null, you: true, words: words(5, 5, 5, 5) },
      ],
    }).split('\n')[0]).toBe('I tied for 1st place in Word Mastermind Rush with Friends!');
  });

  it('gives each player their time in a Rush, ranked by time', () => {
    expect(lobbyShareText({
      mode: 'Rush with Friends',
      rankBy: 'rush',
      players: [
        { rank: 1, name: 'Sam', strength: null, you: true, seconds: 581, words: words(4, 8, 6, 9) },
      ],
    }).split('\n')[1]).toBe('1st 🟩🟩🟩🟩 9:41 Sam');
  });
});
