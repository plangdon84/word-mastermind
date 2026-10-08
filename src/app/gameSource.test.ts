import { describe, expect, it, vi } from 'vitest';
import { gameSource, localSource, parseWordValidation, remoteSource } from './gameSource';

const GUEST = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';

describe('game sources', () => {
  it("today's modes use the local source", () => {
    expect(gameSource).toBe(localSource);
  });

  it('checks words locally', async () => {
    expect(await localSource.checkWord('secret', 'Beach')).toEqual({ ok: true, word: 'beach' });
    expect(await localSource.checkWord('secret', 'bunny')).toEqual({ ok: false, error: 'repeated-letters' });
  });

  it('asks the server, sending the guest ID', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true, word: 'beach' }));
    const remote = remoteSource('https://api.example/', { guestId: GUEST, token: null }, fetchFn);
    expect(await remote.checkWord('secret', 'Beach')).toEqual({ ok: true, word: 'beach' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/api/words/check');
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'secret', word: 'Beach' });
    expect(new Headers(init.headers).get('x-guest-id')).toBe(GUEST);
  });

  it('rejects when the server fails or answers oddly', async () => {
    const failing = remoteSource('https://api.example', { guestId: GUEST, token: null }, async () => new Response('', { status: 500 }));
    await expect(failing.checkWord('guess', 'beach')).rejects.toThrow('500');
    const odd = remoteSource('https://api.example', { guestId: GUEST, token: null }, async () => Response.json({ ok: 'maybe' }));
    await expect(odd.checkWord('guess', 'beach')).rejects.toThrow('unexpected');
  });

  it('reads answers defensively', () => {
    expect(parseWordValidation({ ok: false, error: 'game-over' })).toBeNull();
    expect(parseWordValidation({ ok: true })).toBeNull();
    expect(parseWordValidation(null)).toBeNull();
  });
});
