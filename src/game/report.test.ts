import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX, defang, issueBody, issueTitle, parseReport, RECORD_MAX, type IssueReport,
} from './report';

const context = { screen: 'Single player · Hard', app: 'abc1234', browser: 'Test/1.0', viewport: '390×844', language: 'en-GB' };
const report = (over: Partial<IssueReport> = {}): IssueReport => ({
  kind: 'bug', description: 'The keyboard froze after my third guess.', context, record: null, screenshot: null, ...over,
});
const SENT = Date.UTC(2026, 8, 28, 12, 30);

describe('parseReport', () => {
  it('accepts a report as the app sends it', () => {
    const png = { type: 'image/png', data: 'iVBORw0KGgo=' };
    expect(parseReport({ ...report(), screenshot: png })).toEqual({ ...report(), screenshot: png });
  });

  it('trims the description and refuses an empty one', () => {
    expect(parseReport(report({ description: '  Hi  ' }))?.description).toBe('Hi');
    expect(parseReport(report({ description: '   ' }))).toBeNull();
  });

  it('refuses anything missing, unknown or too big', () => {
    expect(parseReport(null)).toBeNull();
    expect(parseReport({ ...report(), kind: 'spam' })).toBeNull();
    expect(parseReport(report({ description: 'x'.repeat(DESCRIPTION_MAX + 1) }))).toBeNull();
    expect(parseReport({ ...report(), context: { ...context, screen: 1 } })).toBeNull();
    expect(parseReport(report({ record: { moves: 'x'.repeat(RECORD_MAX) } }))).toBeNull();
    expect(parseReport({ ...report(), screenshot: { type: 'image/gif', data: 'R0lG' } })).toBeNull();
    expect(parseReport({ ...report(), screenshot: { type: 'image/png', data: 'not base64!' } })).toBeNull();
  });
});

describe('issueTitle', () => {
  it('prefixes the kind and keeps it short', () => {
    expect(issueTitle(report())).toBe('[Bug] The keyboard froze after my third guess.');
    const long = issueTitle(report({ kind: 'idea', description: 'word '.repeat(40) }));
    expect(long.startsWith('[Idea] word word')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('defang', () => {
  it("keeps typed text from pinging people or closing issues", () => {
    expect(defang('@octocat fixes #3')).toBe('@​octocat fixes #​3');
    expect(defang('C# and a lone @')).toBe('C# and a lone @');
  });
});

describe('issueBody', () => {
  it('lays out what happened, the screenshot and where', () => {
    const body = issueBody(report(), { id: 'r1', screenshotUrl: 'https://api.example/api/reports/r1/screenshot', sentAt: SENT });
    expect(body).toContain('### What happened\n\nThe keyboard froze after my third guess.');
    expect(body).toContain('![Screenshot](https://api.example/api/reports/r1/screenshot)');
    expect(body).toContain('- **Screen:** Single player · Hard');
    expect(body).toContain('- **Sent:** 2026-09-28 12:30 UTC · report `r1`');
    expect(body).not.toContain('Game record');
  });

  it('adds the game record, folded away, when included', () => {
    const body = issueBody(report({ record: { secret: 'beach', moves: [] } }), { id: null, screenshotUrl: null, sentAt: SENT });
    expect(body).toContain('_None attached._');
    expect(body).toContain('<details><summary>Game record');
    expect(body).toContain('"secret": "beach"');
  });
});
