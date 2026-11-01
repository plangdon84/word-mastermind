import { describe, expect, it } from 'vitest';
import { dailyGames } from './dailyApi';

/** A server that refuses every request with `status`, counting what it's asked. */
function refusing(status: number) {
  const asked: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    asked.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify({ error: status === 429 ? 'too-many-requests' : status === 401 ? 'signed-out' : 'oops' }),
      { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { asked, fetchFn };
}

const identity = { guestId: '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41', token: null };

describe("the title screen's request for both daily games (issue 248)", () => {
  it.each([429, 401])("doesn't ask for each game on its own when refused with %i", async (status) => {
    const { asked, fetchFn } = refusing(status);
    expect(await dailyGames('https://api.example', identity, fetchFn)).toEqual({ daily: null, dailyWord: null });
    expect(asked).toEqual(['/api/daily/games']);
  });

  it('asks for each game on its own when the one request fails otherwise', async () => {
    const { asked, fetchFn } = refusing(500);
    expect(await dailyGames('https://api.example', identity, fetchFn)).toEqual({ daily: null, dailyWord: null });
    expect(asked.sort()).toEqual(['/api/daily', '/api/daily/games', '/api/daily/word']);
  });
});
