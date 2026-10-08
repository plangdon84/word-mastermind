-- Guests: a player known only by the ID their device created (the profile's
-- deviceId). Accounts (Dev Plan item 6) will upgrade a guest in place.
CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  -- Milliseconds since the epoch, by the server's clock.
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

-- Game history: games the server refereed. As in the app, a game is its
-- record (JSON: secret words, start time, moves) and everything else is
-- rebuilt by replaying it, so no scores or results are stored.
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  -- The history entry version (HISTORY_VERSION in src/game/history.ts).
  version INTEGER NOT NULL,
  record TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- Who played in each game, so a player's history is one indexed lookup.
CREATE TABLE game_players (
  game_id TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests (id),
  PRIMARY KEY (game_id, guest_id)
);

CREATE INDEX game_players_by_guest ON game_players (guest_id);
