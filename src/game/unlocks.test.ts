import { describe, expect, it } from 'vitest';
import { DAY, dailyWord, friend, rush, solo, versus } from './testGames';
import { computeOldUnlocks, computeUnlocks, openModes } from './unlocks';

const T = Date.UTC(2026, 0, 1);
const words = [['beach'], ['crane'], ['storm'], ['house']];
const soloWin = (id: string, at: number) => solo(id, at, ['crane', 'beach']);
const cpuWin = (id: string, at: number) =>
  versus(id, at, { first: 'human', you: ['crane', 'beach'], computer: ['house', 'teach'] });
const cleanRush = (id: string, at: number) => rush(id, at, words);

describe('unlocking modes', () => {
  it('starts with Practice, the Daily Word and two player against the computer', () => {
    expect(computeUnlocks([])).toEqual([]);
    expect(openModes([])).toEqual({ all: false });
  });

  it('opens everything with a Practice win, the Daily Word found or a win against the computer', () => {
    for (const game of [soloWin('g', T), dailyWord('g', '2026-01-01', T, ['crane', 'beach']), cpuWin('g', T)]) {
      const unlocks = computeUnlocks([game]);
      expect(unlocks).toEqual([{ step: 'all', at: expect.any(Number), gameId: 'g' }]);
      expect(openModes(unlocks)).toEqual({ all: true });
    }
  });

  it('opens with the first such game', () => {
    const unlocks = computeUnlocks([cpuWin('c', T + DAY), soloWin('s', T)]);
    expect(unlocks.map((u) => u.gameId)).toEqual(['s']);
  });

  it("doesn't count a give-up, a draw, a Daily Word given up, a friend win or a Word Set", () => {
    const draw = versus('d', T, { first: 'computer', computer: ['storm'], you: ['beach'] });
    const friendWin = friend('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'] });
    expect(computeUnlocks([
      solo('s', T, ['crane'], { gaveUp: true }),
      draw,
      dailyWord('w', '2026-01-01', T, ['crane'], { gaveUp: true }),
      friendWin,
      cleanRush('r', T),
    ])).toEqual([]);
  });
});

describe('the steps before item 18zn', () => {
  it('opened in turn: a Practice win, a two player win, a Solo Rush with no word given up', () => {
    const unlocks = computeOldUnlocks([soloWin('s', T), cpuWin('c', T + DAY), cleanRush('r', T + 2 * DAY)]);
    expect(unlocks.map((u) => [u.step, u.gameId])).toEqual([['two-player', 's'], ['solo-rush', 'c'], ['all-rush', 'r']]);
  });

  it('each needed the one before', () => {
    const friendWin = friend('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'] });
    expect(computeOldUnlocks([friendWin])).toEqual([]);
    const later = computeOldUnlocks([friendWin, soloWin('s', T + DAY)]);
    expect(later.map((u) => [u.step, u.gameId])).toEqual([['two-player', 's'], ['solo-rush', 's']]);
    expect(later[1].at).toBe(later[0].at);
  });
});
