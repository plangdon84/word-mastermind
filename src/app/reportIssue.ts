import { createContext } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  isObject, SCREENSHOT_MAX, type IssueReport, type ReportContext, type ReportKind, type ReportScreenshot,
} from '../game';
import { APP_VERSION } from './version';
import { apiBase, requestTimeout } from './apiIdentity';

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
  /** The kind the form starts on (Bug if not given). */
  kind?: ReportKind;
  /** What the description starts with: Report this word fills in the word. */
  description?: string;
}

/** The kind and description the form opens with. */
export function initialForm(request: ReportRequest): { kind: ReportKind; description: string } {
  return { kind: request.kind ?? 'bug', description: request.description ?? '' };
}

/**
 * Report this word (Dev Plan item 19zf): the screen's own Report an issue
 * request (its name and game), set to Words with the word at the start of
 * the description, for the player to say what's wrong with it.
 */
export function wordReportRequest(screen: ReportRequest, word: string): ReportRequest {
  return { ...screen, kind: 'words', description: `${word.toUpperCase()}: ` };
}

/**
 * What a screen's ☰ Report an issue would send, read when Report this word
 * is tapped; each game screen provides it around its board. Without it (the
 * tutorial's mock-ups) the definition box has no Report this word.
 */
export const WordReportContext = createContext<(() => ReportRequest) | null>(null);

let listener: ((request: ReportRequest) => void) | null = null;

/** Opens the Report an issue form over the current screen. */
export function openReport(request: ReportRequest): void {
  listener?.(request);
}

/** Who `openReport` tells: the app shell's form (`useReportRequest`), or a test. */
export function setReportListener(next: ((request: ReportRequest) => void) | null): void {
  listener = next;
}

/** For the app shell: the open request (if any) and how to close it. */
export function useReportRequest(): [ReportRequest | null, () => void] {
  const [request, setRequest] = useState<ReportRequest | null>(null);
  useEffect(() => {
    setReportListener(setRequest);
    return () => setReportListener(null);
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
  const response = await fetchFn(`${apiBase(apiUrl)}/api/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-guest-id': guestId },
    body: JSON.stringify(report),
    signal: requestTimeout(),
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
