import {
  issueBody, issueTitle, parseReport, REPORT_KIND_ISSUE_LABEL, REPORT_LABEL, type IssueReport, type ScreenshotType,
} from '../../src/game';
import { isGuestId } from './guests';
import { errorResponse, json, readJson } from './http';
import type { Env } from './index';
import { addressOf } from './limits';

/*
 * Report an issue (README "Reporting an issue"). The app sends a report; the
 * worker keeps it in D1 and files it as a GitHub issue with a fine-grained
 * token (`GITHUB_TOKEN`, Issues: read and write on `GITHUB_REPO`) that never
 * leaves the server. The screenshot is served from here and shown in the
 * issue, since GitHub's API can't attach images. Without a token (locally),
 * the issue is printed in the `wrangler dev` console instead.
 */

/** Reports one device may send an hour, so the form can't flood the issue tracker. */
export const REPORTS_PER_HOUR = 5;
/**
 * Reports one address may send an hour: a made-up guest ID gets round the
 * limit per device, not this one. More than one device's, since a household
 * or phone network can share an address.
 */
export const REPORTS_PER_ADDRESS_HOUR = 10;
/** Reports everyone together may send a day. */
export const REPORTS_PER_DAY = 100;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REPORT_ID = /^[0-9a-f]{32}$/;
const SCREENSHOT_PATH = /^\/api\/reports\/([^/]+)\/screenshot$/;

const newReportId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Does the image start the way its type says? A report can't smuggle in, say, HTML labelled as a PNG. */
export function screenshotMatchesType(type: ScreenshotType, data: string): boolean {
  let head: string;
  try {
    head = atob(data.slice(0, 16));
  } catch {
    return false;
  }
  switch (type) {
    case 'image/jpeg': return head.startsWith('\xff\xd8\xff');
    case 'image/png': return head.startsWith('\x89PNG');
    case 'image/webp': return head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP';
  }
}

/** An address, hashed: enough to count its reports, kept for an hour only (`sendReport`). */
async function hashAddress(address: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`report:${address}`)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** May this device, from this address (hashed; null outside Cloudflare), send a report now? */
async function mayReport(db: D1Database, guestId: string, ipHash: string | null, now: number): Promise<boolean> {
  const row = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM reports WHERE guest_id = ?1 AND created_at > ?2) AS mine,
       (SELECT COUNT(*) FROM reports WHERE ip_hash = ?4 AND created_at > ?2) AS here,
       (SELECT COUNT(*) FROM reports WHERE created_at > ?3) AS everyone`,
  ).bind(guestId, now - HOUR_MS, now - DAY_MS, ipHash).first<{ mine: number; here: number; everyone: number }>();
  return !row
    || (row.mine < REPORTS_PER_HOUR && row.here < REPORTS_PER_ADDRESS_HOUR && row.everyone < REPORTS_PER_DAY);
}

export interface Issue {
  title: string;
  body: string;
  labels: string[];
}

/** Files one issue; its address, or null if GitHub refused or couldn't be reached. */
export type IssueFiler = (issue: Issue) => Promise<string | null>;

/** How this environment files issues: on GitHub with a token, or printed in the console. */
export function issueFilerOf(env: Env, fetchFn: typeof fetch = fetch): IssueFiler {
  const { GITHUB_TOKEN: token, GITHUB_REPO: repo } = env;
  if (!token || !repo) {
    return async (issue) => {
      console.log(`Issue (not filed: no GITHUB_TOKEN or GITHUB_REPO): ${issue.title}\n${issue.body}`);
      return null;
    };
  }
  const post = (body: Partial<Issue>) => fetchFn(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'content-type': 'application/json',
      // GitHub refuses requests without one.
      'user-agent': 'word-mastermind-api',
    },
    body: JSON.stringify(body),
  }).catch(() => null);
  return async (issue) => {
    let response = await post(issue);
    // A label GitHub won't take (the token can't create it, say) shouldn't lose the report.
    if (response?.status === 422) response = await post({ title: issue.title, body: issue.body });
    if (!response?.ok) return null;
    const created = await response.json().catch(() => null) as { html_url?: unknown } | null;
    return typeof created?.html_url === 'string' ? created.html_url : null;
  };
}

async function sendReport(request: Request, env: Env, now: number, fetchFn: typeof fetch): Promise<Response> {
  const guestId = request.headers.get('x-guest-id');
  if (!isGuestId(guestId)) return errorResponse(400, 'bad-guest-id');
  const report: IssueReport | null = parseReport(await readJson(request));
  if (!report) return errorResponse(400, 'bad-request');
  const shot = report.screenshot;
  if (shot && !screenshotMatchesType(shot.type, shot.data)) return errorResponse(400, 'bad-request');
  // The address is needed only for the hour's limit: an hour on, it's forgotten.
  await env.DB.prepare('UPDATE reports SET ip_hash = NULL WHERE ip_hash IS NOT NULL AND created_at <= ?1').bind(now - HOUR_MS).run();
  const address = addressOf(request);
  const ipHash = address ? await hashAddress(address) : null;
  if (!await mayReport(env.DB, guestId, ipHash, now)) return errorResponse(429, 'too-many-reports');

  const id = newReportId();
  const screenshotUrl = shot ? `${new URL(request.url).origin}/api/reports/${id}/screenshot` : null;
  const title = issueTitle(report);
  const body = issueBody(report, { id, screenshotUrl, sentAt: now });
  await env.DB.prepare(
    `INSERT INTO reports (id, guest_id, created_at, kind, title, body, screenshot_type, screenshot_data, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  ).bind(id, guestId, now, report.kind, title, body, shot?.type ?? null, shot?.data ?? null, ipHash).run();

  const issueUrl = await issueFilerOf(env, fetchFn)({
    title, body, labels: [REPORT_KIND_ISSUE_LABEL[report.kind], REPORT_LABEL],
  });
  if (issueUrl) await env.DB.prepare('UPDATE reports SET issue_url = ?1 WHERE id = ?2').bind(issueUrl, id).run();
  return json({ id, issueUrl });
}

async function screenshot(db: D1Database, id: string): Promise<Response> {
  if (!REPORT_ID.test(id)) return errorResponse(404, 'not-found');
  const row = await db.prepare('SELECT screenshot_type, screenshot_data FROM reports WHERE id = ?1')
    .bind(id).first<{ screenshot_type: string | null; screenshot_data: string | null }>();
  if (!row?.screenshot_type || !row.screenshot_data) return errorResponse(404, 'not-found');
  const bytes = Uint8Array.from(atob(row.screenshot_data), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': row.screenshot_type,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
      // A report's screenshot never changes.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

/** Routes `/api/reports…`, or returns null for any other path. */
export async function routeReports(
  request: Request, env: Env, now: number, pathname: string, fetchFn: typeof fetch,
): Promise<Response | null> {
  if (pathname === '/api/reports' && request.method === 'POST') return sendReport(request, env, now, fetchFn);
  const match = SCREENSHOT_PATH.exec(pathname);
  if (match && request.method === 'GET') return screenshot(env.DB, match[1]);
  return null;
}
