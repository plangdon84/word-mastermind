import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addFriendGame, clearFriendGames, findFriendGame, gameIdFromUrl, inviteLink, inviteMessage, loadFriendGames,
  mergeFriendGames, parseFriendGames, smsLink, updateFriendGame,
} from './friendGames';

const ID = 'a'.repeat(63) + '1';
const OTHER = 'b'.repeat(64);

describe('the list of friend games', () => {
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });

  it("adds games from your other devices that this one doesn't know, in order", () => {
    const third = 'c'.repeat(64);
    addFriendGame(ID, 2);
    updateFriendGame(ID, { draft: 'cra' });
    expect(mergeFriendGames([
      { id: ID, addedAt: 2, done: true }, { id: OTHER, addedAt: 3, done: false }, { id: third, addedAt: 1, done: true },
    ])).toBe(2);
    expect(loadFriendGames().map((e) => [e.id, e.done, e.draft])).toEqual([[OTHER, false, ''], [ID, false, 'cra'], [third, true, '']]);
    expect(mergeFriendGames([{ id: OTHER, addedAt: 3, done: false }])).toBe(0);
  });

  it('forgets every game on signing out', () => {
    addFriendGame(ID, 1);
    clearFriendGames();
    expect(loadFriendGames()).toEqual([]);
  });

  it('adds each game once, newest first', () => {
    addFriendGame(ID, 1);
    addFriendGame(OTHER, 2);
    addFriendGame(ID, 3);
    expect(loadFriendGames().map((e) => [e.id, e.addedAt])).toEqual([[OTHER, 2], [ID, 1]]);
  });

  it('keeps every game still on, and only the newest finished ones', () => {
    const id = (n: number) => n.toString(16).padStart(64, '0');
    for (let n = 1; n <= 80; n++) addFriendGame(id(n), n);
    for (let n = 1; n <= 40; n++) updateFriendGame(id(n), { done: true });
    const kept = loadFriendGames();
    expect(kept.filter((e) => !e.done)).toHaveLength(40);
    expect(kept.filter((e) => e.done).map((e) => e.addedAt)).toEqual(
      Array.from({ length: 30 }, (_, i) => 40 - i));
  });

  it('keeps marks, the draft, and whether the game is done', () => {
    addFriendGame(ID, 1);
    updateFriendGame(ID, { marks: { a: 'in' }, draft: 'cra', done: true });
    expect(findFriendGame(ID)).toEqual({ id: ID, addedAt: 1, marks: { a: 'in' }, draft: 'cra', done: true });
  });

  it('drops entries that are not games', () => {
    const raw = JSON.stringify([
      { id: ID, addedAt: 1, marks: { a: 'in', b: 'maybe' }, draft: 'TOOLONG', done: 'yes' },
      { id: 'short', addedAt: 1 },
      null,
    ]);
    expect(parseFriendGames(raw)).toEqual([{ id: ID, addedAt: 1, marks: { a: 'in' }, draft: '', done: false }]);
    expect(parseFriendGames('not json')).toEqual([]);
    expect(parseFriendGames('{}')).toEqual([]);
  });
});

describe('links', () => {
  it('open the game an invite or a notification names', () => {
    expect(gameIdFromUrl(`?join=${ID}`)).toBe(ID);
    expect(gameIdFromUrl(`?game=${ID}`)).toBe(ID);
    expect(gameIdFromUrl('?join=nope')).toBeNull();
    expect(gameIdFromUrl('')).toBeNull();
  });

  it('are the app address with the game ID', () => {
    expect(inviteLink('https://word-mastermind.pages.dev', ID)).toBe(`https://word-mastermind.pages.dev/?join=${ID}`);
  });

  it('come with a message, and can open a text message with both', () => {
    expect(inviteMessage('Ann', '10m')).toBe('Ann wants to play Word Mastermind with you! A live game, 10 minutes each. Tap the link to accept.');
    expect(inviteMessage('Ann', '1d')).toBe('Ann wants to play Word Mastermind with you! Up to 1 day per guess. Tap the link to accept.');
    const message = inviteMessage('Ann', '3d');
    expect(message).toBe('Ann wants to play Word Mastermind with you! Up to 3 days per guess. Tap the link to accept.');
    const link = inviteLink('https://word-mastermind.pages.dev', ID);
    expect(decodeURIComponent(smsLink(message, link).replace('sms:?&body=', ''))).toBe(`${message} ${link}`);
    expect(smsLink(message, link)).not.toContain(' ');
  });
});
