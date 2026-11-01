import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boardNameStale, noteBoardName } from './boardName';

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
    expect(boardNameStale('guest-a', 'Guest-1234', false)).toBe(false);
  });

  it('sends a name chosen since opening, even if this device never sent one (played on an older app)', () => {
    expect(boardNameStale('guest-a', 'Wren', true)).toBe(true);
  });

  it('sends a name the server may not have, on opening too, once one was sent', () => {
    noteBoardName('guest-a', 'Guest-1234');
    expect(boardNameStale('guest-a', 'Guest-1234', false)).toBe(false);
    expect(boardNameStale('guest-a', 'Wren', false)).toBe(true);
    noteBoardName('guest-a', 'Wren');
    expect(boardNameStale('guest-a', 'Wren', true)).toBe(false);
  });

  it("goes by this guest ID's own record: a new guest after signing out starts afresh", () => {
    noteBoardName('guest-a', 'Wren');
    expect(boardNameStale('guest-b', 'Guest-9876', false)).toBe(false);
    expect(boardNameStale('guest-b', 'Robin', true)).toBe(true);
  });
});
