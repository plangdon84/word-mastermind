import { useReportRequest } from './reportIssue';
import { ReportForm } from './screens';

/**
 * Shows the report form whenever a screen calls `openReport`. Mounted beside
 * the app, over every screen. The form itself loads after the page has (Dev
 * Plan item 19zq); only this stays at start-up.
 */
export function ReportHost() {
  const [request, close] = useReportRequest();
  return request ? <ReportForm request={request} onClose={close} /> : null;
}
