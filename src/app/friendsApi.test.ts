import { describe, expect, it } from 'vitest';
import { parseFriendsList, parsePendingInvite, PENDING_INVITE_MS } from './friendsApi';

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
