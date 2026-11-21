import { describe, expect, it } from 'vitest';
import { COMPUTER_RATINGS, HUMAN_LADDER, isHumanLike, ratedComputer, seededRandom } from './computerRatings';
import { computerPause, HUMAN_LADDER_STYLES, humanLadderGuess } from './humanLadder';
import { parsePvpRecord } from './records';
import { evaluateGuess, type GuessResult } from './scoring';
import { GUESS_WORD_SET } from './wordLists';

describe('the human-like ladder computers (Dev Plan item 19zr)', () => {
  it('stand in for every recall computer, by an ID no recall has', () => {
    // Each was tuned to land within 20 points of the recall computer it replaced.
    for (const [i, computer] of HUMAN_LADDER.entries()) expect(Math.abs(computer.rating - COMPUTER_RATINGS[i].rating)).toBeLessThanOrEqual(20);
    for (const [i, computer] of HUMAN_LADDER.entries()) {
      expect(computer.recall).toBeGreaterThan(0);
      expect(computer.recall).toBeLessThanOrEqual(1);
      expect(isHumanLike(computer.recall)).toBe(true);
      expect(ratedComputer(computer.recall)).toBe(computer);
      expect(HUMAN_LADDER_STYLES.has(computer.recall)).toBe(true);
      if (i > 0) expect(computer.averageGuesses).toBeLessThan(HUMAN_LADDER[i - 1].averageGuesses);
    }
    for (const old of COMPUTER_RATINGS) expect(isHumanLike(old.recall)).toBe(false);
  });

  it("are read back from a record by any app, as a recall computer's are", () => {
    const record = { secrets: { host: 'storm', guest: 'crane' }, first: 'host', startedAt: 0, clockMinutes: 10, firstGuessFree: true,
      difficulty: { host: 'medium', guest: 'medium' }, rated: true, ladder: { computer: 0.995 }, moves: [] };
    expect(parsePvpRecord(record)?.ladder).toEqual({ computer: 0.995 });
  });

  it('each find the word, one guess at a time, from the guess list', () => {
    const random = seededRandom(5);
    for (const computer of HUMAN_LADDER) {
      const history: GuessResult[] = [];
      while (!history.at(-1)?.isWin) {
        if (history.length > 60) throw new Error(`${computer.label} didn't find it`);
        history.push(evaluateGuess(humanLadderGuess(computer.recall, history, random).word, 'storm'));
      }
      expect(history.every((g) => GUESS_WORD_SET.has(g.guess))).toBe(true);
    }
    expect(() => humanLadderGuess(0.38, [], random)).toThrow();
  });

  it('mark the letters they have worked out with each guess', () => {
    // CRANE scored 0: all five are out, which even the weakest marks.
    const { word, marks } = humanLadderGuess(HUMAN_LADDER[0].recall, [{ guess: 'crane', score: 0, isWin: false }], seededRandom(1));
    expect(word).toBe('split');
    expect(marks).toEqual({ a: 'out', c: 'out', e: 'out', n: 'out', r: 'out' });
    // Nothing known yet: no marks.
    expect(humanLadderGuess(HUMAN_LADDER[6].recall, [], seededRandom(1)).marks).toEqual({});
  });

  it('go for the word on a final guess, never an opener or staging guess', () => {
    // A first guess would be CRANE; as a final guess it's a word that could be the answer (5 different letters).
    const random = seededRandom(3);
    for (const computer of HUMAN_LADDER) {
      expect(humanLadderGuess(computer.recall, [], seededRandom(3)).word).toBe('crane');
      const { word } = humanLadderGuess(computer.recall, [], random, true);
      expect(new Set(word).size).toBe(5);
    }
    // After CRANE scored 0, a final guess has none of its letters.
    const { word } = humanLadderGuess(HUMAN_LADDER[2].recall, [{ guess: 'crane', score: 0, isWin: false }], random, true);
    expect([...word].some((l) => 'crane'.includes(l))).toBe(false);
  });

  it('pause 3 to 8 seconds before each guess, the same each time it is asked', () => {
    for (let n = 0; n < 50; n++) {
      const pause = computerPause(1234, n);
      expect(pause).toBeGreaterThanOrEqual(3_000);
      expect(pause).toBeLessThanOrEqual(8_000);
      expect(computerPause(1234, n)).toBe(pause);
    }
    expect(new Set(Array.from({ length: 20 }, (_, n) => computerPause(1234, n))).size).toBeGreaterThan(10);
  });
});
