import { describe, expect, it } from 'vitest';
import { corsHeaders, isAllowedOrigin } from './http';

describe('isAllowedOrigin', () => {
  const production = 'https://word-mastermind.pages.dev';
  const staging = 'https://*.word-mastermind.pages.dev';

  it('allows exactly the listed origins', () => {
    expect(isAllowedOrigin('https://word-mastermind.pages.dev', production)).toBe(true);
    expect(isAllowedOrigin('https://1a2b3c4d.word-mastermind.pages.dev', production)).toBe(false);
    expect(isAllowedOrigin('http://word-mastermind.pages.dev', production)).toBe(false);
    expect(isAllowedOrigin('https://word-mastermind.pages.dev', '')).toBe(false);
  });

  it("allows one preview label under a wildcard, as Pages names previews, and nothing else", () => {
    for (const preview of ['https://1a2b3c4d.word-mastermind.pages.dev', 'https://claude-item-13b-launch-scope.word-mastermind.pages.dev']) {
      expect(isAllowedOrigin(preview, staging)).toBe(true);
    }
    for (const other of [
      'https://word-mastermind.pages.dev', 'https://a.b.word-mastermind.pages.dev', 'http://1a2b3c4d.word-mastermind.pages.dev',
      'https://evilword-mastermind.pages.dev', 'https://evil.com/.word-mastermind.pages.dev', 'https://a@b.word-mastermind.pages.dev',
      'https://1a2b3c4d.word-mastermind.pages.dev:8443', 'https://-x.word-mastermind.pages.dev', 'https://.word-mastermind.pages.dev',
      'https://1a2b3c4d.word-mastermind.pages.dev.evil.com',
    ]) {
      expect(isAllowedOrigin(other, staging)).toBe(false);
    }
  });

  it('gives CORS headers only to an allowed origin', () => {
    expect(corsHeaders('https://1a2b3c4d.word-mastermind.pages.dev', `${production},${staging}`)['access-control-allow-origin'])
      .toBe('https://1a2b3c4d.word-mastermind.pages.dev');
    expect(corsHeaders('https://evil.example', staging)).toEqual({});
    expect(corsHeaders(null, staging)).toEqual({});
  });
});
