import { describe, expect, it } from 'vitest';
import { listOpen, parseListChoice } from './gamesInProgress';

describe('the Games in progress list', () => {
  it('opens when something waits on you, and is closed otherwise', () => {
    expect(listOpen(null, ['game-a'])).toBe(true);
    expect(listOpen(null, [])).toBe(false);
  });

  it('keeps your own open or close while nothing new waits on you', () => {
    expect(listOpen({ open: false, waiting: ['game-a', 'lobby-b'] }, ['game-a'])).toBe(false);
    expect(listOpen({ open: true, waiting: [] }, [])).toBe(true);
  });

  it('follows what waits on you again once something new arrives', () => {
    expect(listOpen({ open: false, waiting: ['game-a'] }, ['game-a', 'game-c'])).toBe(true);
  });

  it('reads back a saved choice, and ignores anything else', () => {
    expect(parseListChoice('{"open":false,"waiting":["game-a"]}')).toEqual({ open: false, waiting: ['game-a'] });
    expect(parseListChoice('{"open":"no","waiting":[]}')).toBeNull();
    expect(parseListChoice('not json')).toBeNull();
    expect(parseListChoice(null)).toBeNull();
  });
});
