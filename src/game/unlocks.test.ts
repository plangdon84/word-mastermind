import { describe, expect, it } from 'vitest';
import { DAY, friend, rush, solo, versus } from './testGames';
import { computeUnlocks, openModes } from './unlocks';

const T = Date.UTC(2026, 0, 1);
const words = [['beach'], ['crane'], ['storm'], ['house']];
const soloWin = (id: string, at: number) => solo(id, at, ['crane', 'beach']);
const cpuWin = (id: string, at: number) =>
  versus(id, at, { first: 'human', you: ['crane', 'beach'], computer: ['house', 'teach'] });
const cleanRush = (id: string, at: number) => rush(id, at, words);

describe('unlocking modes', () => {
  it('starts with only single player', () => {
    expect(computeUnlocks([])).toEqual([]);
    expect(openModes([])).toEqual({ twoPlayer: false, soloRush: false, otherRush: false });
  });

  it('opens each step in turn: a single player win, a two player win, a Solo Rush with no word given up', () => {
    const unlocks = computeUnlocks([soloWin('s', T), cpuWin('c', T + DAY), cleanRush('r', T + 2 * DAY)]);
    expect(unlocks).toEqual([
      { step: 'two-player', at: expect.any(Number), gameId: 's' },
      { step: 'solo-rush', at: expect.any(Number), gameId: 'c' },
      { step: 'all-rush', at: expect.any(Number), gameId: 'r' },
    ]);
    expect(openModes(unlocks)).toEqual({ twoPlayer: true, soloRush: true, otherRush: true });
  });

  it("doesn't count a give-up, a draw, or a Rush with a word given up", () => {
    expect(computeUnlocks([solo('s', T, ['crane'], { gaveUp: true })])).toEqual([]);
    const draw = versus('d', T + DAY, { first: 'computer', computer: ['storm'], you: ['beach'] });
    expect(computeUnlocks([soloWin('s', T), draw]).map((u) => u.step)).toEqual(['two-player']);
    const gaveUpWord = rush('r', T + 2 * DAY, [['beach'], 'give-up', ['storm'], ['house']]);
    expect(computeUnlocks([soloWin('s', T), cpuWin('c', T + DAY), gaveUpWord]).map((u) => u.step))
      .toEqual(['two-player', 'solo-rush']);
  });

  it('counts a win against a friend, but needs each step before', () => {
    const friendWin = friend('f', T, { you: ['crane', 'beach'], them: ['house', 'crane'] });
    // A friend's invite link works while two player is still locked, but Solo Rush waits for the first step.
    expect(computeUnlocks([friendWin])).toEqual([]);
    const later = computeUnlocks([friendWin, soloWin('s', T + DAY)]);
    expect(later.map((u) => [u.step, u.gameId])).toEqual([['two-player', 's'], ['solo-rush', 's']]);
    expect(later[1].at).toBe(later[0].at);
  });
});
