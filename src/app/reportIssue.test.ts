import { describe, expect, it } from 'vitest';
import type { IssueReport } from '../game';
import { ReportError, sendReport } from './reportIssue';

const GUEST = '0f8b6c2e-5d4a-4b1c-9e3f-2a7d8c6b5e41';
const report: IssueReport = {
  kind: 'bug', description: 'Test', record: null, screenshot: null,
  context: { screen: 'Title screen', app: 'dev', browser: 'Test', viewport: '1×1', language: 'en' },
};

/** A server that records where it was called and answers with `status`. */
function server(status: number, body: unknown = { id: 'r1', issueUrl: null }) {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(body, { status });
  }) as typeof fetch;
  return { urls, fetchFn };
}

const failure = (promise: Promise<unknown>) => promise.then(() => null, (e: unknown) => (e as ReportError).code);

describe('sendReport', () => {
  it('posts to /api/reports, with or without a trailing slash on the address', async () => {
    const { urls, fetchFn } = server(200);
    expect(await sendReport('https://api.example', GUEST, report, fetchFn)).toEqual({ id: 'r1', issueUrl: null });
    await sendReport('https://api.example/', GUEST, report, fetchFn);
    expect(urls).toEqual(['https://api.example/api/reports', 'https://api.example/api/reports']);
  });

  it('tells a missing route, a refusal, a limit and a failure apart', async () => {
    expect(await failure(sendReport('https://api.example', GUEST, report, server(404, { error: 'not-found' }).fetchFn))).toBe('unavailable');
    expect(await failure(sendReport('https://api.example', GUEST, report, server(400, { error: 'bad-request' }).fetchFn))).toBe('bad-request');
    expect(await failure(sendReport('https://api.example', GUEST, report, server(429, { error: 'too-many-reports' }).fetchFn))).toBe('too-many-reports');
    expect(await failure(sendReport('https://api.example', GUEST, report, server(500, {}).fetchFn))).toBe('unreachable');
  });
});
