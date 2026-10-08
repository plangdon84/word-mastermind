import { describe, expect, it } from 'vitest';
import type { IssueReport } from '../../src/game';
import { fakeD1 } from './fakeD1';
import { handle, type Env } from './index';
import { newId } from '../../src/app/ids';
import { REPORTS_PER_ADDRESS_HOUR, REPORTS_PER_HOUR, screenshotMatchesType } from './reports';

const NOW = Date.UTC(2026, 8, 28);
const API = 'https://api.example';
const GUEST = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const PNG = btoa('\x89PNG\r\n\x1a\n' + 'rest of the image');

const report = (over: Partial<IssueReport> = {}): IssueReport => ({
  kind: 'bug',
  description: 'The keyboard froze.',
  context: { screen: 'Rush · Medium', app: 'dev', browser: 'Test/1.0', viewport: '390×844', language: 'en' },
  record: null,
  screenshot: null,
  ...over,
});

/** A server whose calls to GitHub are recorded and answered with `status`. */
function setup(env: Partial<Env> = { GITHUB_TOKEN: 'ghp_test', GITHUB_REPO: 'owner/repo' }, status = 201) {
  const { db, sqlite } = fakeD1();
  const issues: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    issues.push({ url: String(input), headers: new Headers(init?.headers), body });
    if (status !== 201) return new Response('{}', { status });
    return Response.json({ html_url: `https://github.com/owner/repo/issues/${issues.length}` }, { status });
  }) as typeof fetch;
  const fullEnv = {
    DB: db, GAMES: undefined as unknown as DurableObjectNamespace, DAILY: undefined as unknown as DurableObjectNamespace, LOBBIES: undefined as unknown as DurableObjectNamespace, QUEUES: undefined as unknown as DurableObjectNamespace, ALLOWED_ORIGINS: 'https://app.example', ...env,
  } satisfies Env;
  const send = (body: unknown, guest = GUEST, at = NOW, address = '203.0.113.7') => handle(new Request(`${API}/api/reports`, {
    method: 'POST', headers: { 'x-guest-id': guest, 'content-type': 'application/json', 'cf-connecting-ip': address },
    body: JSON.stringify(body),
  }), fullEnv, at, fetchFn);
  const get = (path: string) => handle(new Request(`${API}${path}`), fullEnv, NOW, fetchFn);
  return { sqlite, issues, send, get };
}

describe('POST /api/reports', () => {
  it('files a GitHub issue, labelled, and keeps the report', async () => {
    const { sqlite, issues, send } = setup();
    const response = await send(report());
    expect(response.status).toBe(200);
    const { id, issueUrl } = await response.json() as { id: string; issueUrl: string };
    expect(issueUrl).toBe('https://github.com/owner/repo/issues/1');
    expect(issues[0].url).toBe('https://api.github.com/repos/owner/repo/issues');
    expect(issues[0].headers.get('authorization')).toBe('Bearer ghp_test');
    expect(issues[0].body.title).toBe('[Bug] The keyboard froze.');
    expect(issues[0].body.labels).toEqual(['bug', 'from-app']);
    expect(issues[0].body.body).toContain('- **Screen:** Rush · Medium');
    // The guest ID lets a guest play as themselves, so it never goes on GitHub.
    expect(JSON.stringify(issues[0].body)).not.toContain(GUEST);
    const row = sqlite.prepare('SELECT guest_id, issue_url FROM reports WHERE id = ?').get(id);
    expect(row).toEqual({ guest_id: GUEST, issue_url: issueUrl });
  });

  it('serves the screenshot the issue shows', async () => {
    const { issues, send, get } = setup();
    const { id } = await (await send(report({ screenshot: { type: 'image/png', data: PNG } }))).json() as { id: string };
    const path = `/api/reports/${id}/screenshot`;
    expect(issues[0].body.body).toContain(`![Screenshot](${API}${path})`);
    const image = await get(path);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await image.arrayBuffer())[0]).toBe(0x89);
    expect((await get('/api/reports/0123456789abcdef0123456789abcdef/screenshot')).status).toBe(404);
    expect((await get('/api/reports/nope/screenshot')).status).toBe(404);
  });

  it('refuses a screenshot that is not the image it claims to be', async () => {
    const { send } = setup();
    const html = btoa('<html><script>alert(1)</script>');
    expect((await send(report({ screenshot: { type: 'image/png', data: html } }))).status).toBe(400);
  });

  it('keeps the report when GitHub refuses it or filing is off', async () => {
    const refused = setup(undefined, 500);
    const response = await refused.send(report());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ issueUrl: null });
    expect(refused.sqlite.prepare('SELECT COUNT(*) AS n FROM reports').get()).toEqual({ n: 1 });

    const off = setup({});
    expect(await (await off.send(report())).json()).toMatchObject({ issueUrl: null });
    expect(off.issues).toEqual([]);
  });

  it('tries again without labels if GitHub refuses them', async () => {
    const { issues, send } = setup(undefined, 422);
    await send(report());
    expect(issues).toHaveLength(2);
    expect(issues[1].body.labels).toBeUndefined();
  });

  it('refuses a missing guest ID or a malformed report', async () => {
    const { send } = setup();
    expect((await send(report(), 'nobody')).status).toBe(400);
    expect((await send({ kind: 'bug' })).status).toBe(400);
  });

  it(`takes at most ${REPORTS_PER_HOUR} reports an hour from a device`, async () => {
    const { send } = setup();
    for (let i = 0; i < REPORTS_PER_HOUR; i++) expect((await send(report())).status).toBe(200);
    const refused = await send(report());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'too-many-reports' });
    expect((await send(report(), '1f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41')).status).toBe(200);
    expect((await send(report(), GUEST, NOW + 61 * 60 * 1000)).status).toBe(200);
  });

  // A made-up guest ID for each report mustn't get round the limit and flood the issue tracker.
  it(`takes at most ${REPORTS_PER_ADDRESS_HOUR} reports an hour from an address, whatever the guest IDs`, async () => {
    const { send } = setup();
    for (let i = 0; i < REPORTS_PER_ADDRESS_HOUR; i++) expect((await send(report(), newId())).status).toBe(200);
    expect((await send(report(), newId())).status).toBe(429);
    expect((await send(report(), newId(), NOW, '198.51.100.9')).status).toBe(200);
    expect((await send(report(), newId(), NOW + 61 * 60 * 1000)).status).toBe(200);
  });

  it('keeps the address only hashed, and forgets it after an hour', async () => {
    const { send, sqlite } = setup();
    await send(report());
    const [first] = sqlite.prepare('SELECT ip_hash FROM reports').all() as { ip_hash: string }[];
    expect(first.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.ip_hash).not.toContain('203.0.113.7');
    await send(report(), newId(), NOW + 61 * 60 * 1000);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM reports WHERE ip_hash IS NOT NULL').get()).toEqual({ n: 1 });
  });
});

describe('screenshotMatchesType', () => {
  it('checks the first bytes of each image type', () => {
    expect(screenshotMatchesType('image/png', PNG)).toBe(true);
    expect(screenshotMatchesType('image/jpeg', btoa('\xff\xd8\xff\xe0 jfif'))).toBe(true);
    expect(screenshotMatchesType('image/webp', btoa('RIFF\0\0\0\0WEBPVP8 '))).toBe(true);
    expect(screenshotMatchesType('image/jpeg', PNG)).toBe(false);
  });
});
