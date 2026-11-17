import { describe, expect, it } from 'vitest';
import { deduceMarks } from './deduce';
import { seededRandom } from './computerRatings';
import { HUMAN_STYLES, humanMarks, pickHumanLikeGuess } from './humanLike';
import { evaluateGuess, type GuessResult } from './scoring';
import { GUESS_WORD_SET, SECRET_WORDS } from './wordLists';

const letters = (mask: number) => [...'abcdefghijklmnopqrstuvwxyz'].filter((_, i) => mask & (1 << i)).join('');

function play(secret: string, style: keyof typeof HUMAN_STYLES, seed: number): GuessResult[] {
  const random = seededRandom(seed);
  const history: GuessResult[] = [];
  while (!history.at(-1)?.isWin) {
    if (history.length >= 60) throw new Error(`no solve of ${secret}`);
    history.push(evaluateGuess(pickHumanLikeGuess(history, HUMAN_STYLES[style], random), secret));
  }
  return history;
}

describe('humanMarks', () => {
  it('reads two guesses a letter apart, as a person does', () => {
    // Swapping s for y takes the score from 1 to 0: s is in, and l, o and y are out.
    const history = [{ guess: 'lossy', score: 1 }, { guess: 'lolly', score: 0 }];
    const { inMask, outMask } = humanMarks(history as GuessResult[], 'multiple');
    expect(letters(inMask)).toBe('s');
    expect(letters(outMask)).toBe('loy');
  });

  it('never marks a letter wrong, at any level', () => {
    for (const [seed, secret] of ['plumb', 'reaps', 'fight', 'crane'].entries()) {
      const history = play(secret, 'novice', seed);
      for (let n = 1; n <= history.length; n++) {
        for (const deduction of ['single', 'multiple', 'all'] as const) {
          const { inMask, outMask } = humanMarks(history.slice(0, n), deduction);
          for (const letter of letters(inMask)) expect(secret).toContain(letter);
          for (const letter of letters(outMask)) expect(secret).not.toContain(letter);
        }
      }
      // Its own logic never knows more than complete letter logic.
      const all = deduceMarks(history.slice(0, -1));
      const { inMask } = humanMarks(history.slice(0, -1), 'multiple');
      for (const letter of letters(inMask)) expect(all[letter]).toBe('in');
    }
  });
});

describe('pickHumanLikeGuess', () => {
  it('finds the word in every style, guessing only guess-list words', () => {
    const random = seededRandom(7);
    for (const style of ['novice', 'intermediate', 'expert'] as const) {
      for (let k = 0; k < 4; k++) {
        const secret = SECRET_WORDS[Math.floor(random() * SECRET_WORDS.length)];
        const history = play(secret, style, k);
        expect(history.at(-1)!.guess).toBe(secret);
        for (const g of history) expect(GUESS_WORD_SET.has(g.guess)).toBe(true);
      }
    }
  });

  it('goes only for anagrams once a guess scores 5', () => {
    const history = play('reaps', 'expert', 1);
    const five = history.findIndex((g) => g.score === 5);
    for (const g of history.slice(five)) expect([...g.guess].sort().join('')).toBe('aeprs');
  });
});
