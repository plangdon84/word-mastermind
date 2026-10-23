import { describe, expect, it } from 'vitest';
import {
  friendGamesAfter, friendGamesParams, parseFriendGamesAfter, parseFriendGamesPage, parseFriendGamesParams, parseFriendsList,
  parsePendingInvite, PENDING_INVITE_MS,
} from './friendsApi';

describe('the friends list', () => {
  const list = { code: 'ABCD2345', friends: [], received: [], sent: [], lobbyInvites: [] };

  it('keeps your invite key', () => {
    expect(parseFriendsList({ ...list, invite: 'ABCDEFGHJKLMNPQR' })?.invite).toBe('ABCDEFGHJKLMNPQR');
  });

  it("still works from a server that sends no invite key, without the link", () => {
    expect(parseFriendsList(list)).toMatchObject({ code: 'ABCD2345', invite: null });
    expect(parseFriendsList({ ...list, invite: 'short' })?.invite).toBeNull();
  });
});

describe('an invite link opened while signed out', () => {
  const NOW = Date.UTC(2026, 9, 1);
  const saved = (at: number, key = 'ABCDEFGHJKLMNPQR') => JSON.stringify({ key, at });

  it('is kept for a day', () => {
    expect(parsePendingInvite(saved(NOW), NOW + 1000)).toBe('ABCDEFGHJKLMNPQR');
    expect(parsePendingInvite(saved(NOW), NOW + PENDING_INVITE_MS - 1)).toBe('ABCDEFGHJKLMNPQR');
    expect(parsePendingInvite(saved(NOW), NOW + PENDING_INVITE_MS)).toBeNull();
  });

  it('is ignored when it can\'t be read', () => {
    expect(parsePendingInvite(null, NOW)).toBeNull();
    expect(parsePendingInvite('ABCDEFGHJKLMNPQR', NOW)).toBeNull();
    expect(parsePendingInvite(saved(NOW, 'nope'), NOW)).toBeNull();
    expect(parsePendingInvite(saved(NOW + 60_000), NOW)).toBeNull();
  });
});

describe("paging a friend's history from the last game shown (Issue 206)", () => {
  it('reads back where the next page starts', () => {
    const after = friendGamesAfter(1_760_000_000_000, 'single-1:2');
    expect(parseFriendGamesAfter(after)).toEqual({ startedAt: 1_760_000_000_000, id: 'single-1:2' });
    const query = { filter: { mode: 'single' as const }, after, limit: 20 };
    expect(parseFriendGamesParams(friendGamesParams('ABCDEFGH', query))).toEqual(query);
    expect(parseFriendGamesParams(friendGamesParams('ABCDEFGH', { ...query, after: null }))).toEqual({ ...query, after: null });
  });

  it('refuses a start that is no such thing', () => {
    for (const after of ['', '12', ':x', '-1:x', '1.5:x', `${'9'.repeat(17)}:x`, `1:${'x'.repeat(120)}`]) {
      expect(parseFriendGamesAfter(after), after).toBeNull();
    }
  });

  it("reads a page's next start, and not an old server's offset", () => {
    expect(parseFriendGamesPage({ games: [], next: '1:x' })).toEqual({ games: [], next: '1:x' });
    expect(parseFriendGamesPage({ games: [], next: null })).toEqual({ games: [], next: null });
    expect(parseFriendGamesPage({ games: [], next: 20 })).toBeNull();
  });
});
