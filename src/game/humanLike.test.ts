import { describe, expect, it } from 'vitest';
import { deduceMarks } from './deduce';
import { seededRandom } from './computerRatings';
import { completeMarks, CRANE_SPLIT_DOUGH, HUMAN_STYLES, humanMarks, pickHumanLikeGuess } from './humanLike';
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

describe('completeMarks', () => {
  it('marks exactly what Easy\'s deduceMarks marks', () => {
    const random = seededRandom(11);
    const mask = (w: string) => [...w].reduce((m, c) => m | (1 << (c.charCodeAt(0) - 97)), 0);
    for (let k = 0; k < 40; k++) {
      const secret = SECRET_WORDS[Math.floor(random() * SECRET_WORDS.length)];
      const history = play(secret, 'intermediate', k).slice(0, 1 + Math.floor(random() * 6));
      const slow = deduceMarks(history);
      const { inMask, outMask } = completeMarks(history.map((g) => ({ mask: mask(g.guess), score: g.score })));
      const fast: Record<string, string> = {};
      for (const l of letters(inMask)) fast[l] = 'in';
      for (const l of letters(outMask)) fast[l] = 'out';
      expect(fast).toEqual(slow);
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

  it('plays its opener first, stopping once the scores add up to 5', () => {
    const style = { ...HUMAN_STYLES.intermediate, opener: CRANE_SPLIT_DOUGH };
    const random = seededRandom(2);
    expect(pickHumanLikeGuess([], style, random)).toBe('crane');
    expect(pickHumanLikeGuess([evaluateGuess('crane', 'ghost')], style, random)).toBe('split');
    const two = [evaluateGuess('crane', 'ghost'), evaluateGuess('split', 'ghost')];
    expect(pickHumanLikeGuess(two, style, random)).toBe('dough');
    // PEARL shares R, A, E with CRANE and P, L with SPLIT: 5 already, so no DOUGH.
    const five = [evaluateGuess('crane', 'pearl'), evaluateGuess('split', 'pearl')];
    expect(five.reduce((sum, g) => sum + g.score, 0)).toBe(5);
    expect(pickHumanLikeGuess(five, style, random)).not.toBe('dough');
  });

  it('with insight 1, reasons with complete letter logic every turn', () => {
    const history = play('blame', 'novice', 3).slice(0, 6);
    const seeing = { ...HUMAN_STYLES.novice, insight: 1 };
    const complete = { ...HUMAN_STYLES.novice, deduction: 'all' as const };
    expect(pickHumanLikeGuess(history, seeing, seededRandom(9))).toBe(pickHumanLikeGuess(history, complete, seededRandom(9)));
  });
});
