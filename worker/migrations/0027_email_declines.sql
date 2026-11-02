-- Email friend requests after a decline (Dev Plan item 19a): once a player
-- declines a request that came by email, the sender's repeat requests to
-- them by email are ignored for a week. One row per sender and player,
-- cleared after 7 days and when either account is deleted.
CREATE TABLE email_declines (
  sender_id TEXT NOT NULL REFERENCES accounts (id),
  declined_by TEXT NOT NULL REFERENCES accounts (id),
  -- When it was declined: milliseconds since the epoch, by the server's clock.
  at INTEGER NOT NULL,
  PRIMARY KEY (sender_id, declined_by)
);

CREATE INDEX email_declines_by_time ON email_declines (at);
