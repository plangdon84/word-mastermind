import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../../functions/_middleware';

const served = new Response('the page');
const call = (url: string) => onRequest({ request: new Request(url), next: async () => served });

describe('the old address redirect', () => {
  afterEach(() => vi.useRealTimers());

  it('serves the page before the day', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-31T23:59:59Z') });
    expect(await call('https://word-mastermind.pages.dev/?invite=abc')).toBe(served);
  });

  it('moves the old address permanently from the day, keeping the link', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-01T00:00:00Z') });
    const response = await call('https://word-mastermind.pages.dev/how-to-play?lobby=ABCD');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://wordmastermind.app/how-to-play?lobby=ABCD');
  });

  it('never moves the new address or a preview', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-12-01T00:00:00Z') });
    expect(await call('https://wordmastermind.app/')).toBe(served);
    expect(await call('https://abc123.word-mastermind.pages.dev/')).toBe(served);
  });
});
