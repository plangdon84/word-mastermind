import { isObject } from './records';

/*
 * Report an issue (README "Reporting an issue"): what the app sends and how
 * the server turns it into a GitHub issue. Shared by both, so the app's
 * fallback (opening GitHub's new-issue page) reads the same as an issue the
 * server files.
 */

export const REPORT_KINDS = ['bug', 'idea', 'words'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  bug: 'Something went wrong', idea: 'An idea or request', words: 'A word or definition',
};

/** The GitHub label each kind is filed under, beside `REPORT_LABEL`. */
export const REPORT_KIND_ISSUE_LABEL: Record<ReportKind, string> = { bug: 'bug', idea: 'enhancement', words: 'word-list' };
/** Every issue from the app carries this label, so they can be picked up in one list. */
export const REPORT_LABEL = 'from-app';

export const DESCRIPTION_MAX = 2000;
/** The game's record, as JSON. A long Rush is a few kB. */
export const RECORD_MAX = 20_000;
/** The screenshot, base64-encoded: about 1 MB of image. The app shrinks it well below this first. */
export const SCREENSHOT_MAX = 1_400_000;
export const SCREENSHOT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ScreenshotType = (typeof SCREENSHOT_TYPES)[number];

/** Where the player was and what with, filled in by the app. */
export interface ReportContext {
  /** E.g. "Single player · Hard". */
  screen: string;
  /** The build: a commit, or "dev". */
  app: string;
  /** The browser's user agent. */
  browser: string;
  /** E.g. "390×844". */
  viewport: string;
  /** E.g. "en-GB". */
  language: string;
  /**
   * Who sent it: their display name and whether they're signed in, e.g.
   * "Paul (signed in)". Never a guest ID, email or friend code. Missing from
   * reports from versions before 1.2.0 (Dev Plan item 18l).
   */
  from?: string;
}

export interface ReportScreenshot {
  type: ScreenshotType;
  /** Base64, without a `data:` prefix. */
  data: string;
}

export interface IssueReport {
  kind: ReportKind;
  description: string;
  context: ReportContext;
  /** The game being played, as saved (a record replays it), if the player chose to include it. */
  record: unknown;
  screenshot: ReportScreenshot | null;
}

const CONTEXT_KEYS = ['screen', 'app', 'browser', 'viewport', 'language'] as const;
const isShort = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Reads a report defensively, as the server gets it; null if anything is missing or too big. */
export function parseReport(value: unknown): IssueReport | null {
  if (!isObject(value)) return null;
  const { kind, description, context, record, screenshot } = value;
  if (!REPORT_KINDS.includes(kind as ReportKind)) return null;
  if (!isShort(description, DESCRIPTION_MAX) || description.trim() === '') return null;
  if (!isObject(context) || !CONTEXT_KEYS.every((k) => isShort(context[k], 400))) return null;
  if (record !== null && (!isObject(record) || JSON.stringify(record).length > RECORD_MAX)) return null;
  let shot: ReportScreenshot | null = null;
  if (screenshot !== null) {
    if (!isObject(screenshot) || !SCREENSHOT_TYPES.includes(screenshot.type as ScreenshotType)) return null;
    if (!isShort(screenshot.data, SCREENSHOT_MAX) || !BASE64.test(screenshot.data)) return null;
    shot = { type: screenshot.type as ScreenshotType, data: screenshot.data };
  }
  if (context.from !== undefined && !isShort(context.from, 400)) return null;
  const ctx = Object.fromEntries(CONTEXT_KEYS.map((k) => [k, context[k]])) as unknown as ReportContext;
  if (context.from !== undefined) ctx.from = context.from;
  return { kind: kind as ReportKind, description: description.trim(), context: ctx, record, screenshot: shot };
}

/**
 * Stops text the player typed from pinging people (`@name`) or closing
 * issues (`fixes #3`) once it's on GitHub: a zero-width space after `@` and
 * `#` leaves it readable.
 */
export const defang = (text: string) => text.replace(/([@#])(?=\w)/g, '$1​');

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** "[Bug] The keyboard froze after…", at most about 80 characters. */
export function issueTitle(report: Pick<IssueReport, 'kind' | 'description'>): string {
  const prefix = { bug: '[Bug]', idea: '[Idea]', words: '[Words]' }[report.kind];
  const summary = oneLine(defang(report.description));
  return `${prefix} ${summary.length > 72 ? `${summary.slice(0, 71).trimEnd()}…` : summary}`;
}

export interface IssueExtras {
  /** The server's ID for the report, or null in the app's fallback. */
  id: string | null;
  /** Where the screenshot is served, or null without one. */
  screenshotUrl: string | null;
  /** When it was sent, in milliseconds since the epoch. */
  sentAt: number;
}

/** The issue's body in GitHub Markdown: what happened, the screenshot, where, then the game. */
export function issueBody(report: IssueReport, { id, screenshotUrl, sentAt }: IssueExtras): string {
  const { context: c } = report;
  const lines = [
    '### What happened',
    '',
    defang(report.description),
    '',
    '### Screenshot',
    '',
    screenshotUrl ? `![Screenshot](${screenshotUrl})` : '_None attached._',
    '',
    '### Where',
    '',
    ...(c.from ? [`- **From:** ${oneLine(defang(c.from))}`] : []),
    `- **Kind:** ${REPORT_KIND_LABEL[report.kind]}`,
    `- **Screen:** ${oneLine(defang(c.screen))}`,
    `- **App build:** \`${oneLine(c.app).replace(/`/g, '')}\``,
    `- **Browser:** ${oneLine(defang(c.browser))}`,
    `- **Viewport:** ${oneLine(c.viewport)} · **Language:** ${oneLine(c.language)}`,
    `- **Sent:** ${new Date(sentAt).toISOString().replace('T', ' ').slice(0, 16)} UTC${id ? ` · report \`${id}\`` : ''}`,
  ];
  if (report.record !== null) {
    lines.push(
      '',
      '<details><summary>Game record (replays the game; includes the secret words)</summary>',
      '',
      '```json',
      JSON.stringify(report.record, null, 1).replace(/```/g, ''),
      '```',
      '',
      '</details>',
    );
  }
  lines.push('', '---', '_Sent from the app with Report an issue._');
  return lines.join('\n');
}
