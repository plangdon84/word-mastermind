import { describe, expect, it } from 'vitest';
import { isOldHost, newAddress, redirectDue, REDIRECT_FROM } from './moved';

describe('the move to wordmastermind.app', () => {
  it('is the old production address only, never a preview or the new one', () => {
    expect(isOldHost('word-mastermind.pages.dev')).toBe(true);
    expect(isOldHost('3f2a1b.word-mastermind.pages.dev')).toBe(false);
    expect(isOldHost('claude-dev-plan-18f.word-mastermind.pages.dev')).toBe(false);
    expect(isOldHost('wordmastermind.app')).toBe(false);
    expect(isOldHost('localhost')).toBe(false);
  });

  it('redirects the old address only from the set day', () => {
    const day = Date.parse(`${REDIRECT_FROM}T00:00:00Z`);
    expect(redirectDue('word-mastermind.pages.dev', day - 1)).toBe(false);
    expect(redirectDue('word-mastermind.pages.dev', day)).toBe(true);
    expect(redirectDue('abc.word-mastermind.pages.dev', day)).toBe(false);
    expect(redirectDue('wordmastermind.app', day)).toBe(false);
  });

  it('keeps the page, its query and its hash', () => {
    expect(newAddress({ pathname: '/', search: '?invite=abc', hash: '#x' }))
      .toBe('https://wordmastermind.app/?invite=abc#x');
  });
});
