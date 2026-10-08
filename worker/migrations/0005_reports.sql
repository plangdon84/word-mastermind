-- Reports from the app's Report an issue form (README "Reporting an issue").
-- Each is filed as a GitHub issue when the worker has a token; the row is
-- kept either way, so a report is never lost, and it serves the screenshot
-- the issue shows.
CREATE TABLE reports (
  -- 32 hex digits, random: the screenshot's address, so nobody guesses one.
  id TEXT PRIMARY KEY,
  -- Who sent it (x-guest-id), for the rate limit. Never shown on GitHub.
  guest_id TEXT NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  -- The issue as filed (or to file): its title and Markdown body.
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  -- The screenshot's media type and base64 data, or NULL without one.
  screenshot_type TEXT,
  screenshot_data TEXT,
  -- The GitHub issue, once filed; NULL if filing failed or is off.
  issue_url TEXT
);

CREATE INDEX reports_by_guest ON reports (guest_id, created_at);
CREATE INDEX reports_by_time ON reports (created_at);
