import { describe, expect, it } from 'vitest';
import type { FriendGame } from './friendApi';
import { pickNextGame } from './nextGame';

const game = (id: string, state: FriendGame['state'], turn: 'you' | 'opponent' | null, deadline: number | null): FriendGame => ({
  id, seat: 'host', state, hostName: 'Ann', guestName: 'Bob', inviteeName: null, invitedYou: false, inviteeDifficulty: null, rematchOf: null, rematch: null,
  timeControl: '1d', createdAt: 0, expiresAt: null,
  serverNow: 0, rated: false, matched: false, ratings: null,
  view: state === 'waiting' ? null : {
    first: 'you', yourSecret: 'storm', theirSecret: null, yourGuesses: [], theirGuesses: [], turn,
    status: state === 'over' ? 'over' : 'playing', outcome: null, startedAt: 0, timeControl: '1d', deadline, clocks: null, rated: false, suggested: 0,
    difficulty: 'medium', theirDifficulty: 'medium', theirMarks: null,
  },
});

describe('pickNextGame', () => {
  it('picks the game waiting on you whose time runs out first', () => {
    const games = [game('a', 'playing', 'you', 300), game('b', 'playing', 'you', 100), game('c', 'playing', 'opponent', 50)];
    expect(pickNextGame(games, null)?.id).toBe('b');
  });

  it('skips the game you are in, finished games and invites', () => {
    const games = [game('a', 'playing', 'you', 100), game('b', 'over', null, null), game('c', 'waiting', null, null)];
    expect(pickNextGame(games, 'a')).toBeNull();
  });
});
