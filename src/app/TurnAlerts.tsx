import { useEffect, useState } from 'preact/hooks';
import type { ApiIdentity } from './apiIdentity';
import {
  alertsPromptDismissed, alertsState, disableAlerts, dismissAlertsPrompt, enableAlerts, type AlertsState,
} from './turnAlerts';

/** This device's turn-alert state, null while it's being checked. */
function useAlerts(apiUrl: string, identity: ApiIdentity) {
  const [state, setState] = useState<AlertsState | null>(null);
  const [busy, setBusy] = useState(false);
  /** The last change didn't work: a private window, say, where browsers refuse push. */
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    alertsState(apiUrl).then((s) => live && setState(s), () => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, [apiUrl]);
  const change = (action: typeof enableAlerts, wanted: AlertsState) => {
    setBusy(true);
    setFailed(false);
    action(apiUrl, identity).then((s) => {
      setState(s);
      // Blocked and server-off say why in their own words; only a browser that refused needs FAILED.
      setFailed(s !== wanted && s !== 'blocked' && s !== 'server-off');
    }, () => setFailed(true)).finally(() => setBusy(false));
  };
  return {
    state, busy, failed,
    enable: () => change(enableAlerts, 'on'),
    disable: () => change(disableAlerts, 'off'),
  };
}

const FAILED = "Couldn't turn on turn alerts in this browser. Private windows can't get them; "
  + 'otherwise, try again.';

const HOME_SCREEN_TIP = 'On iPhone and iPad, turn alerts need the game on your Home Screen: in Safari, tap Share, '
  + 'then Add to Home Screen, and open the game from there.';

/**
 * The in-game offer to turn alerts on, shown until they're on or you say
 * "Not now". It says nothing where alerts can't work.
 */
export function TurnAlertsPrompt({ apiUrl, identity, offer = "Get a notification when it's your turn, even with the game closed." }: {
  apiUrl: string;
  identity: ApiIdentity;
  /** What turning them on gets you here. */
  offer?: string;
}) {
  const { state, busy, failed, enable } = useAlerts(apiUrl, identity);
  const [dismissed, setDismissed] = useState(alertsPromptDismissed);
  if (dismissed || (state !== 'off' && state !== 'needs-home-screen')) return null;
  const notNow = () => {
    dismissAlertsPrompt();
    setDismissed(true);
  };
  return (
    <section class="alerts-card" aria-label="Turn alerts">
      {state === 'off' ? (
        <>
          <p>{failed ? FAILED : offer}</p>
          <div class="row-btns">
            <button type="button" class="btn primary small" disabled={busy} onClick={enable}>Turn on turn alerts</button>
            <button type="button" class="btn small" onClick={notNow}>Not now</button>
          </div>
        </>
      ) : (
        <>
          <p>{HOME_SCREEN_TIP}</p>
          <div class="row-btns"><button type="button" class="btn small" onClick={notNow}>Got it</button></div>
        </>
      )}
    </section>
  );
}

const STATE_TEXT: Record<AlertsState, string> = {
  'on': "On for this device. You get a notification when it's your turn against a friend, and when players finish a Rush with Friends.",
  'off': "Off. Turn them on to get a notification when it's your turn against a friend, and when players finish a Rush with Friends.",
  'blocked': "Blocked. Notifications for this site are turned off in your browser's settings; allow them there first.",
  'needs-home-screen': HOME_SCREEN_TIP,
  'unsupported': "This browser can't show turn alerts.",
  'server-off': "The game server isn't set up to send turn alerts.",
};

/** The profile's setting: turn alerts on or off for this device. */
export function TurnAlertsSetting({ apiUrl, identity }: { apiUrl: string; identity: ApiIdentity }) {
  const { state, busy, failed, enable, disable } = useAlerts(apiUrl, identity);
  return (
    <div class="menu-group alerts-setting">
      <span class="menu-label">Turn alerts</span>
      {state && <span class="field-note">{STATE_TEXT[state]}</span>}
      {failed && <span class="field-note error">{FAILED}</span>}
      {state === 'off' && (
        <button type="button" class="btn small" disabled={busy} onClick={enable}>Turn on</button>
      )}
      {state === 'on' && (
        <button type="button" class="btn small" disabled={busy} onClick={disable}>Turn off</button>
      )}
    </div>
  );
}
