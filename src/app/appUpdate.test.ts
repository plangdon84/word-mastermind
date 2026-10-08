import { describe, expect, it } from 'vitest';
import { fetchLatestBuild, parseBuildInfo, updateKind } from './appUpdate';

const running = { version: '1.4.1', build: 'abc1234' };

describe('a newer build', () => {
  it('is nothing to do when it is this build', () => {
    expect(updateKind(running, { version: '1.4.1', build: 'abc1234' })).toBe('none');
    expect(updateKind(running, null)).toBe('none');
  });

  it('is offered mid-game only with a newer version number', () => {
    expect(updateKind(running, { version: '1.4.2', build: 'def5678' })).toBe('offer');
    expect(updateKind(running, { version: '1.5.0', build: 'def5678' })).toBe('offer');
    // A build players see no change in (docs, the server) waits for the title screen.
    expect(updateKind(running, { version: '1.4.1', build: 'def5678' })).toBe('quiet');
  });

  it('reads only a well-formed version file', () => {
    expect(parseBuildInfo({ version: '1.4.2', build: 'def5678' })).toEqual({ version: '1.4.2', build: 'def5678' });
    expect(parseBuildInfo({ version: 'soon', build: 'def5678' })).toBeNull();
    expect(parseBuildInfo({ version: '1.4.2', build: '<script>' })).toBeNull();
    expect(parseBuildInfo('1.4.2')).toBeNull();
  });

  it('is null when the file can\'t be read', async () => {
    const offline = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    const missing = (async () => new Response('Not found', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchLatestBuild(offline)).toBeNull();
    expect(await fetchLatestBuild(missing)).toBeNull();
  });

  it('is read past every cache', async () => {
    let asked: [string, RequestInit | undefined] | null = null;
    const fetcher = (async (url: string, init?: RequestInit) => {
      asked = [url, init];
      return Response.json({ version: '1.4.2', build: 'def5678' });
    }) as unknown as typeof fetch;
    expect(await fetchLatestBuild(fetcher)).toEqual({ version: '1.4.2', build: 'def5678' });
    expect(asked![0]).toMatch(/^\/version\.json\?t=\d+$/);
    expect(asked![1]).toEqual({ cache: 'no-store' });
  });
});
