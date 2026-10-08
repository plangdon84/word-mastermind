import { describe, expect, it } from 'vitest';
import { countdownText, errorMessage, repeatMessage, scoreMessage, secretErrorMessage, shortTimeLeft, timeLeftText } from './messages';

describe('errorMessage', () => {
  it('names the rejected word', () => {
    expect(errorMessage('not-in-word-list', 'abcde')).toBe("ABCDE isn't in the word list.");
  });

  it('asks for 5 letters', () => {
    expect(errorMessage('wrong-length', 'cr')).toBe('Enter 5 letters.');
  });
});

describe('secretErrorMessage', () => {
  it('explains that secrets come from the common-word list', () => {
    expect(secretErrorMessage('not-in-word-list', 'nacre'))
      .toBe("NACRE can't be a secret word. Try a more common word.");
  });

  it('explains repeated letters', () => {
    expect(secretErrorMessage('repeated-letters', 'bunny')).toBe("A secret word can't repeat a letter.");
  });
});

describe('repeatMessage', () => {
  const earlier = { number: 3, result: { guess: 'crane', score: 2, isWin: false } };

  it('names the word and which guess it was', () => {
    expect(repeatMessage('crane', earlier, 'medium')).toBe('You already guessed CRANE (guess 3).');
    expect(repeatMessage('crane', earlier, 'hard')).toBe('You already guessed CRANE (guess 3).');
  });

  it('reminds you of the score on Extreme, where past words are hidden', () => {
    expect(repeatMessage('crane', earlier, 'extreme')).toBe('You already guessed CRANE (guess 3). It scored 2.');
  });
});

describe('scoreMessage', () => {
  it('reports the shared-letter count', () => {
    expect(scoreMessage({ guess: 'bunny', score: 1, isWin: false }))
      .toBe('BUNNY shares 1 letter with the word.');
    expect(scoreMessage({ guess: 'plots', score: 0, isWin: false }))
      .toBe('PLOTS shares 0 letters with the word.');
  });

  it('calls out an anagram', () => {
    expect(scoreMessage({ guess: 'nacre', score: 5, isWin: false }))
      .toBe("All 5 letters are in the word. It's an anagram.");
  });
});

describe('timeLeftText', () => {
  it('rounds up to the minute, then counts hours, then days', () => {
    expect(timeLeftText(20_000)).toBe('Under a minute left');
    expect(timeLeftText(12 * 60_000 - 5)).toBe('12 min left');
    expect(timeLeftText(5 * 3_600_000 + 60_000)).toBe('5 h left');
    expect(timeLeftText(47 * 3_600_000)).toBe('47 h left');
    expect(timeLeftText(53 * 3_600_000)).toBe('2 days 5 h left');
    expect(timeLeftText(72 * 3_600_000)).toBe('3 days left');
    expect(timeLeftText(-5)).toBe('Under a minute left');
  });

  it('has a short form for the status row', () => {
    expect(shortTimeLeft(20_000)).toBe('<1m');
    expect(shortTimeLeft(12 * 60_000)).toBe('12m');
    expect(shortTimeLeft(24 * 3_600_000)).toBe('24h');
    expect(shortTimeLeft(53 * 3_600_000)).toBe('2d 5h');
    expect(shortTimeLeft(72 * 3_600_000)).toBe('3d');
  });
});

describe('countdownText', () => {
  it('counts down to the next Daily Rush in hours and minutes', () => {
    expect(countdownText(5 * 3_600_000 + 12 * 60_000)).toBe('5h 12m');
    expect(countdownText(23 * 3_600_000 + 59 * 60_000 + 30_000)).toBe('24h 0m');
    expect(countdownText(12 * 60_000)).toBe('12m');
    expect(countdownText(30_000)).toBe('under a minute');
  });
});
