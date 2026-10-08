import { useEffect, useState } from 'preact/hooks';
import {
  isObject, SCREENSHOT_MAX, type IssueReport, type ReportContext, type ReportScreenshot,
} from '../game';
import { APP_VERSION } from './releases';

/*
 * Report an issue (README "Reporting an issue"): the server files each report
 * as a GitHub issue (`worker/src/reports.ts`). Any screen can open the form
 * with `openReport`; the app shows it over whatever is on screen.
 */

/** The version and build, for the report: Cloudflare Pages' commit, or "dev" (`vite.config.ts`). */
const APP_BUILD = `${APP_VERSION} (${(import.meta.env.VITE_APP_BUILD as string | undefined) || 'dev'})`;

/** What the screen asking for a report knows: where you are, and the game, if any. */
export interface ReportRequest {
  /** E.g. "Single player · Hard". */
  screen: string;
  /** The game being played, as saved; offered to include so it can be replayed. */
  record?: unknown;
}

let listener: ((request: ReportRequest) => void) | null = null;

/** Opens the Report an issue form over the current screen. */
export function openReport(request: ReportRequest): void {
  listener?.(request);
}

/** For the app shell: the open request (if any) and how to close it. */
export function useReportRequest(): [ReportRequest | null, () => void] {
  const [request, setRequest] = useState<ReportRequest | null>(null);
  useEffect(() => {
    listener = setRequest;
    return () => {
      listener = null;
    };
  }, []);
  return [request, () => setRequest(null)];
}

/** Who the report is from, as the issue shows it: "Paul (signed in)" or "Guest 1234 (guest)". */
export const reportFrom = (name: string, signedIn: boolean) => `${name} (${signedIn ? 'signed in' : 'guest'})`.slice(0, 400);

/** Where the player is and on what, read from the browser, and who they are (`reportFrom`). */
export function reportContext(screen: string, from: string): ReportContext {
  return {
    from,
    screen,
    app: APP_BUILD,
    browser: navigator.userAgent.slice(0, 400),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
    language: navigator.language,
  };
}

export type ReportErrorCode = 'too-many-reports' | 'bad-request' | 'unavailable' | 'unreachable';

export class ReportError extends Error {
  constructor(readonly code: ReportErrorCode) {
    super(`The report wasn't sent: ${code}`);
  }
}

export interface SentReport {
  id: string;
  /** The GitHub issue, or null if the server kept the report without filing it yet. */
  issueUrl: string | null;
}

/** Sends a report to the server, which files it. */
export async function sendReport(
  apiUrl: string, guestId: string, report: IssueReport, fetchFn: typeof fetch = fetch,
): Promise<SentReport> {
  // `VITE_API_URL` may end in a slash; `//api/reports` would miss the route.
  const response = await fetchFn(`${apiUrl.replace(/\/$/, '')}/api/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-guest-id': guestId },
    body: JSON.stringify(report),
  }).catch(() => null);
  if (!response) throw new ReportError('unreachable');
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ReportError(response.status === 429 ? 'too-many-reports' : response.status === 404 ? 'unavailable'
      : response.status >= 500 ? 'unreachable' : 'bad-request');
  }
  if (!isObject(body) || typeof body.id !== 'string') throw new ReportError('unreachable');
  return { id: body.id, issueUrl: typeof body.issueUrl === 'string' ? body.issueUrl : null };
}

/** The longest side of a screenshot as sent: plenty to read a phone screen. */
const SCREENSHOT_SIDE = 1600;

/**
 * Shrinks an image the player picked to a JPEG small enough to send, or
 * returns null if the browser can't read it as an image.
 */
export async function shrinkScreenshot(file: Blob): Promise<ReportScreenshot | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, SCREENSHOT_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  // JPEG has no transparency: a transparent PNG gets a white background, not black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5, 0.35]) {
    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    if (data.length > 0 && data.length <= SCREENSHOT_MAX) return { type: 'image/jpeg', data };
  }
  return null;
}
