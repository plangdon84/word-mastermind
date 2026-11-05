-- One "friend request" alert a week from each sender to each player (Dev
-- Plan item 19za, the owner on 5 November 2026): a request withdrawn and
-- sent again still reaches the other player's list, but only the first in
-- a week alerts them. One row per sender and player: when they were last
-- alerted. Cleared after 7 days and when either account is deleted.
CREATE TABLE friend_request_alerts (
  sender_id TEXT NOT NULL REFERENCES accounts (id),
  recipient_id TEXT NOT NULL REFERENCES accounts (id),
  -- When the alert went: milliseconds since the epoch, by the server's clock.
  at INTEGER NOT NULL,
  PRIMARY KEY (sender_id, recipient_id)
);

CREATE INDEX friend_request_alerts_by_time ON friend_request_alerts (at);
