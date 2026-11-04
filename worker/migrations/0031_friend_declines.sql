-- Friend requests from a Rated ladder game after a decline (Dev Plan item
-- 19e, the owner on PR #75): once a player declines anyone's friend request,
-- however it came, the games they played on the ladder stop offering that
-- sender Add friend for a week. One row per sender and player, cleared after
-- 7 days and when either account is deleted.
CREATE TABLE friend_declines (
  sender_id TEXT NOT NULL REFERENCES accounts (id),
  declined_by TEXT NOT NULL REFERENCES accounts (id),
  -- When it was declined: milliseconds since the epoch, by the server's clock.
  at INTEGER NOT NULL,
  PRIMARY KEY (sender_id, declined_by)
);

CREATE INDEX friend_declines_by_time ON friend_declines (at);
