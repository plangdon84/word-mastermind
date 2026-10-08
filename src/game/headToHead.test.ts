import { describe, expect, it } from 'vitest';
import { headToHead } from './headToHead';
import { friend, lobby, solo, versus } from './testGames';

const T = Date.UTC(2026, 9, 1);
const ALL = [['beach'], ['crane'], ['storm'], ['house']];

describe('headToHead', () => {
  it('counts only the games you both played, from your side', () => {
    // You win the first, they concede the second, and the third is a draw.
    const yours = [
      friend('g1', T, { you: ['beach'], them: ['crane'] }),
      friend('g2', T, { you: ['crane'], them: ['house'], concede: 'them' }),
      friend('g3', T, { you: ['beach'], them: ['storm'] }),
      // A game against someone else, and games with no opponent.
      friend('other', T, { you: ['beach'], them: ['crane'] }),
      solo('s1', T, ['beach']),
      versus('c1', T, { you: ['beach'], computer: ['crane'] }),
    ];
    const theirs = [
      friend('g1', T, { seat: 'guest', first: 'them', yourSecret: 'beach', theirSecret: 'storm', you: ['crane'], them: ['beach'] }),
      friend('g2', T, { seat: 'guest', first: 'them', yourSecret: 'beach', theirSecret: 'storm', you: ['house'], them: ['crane'], concede: true }),
      friend('g3', T, { seat: 'guest', first: 'them', yourSecret: 'beach', theirSecret: 'storm', you: ['storm'], them: ['beach'] }),
      solo('s1', T, ['beach']),
    ];
    expect(headToHead(yours, theirs).friend).toEqual({ wins: 2, draws: 1, losses: 0 });
  });

  it('compares your place in a Word Set with theirs, not placed coming last, and leaves out one neither of you placed in', () => {
    const yours = [
      lobby('l1', T, ALL, { rank: 1 }),
      lobby('l2', T, ALL, { rank: 3 }),
      lobby('l3', T, ALL, { rank: 2 }),
      lobby('l4', T, ['give-up', 'give-up', 'give-up', 'give-up'], { rank: null }),
      lobby('l5', T, ['give-up', 'give-up', 'give-up', 'give-up'], { rank: null }),
    ];
    const theirs = [
      lobby('l1', T, ALL, { rank: 2 }),
      lobby('l2', T, ALL, { rank: 1 }),
      lobby('l3', T, ALL, { rank: 2 }),
      lobby('l4', T, ALL, { rank: 1 }),
      lobby('l5', T, ['give-up', 'give-up', 'give-up', 'give-up'], { rank: null }),
    ];
    expect(headToHead(yours, theirs)).toEqual({
      friend: { wins: 0, draws: 0, losses: 0 },
      lobby: { wins: 1, draws: 1, losses: 2 },
    });
  });
});
