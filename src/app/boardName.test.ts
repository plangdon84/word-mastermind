import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boardNameDue, noteBoardName, noteRename, spotRename, syncBoardName } from './boardName';

const API = 'https://api.example';
const guest = (guestId: string) => ({ guestId, token: null });

describe("a guest's name on the Daily boards", () => {
  beforeEach(() => {
    // Tests run in Node, which has no browser storage.
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
  });

  it('sends nothing on opening the app for a guest this device never sent a name for', () => {
    expect(boardNameDue('guest-a', 'Guest-1234')).toBe(false);
  });

  it('sends a rename even if this device never sent a name (played on an older app), until the server takes it', () => {
    noteRename('guest-a', 'Wren');
    expect(boardNameDue('guest-a', 'Wren')).toBe(true);
    noteBoardName('guest-a', 'Wren');
    expect(boardNameDue('guest-a', 'Wren')).toBe(false);
  });

  it('sends a name the server may not have, on opening too, once one was sent', () => {
    noteBoardName('guest-a', 'Guest-1234');
    expect(boardNameDue('guest-a', 'Guest-1234')).toBe(false);
    expect(boardNameDue('guest-a', 'Wren')).toBe(true);
    noteBoardName('guest-a', 'Wren');
    expect(boardNameDue('guest-a', 'Wren')).toBe(false);
  });

  it("goes by this guest ID's own record: a new guest after signing out starts afresh", () => {
    noteBoardName('guest-a', 'Wren');
    noteRename('guest-a', 'Robin');
    expect(boardNameDue('guest-b', 'Wren')).toBe(false);
    noteRename('guest-b', 'Robin');
    expect(boardNameDue('guest-b', 'Robin')).toBe(true);
  });

  describe('spotting a rename', () => {
    const as = (id: string, name: string, signedIn = false) => ({ id, name, signedIn });

    it('is a guest choosing another name on the same guest ID', () => {
      expect(spotRename(as('guest-a', 'Guest-1234'), as('guest-a', 'Wren'))).toBe(true);
      expect(spotRename(as('guest-a', 'Wren'), as('guest-a', 'Wren'))).toBe(false);
    });

    it("is never signing out, so the account's name isn't sent for the new guest", () => {
      // The session goes first, or the new guest ID does, with the account's name either way.
      expect(spotRename(as('guest-a', 'Wren', true), as('guest-a', 'Guest-1234'))).toBe(false);
      expect(spotRename(as('guest-a', 'Wren'), as('guest-b', 'Robin'))).toBe(false);
      expect(spotRename(as('guest-a', 'Wren', true), as('guest-b', 'Wren'))).toBe(false);
    });

    it('is never a name arriving with an account', () => {
      expect(spotRename(as('guest-a', 'Guest-1234'), as('guest-a', 'Wren', true))).toBe(false);
      expect(spotRename(as('guest-a', 'Wren', true), as('guest-a', 'Robin', true))).toBe(false);
    });
  });

  describe('sending', () => {
    /** A server whose answers wait until `answer` is called, recording each name sent. */
    function server(fail: false | true | 'refuse' | 'bad' = false) {
      const sent: string[] = [];
      const waiting: (() => void)[] = [];
      const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const { name } = JSON.parse(String(init?.body)) as { name: string };
        sent.push(name);
        await new Promise<void>((resolve) => waiting.push(resolve));
        if (fail === 'refuse') return new Response('{"error":"offensive-name"}', { status: 400 });
        if (fail === 'bad') return new Response('{"error":"bad-request"}', { status: 400 });
        return fail ? new Response('{"error":"unavailable"}', { status: 503 }) : new Response(JSON.stringify({ name }));
      }) as typeof fetch;
      const answer = async () => {
        while (waiting.length > 0) {
          waiting.shift()!();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      };
      return { sent, fetchFn, answer };
    }

    it('keeps an offline rename to send on the next visit', async () => {
      noteRename('guest-a', 'Wren');
      const offline = server(true);
      const done = syncBoardName(API, guest('guest-a'), 'Wren', offline.fetchFn);
      await offline.answer();
      await done;
      expect(boardNameDue('guest-a', 'Wren')).toBe(true);
      const online = server();
      const again = syncBoardName(API, guest('guest-a'), 'Wren', online.fetchFn);
      await online.answer();
      await again;
      expect(online.sent).toEqual(['Wren']);
      expect(boardNameDue('guest-a', 'Wren')).toBe(false);
    });

    it('keeps a rename the server answers with any other 400, to send again (review of PR #68)', async () => {
      noteBoardName('guest-b', 'Guest-1234');
      noteRename('guest-b', 'Wren');
      const bad = server('bad');
      const done = syncBoardName(API, guest('guest-b'), 'Wren', bad.fetchFn);
      await bad.answer();
      await done;
      expect(boardNameDue('guest-b', 'Wren')).toBe(true);
    });

    it('drops a rename the server refuses for good, and sends a later one (Issue 265)', async () => {
      noteBoardName('guest-a', 'Guest-1234');
      noteRename('guest-a', 'Refused');
      const refusing = server('refuse');
      const done = syncBoardName(API, guest('guest-a'), 'Refused', refusing.fetchFn);
      await refusing.answer();
      await done;
      expect(refusing.sent).toEqual(['Refused']);
      // Not sent again on the next visit.
      expect(boardNameDue('guest-a', 'Refused')).toBe(false);
      const next = server();
      await syncBoardName(API, guest('guest-a'), 'Refused', next.fetchFn);
      expect(next.sent).toEqual([]);
      // A new name is sent as usual.
      noteRename('guest-a', 'Wren');
      const later = syncBoardName(API, guest('guest-a'), 'Wren', next.fetchFn);
      await next.answer();
      await later;
      expect(next.sent).toEqual(['Wren']);
      expect(boardNameDue('guest-a', 'Wren')).toBe(false);
    });

    it('sends two quick renames one at a time, the newest last, skipping any in between', async () => {
      noteBoardName('guest-a', 'Guest-1234');
      const { sent, fetchFn, answer } = server();
      noteRename('guest-a', 'Wren');
      const first = syncBoardName(API, guest('guest-a'), 'Wren', fetchFn);
      noteRename('guest-a', 'Robin');
      void syncBoardName(API, guest('guest-a'), 'Robin', fetchFn);
      noteRename('guest-a', 'Rook');
      void syncBoardName(API, guest('guest-a'), 'Rook', fetchFn);
      // Nothing else goes until the first is answered.
      expect(sent).toEqual(['Wren']);
      await answer();
      await first;
      expect(sent).toEqual(['Wren', 'Rook']);
      expect(boardNameDue('guest-a', 'Rook')).toBe(false);
    });

    it('sends nothing signed in, or when the server has the name', async () => {
      const { sent, fetchFn } = server();
      noteBoardName('guest-a', 'Wren');
      await syncBoardName(API, guest('guest-a'), 'Wren', fetchFn);
      noteRename('guest-a', 'Robin');
      await syncBoardName(API, { guestId: 'guest-a', token: 'session' }, 'Robin', fetchFn);
      expect(sent).toEqual([]);
    });
  });
});
