import { describe, expect, it } from 'vitest';
import { lobbyCodeFromUrl, lobbyLink, parseLobbySaved } from './lobbyStorage';

describe('parseLobbySaved', () => {
  it("restores the lobby, whether it's going, and the marks", () => {
    const saved = { code: 'ABCDEF', kind: 'competitive', active: true, marks: [{ a: 'in' }, {}, {}, {}] };
    expect(parseLobbySaved(JSON.stringify(saved))).toEqual(saved);
  });

  it('takes a lobby saved before Competitive Rush as Rush with Friends', () => {
    expect(parseLobbySaved(JSON.stringify({ code: 'ABCDEF', active: true, marks: [] }))?.kind).toBe('friends');
  });

  it('drops anything malformed', () => {
    expect(parseLobbySaved(null)).toBeNull();
    expect(parseLobbySaved('{nope')).toBeNull();
    expect(parseLobbySaved(JSON.stringify({ code: 'abc', active: true, marks: [] }))).toBeNull();
    expect(parseLobbySaved(JSON.stringify({ code: 'ABCDEF', marks: [{ a: 'maybe' }] }))).toEqual(
      { code: 'ABCDEF', kind: 'friends', active: false, marks: [{}] });
  });
});

describe('join links', () => {
  it('carry the code, and only a code opens a lobby', () => {
    expect(lobbyLink('https://app.example', 'ABCDEF')).toBe('https://app.example/?lobby=ABCDEF');
    expect(lobbyCodeFromUrl('?lobby=ABCDEF')).toBe('ABCDEF');
    expect(lobbyCodeFromUrl('?lobby=abc')).toBeNull();
    expect(lobbyCodeFromUrl('?game=ABCDEF')).toBeNull();
  });
});
