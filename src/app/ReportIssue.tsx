import { useEffect, useState } from 'preact/hooks';
import {
  DESCRIPTION_MAX, REPORT_KIND_LABEL, REPORT_KINDS, type IssueReport, type ReportKind, type ReportScreenshot,
} from '../game';
import { Modal } from './panels';
import { API_URL } from './config';
import { loadSession } from './account';
import { displayName, loadProfile } from './profileStorage';
import {
  ReportError, reportContext, reportFrom, sendReport, shrinkScreenshot, type ReportErrorCode, type ReportRequest,
  type SentReport, useReportRequest,
} from './reportIssue';

/** Why a report wasn't sent. Only a report with a screenshot is told to try a smaller one. */
function failedMessage(error: ReportErrorCode, withScreenshot: boolean): string {
  switch (error) {
    case 'too-many-reports':
      return "You've sent several reports in the last hour. Try again later.";
    case 'bad-request':
      return withScreenshot
        ? "The report couldn't be sent as it is. Try a smaller screenshot."
        : "The report couldn't be sent as it is. Try again later.";
    case 'unavailable':
      return "Reports can't be taken right now. Try again later.";
    case 'unreachable':
      return "Can't reach the server. Check your connection and try again.";
  }
}

const PLACEHOLDER: Record<ReportKind, string> = {
  bug: 'What happened, and what did you expect? What were you doing just before?',
  idea: 'What would you like the game to do?',
  words: 'Which word, and what is wrong with it? (Missing from the list, not a real word, a wrong definition…)',
};

/**
 * The Report an issue form: what kind, what happened, an optional screenshot
 * and, in a game, the game itself. Sent to the server, which files it in the
 * private archive; without a server (or if it fails), it says to try again
 * later, keeping what was typed. There's no fallback to GitHub's own form:
 * issues are off in the public repo, and a report can hold game data.
 */
export function ReportIssue({ request, apiUrl, guestId, from, onClose }: {
  request: ReportRequest;
  /** Who it's from, as `reportFrom` writes it: shown on the form and sent. */
  from: string;
  /** Null in a build without a server: the report can't be sent. */
  apiUrl: string | null;
  guestId: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ReportKind>('bug');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState<ReportScreenshot | null>(null);
  const [shotError, setShotError] = useState(false);
  const hasRecord = request.record !== undefined && request.record !== null;
  const [includeGame, setIncludeGame] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ReportErrorCode | null>(null);
  const [sent, setSent] = useState<SentReport | null>(null);
  const [missing, setMissing] = useState(false);

  // A preview of the screenshot as it will be sent.
  const preview = screenshot && `data:${screenshot.type};base64,${screenshot.data}`;
  useEffect(() => setError(null), [kind, description, screenshot, includeGame]);

  const report = (): IssueReport => ({
    kind,
    description: description.trim(),
    context: reportContext(request.screen, from),
    record: hasRecord && includeGame ? request.record : null,
    screenshot,
  });

  const pickScreenshot = async (file: File | undefined) => {
    if (!file) return;
    const shrunk = await shrinkScreenshot(file);
    setShotError(shrunk === null);
    setScreenshot(shrunk);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!description.trim()) {
      setMissing(true);
      return;
    }
    if (!apiUrl) {
      setError('unavailable');
      return;
    }
    setSending(true);
    try {
      setSent(await sendReport(apiUrl, guestId, report()));
    } catch (err) {
      setError(err instanceof ReportError ? err.code : 'unreachable');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Modal title="Thanks for the report" onClose={onClose}>
        <p>It's sent, and will be looked at for a future version. What's new lists each version's fixes.</p>
        <div class="row-btns">
          <button type="button" class="btn primary" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Report an issue" onClose={onClose}>
      <form class="report-form" onSubmit={submit} noValidate>
        <div class="choices compact" role="group" aria-label="What kind of issue">
          {REPORT_KINDS.map((k) => (
            <button type="button" class="choice" key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>
              <span class="choice-label">{REPORT_KIND_LABEL[k]}</span>
            </button>
          ))}
        </div>

        <label class="report-field">
          <span class="menu-label">Describe it</span>
          <textarea class="text-input" rows={5} maxLength={DESCRIPTION_MAX} value={description}
            placeholder={PLACEHOLDER[kind]} aria-invalid={missing && !description.trim()}
            onInput={(e) => {
              setDescription(e.currentTarget.value);
              setMissing(false);
            }} />
          {missing && !description.trim() && <span class="field-note error">Say what happened first.</span>}
        </label>

        <div class="report-field">
          <span class="menu-label">Screenshot (optional)</span>
          {preview ? (
            <div class="report-shot">
              <img src={preview} alt="The screenshot to send" />
              <button type="button" class="btn small" onClick={() => setScreenshot(null)}>Remove</button>
            </div>
          ) : (
            <label class="btn small report-pick">
              Add a screenshot
              <input type="file" accept="image/*" hidden
                onChange={(e) => {
                  void pickScreenshot(e.currentTarget.files?.[0]);
                  e.currentTarget.value = '';
                }} />
            </label>
          )}
          {shotError && <span class="field-note error">That file couldn't be read as an image.</span>}
        </div>

        {hasRecord && (
          <label class="toggle">
            <input type="checkbox" checked={includeGame} onChange={(e) => setIncludeGame(e.currentTarget.checked)} />
            Include this game, so it can be replayed (its guesses and secret words)
          </label>
        )}

        <p class="field-note">
          Reports go privately to the game's developer, with your name as others see it ({from}), your browser
          and screen size, never your email. Leave out anything personal.
        </p>
        {error && (
          <p class="field-note error" role="alert">
            {failedMessage(error, screenshot !== null)}
          </p>
        )}
        <div class="row-btns">
          <button type="submit" class="btn primary" disabled={sending}>
            {sending ? 'Sending…' : 'Send report'}
          </button>
          <button type="button" class="btn" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

/** Shows the form whenever a screen calls `openReport`. Mounted beside the app, over every screen. */
export function ReportHost() {
  const [request, close] = useReportRequest();
  if (!request) return null;
  // The profile as the app last saved it: its device ID is who the report is from.
  const profile = loadProfile();
  return (
    <ReportIssue request={request} apiUrl={API_URL} guestId={profile.deviceId}
      from={reportFrom(displayName(profile), loadSession() !== null)} onClose={close} />
  );
}
