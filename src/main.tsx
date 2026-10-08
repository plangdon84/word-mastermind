import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './app/styles.css';
import { render } from 'preact';
import { App } from './app/App';
import { API_URL } from './app/config';
import { preventDoubleTapZoom } from './app/doubleTap';
import { ReportHost } from './app/ReportIssue';
import { newAddress, redirectDue } from './app/moved';
import { registerServiceWorker } from './app/turnAlerts';
import { PROFILE_KEY } from './app/profileStorage';
import { noteFirstVisit } from './app/releases';

// The game has moved (Dev Plan item 18f, issue #92): once the day comes, the old address sends you on.
if (redirectDue(location.hostname, Date.now())) location.replace(newAddress(location));

// Before the app makes a profile: a first visit has no release notes to catch up on (issue #91).
noteFirstVisit(PROFILE_KEY);

render(
  <>
    <App />
    <ReportHost />
  </>,
  document.getElementById('root')!,
);

preventDoubleTapZoom(document);

// Turn alerts for games against a friend need the service worker.
if (API_URL) registerServiceWorker();
