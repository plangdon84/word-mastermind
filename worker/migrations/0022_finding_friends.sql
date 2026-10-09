-- Finding friends (Dev Plan item 18d): a friend request sent by typing
-- someone's email, and searching players by name.

-- 1 on both rows of a request sent by email. The sender's 'sent' row stays
-- off their list until it's accepted (or they add the same player by code or
-- name), so the list never says whether an email has an account.
ALTER TABLE friends ADD COLUMN by_email INTEGER NOT NULL DEFAULT 0;

-- Each request by email an account sent, found or not, for the daily limit.
-- Never the email typed.
CREATE TABLE email_requests (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  -- Milliseconds since the epoch, by the server's clock.
  at INTEGER NOT NULL
);

CREATE INDEX email_requests_by_account ON email_requests (account_id, at);
