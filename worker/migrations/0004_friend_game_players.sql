-- Which games against a friend each player is in, from the moment they send
-- or accept the invite, so a player who signs in on another device finds
-- their games there (GET /api/games). The game itself lives in its Durable
-- Object; finished ones are in `games` too.
CREATE TABLE friend_game_players (
  game_id TEXT NOT NULL,
  -- The player's ID when they sent or accepted the invite.
  guest_id TEXT NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  added_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, guest_id)
);

CREATE INDEX friend_game_players_by_guest ON friend_game_players (guest_id, added_at);
