import { describe, expect, it } from 'vitest';
import { addPlayOnGuess, canPlayOn, NEW_PLAY_ON, playOnStage, practiceGuesses, type PlayOn } from './practice';
import { evaluateGuess } from './scoring';

describe('canPlayOn', () => {
  it('is a loss where you never found their word', () => {
    expect(canPlayOn(true, [evaluateGuess('crane', 'beach')])).toBe(true);
    expect(canPlayOn(true, [])).toBe(true);
  });

  it('is never a win, a draw, or a loss where your final guess found it', () => {
    expect(canPlayOn(false, [evaluateGuess('crane', 'beach')])).toBe(false);
    expect(canPlayOn(true, [evaluateGuess('beach', 'beach')])).toBe(false);
  });
});

describe('playing on', () => {
  it('starts by asking, then plays until found', () => {
    expect(playOnStage('beach', null)).toBe('choose');
    expect(playOnStage('beach', NEW_PLAY_ON)).toBe('playing');

    const first = addPlayOnGuess('beach', NEW_PLAY_ON, ' Bunny ');
    expect(first).toEqual({ ok: true, playOn: { words: ['bunny'], revealed: false }, result: evaluateGuess('bunny', 'beach') });
    if (!first.ok) return;
    const found = addPlayOnGuess('beach', first.playOn, 'beach');
    expect(found.ok && found.result.isWin).toBe(true);
    if (!found.ok) return;
    expect(playOnStage('beach', found.playOn)).toBe('found');
    expect(practiceGuesses('beach', found.playOn).map((g) => g.score)).toEqual([1, 5]);
  });

  it('checks each guess like any other', () => {
    expect(addPlayOnGuess('beach', NEW_PLAY_ON, 'abc')).toEqual({ ok: false, error: 'wrong-length' });
    expect(addPlayOnGuess('beach', NEW_PLAY_ON, 'zzzzz')).toEqual({ ok: false, error: 'not-in-word-list' });
  });

  it('takes no guess once their word is found or shown', () => {
    const revealed: PlayOn = { words: ['bunny'], revealed: true };
    expect(playOnStage('beach', revealed)).toBe('revealed');
    expect(addPlayOnGuess('beach', revealed, 'crane')).toEqual({ ok: false, error: 'game-over' });
    expect(addPlayOnGuess('beach', { words: ['beach'], revealed: false }, 'crane')).toEqual({ ok: false, error: 'game-over' });
    expect(addPlayOnGuess('beach', NEW_PLAY_ON, 'crane').ok).toBe(true);
    expect(practiceGuesses('beach', null)).toEqual([]);
  });
});
