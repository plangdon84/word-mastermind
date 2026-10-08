-- Friends (Dev Plan item 9): signed-in players add each other by friend
-- code, then challenge each other or invite each other to a Rush with
-- Friends lobby.

-- Each account's friend code: 8 letters and digits, made the first time the
-- friends list is opened. Public, unlike the account's ID: it finds a player
-- to add, and shows only their name.
ALTER TABLE accounts ADD COLUMN friend_code TEXT;

CREATE UNIQUE INDEX accounts_by_friend_code ON accounts (friend_code);

-- Two rows per pair, one from each side: 'sent' (account_id asked
-- friend_id), 'received' (friend_id asked account_id), or 'friends' once the
-- request is accepted.
CREATE TABLE friends (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  friend_id TEXT NOT NULL REFERENCES accounts (id),
  state TEXT NOT NULL,
  -- Milliseconds since the epoch, by the server's clock: when it was asked, then accepted.
  since INTEGER NOT NULL,
  PRIMARY KEY (account_id, friend_id)
);

-- A host invited a friend to their Rush with Friends lobby. It's listed on
-- the friend's title screen until they join, the lobby starts or closes, or
-- a day passes.
CREATE TABLE lobby_invites (
  -- Who is invited.
  account_id TEXT NOT NULL REFERENCES accounts (id),
  -- The lobby's join code.
  code TEXT NOT NULL,
  -- The host's name when they sent it.
  from_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, code)
);
