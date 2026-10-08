-- Ratings (Dev Plan item 10, README "Rating"): Glicko-2, for signed-in
-- players, one per pool: each live clock ('15m', '10m', '5m') and
-- 'correspondence'. Only rated games against another person change them.
CREATE TABLE ratings (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  pool TEXT NOT NULL,
  rating REAL NOT NULL,
  rd REAL NOT NULL,
  volatility REAL NOT NULL,
  -- Rated games played in this pool.
  games INTEGER NOT NULL,
  -- When the last one ended, in milliseconds since the epoch: RD widens for
  -- each week since (`ageRating`).
  rated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, pool)
);

-- Each rated game's change for each player, so a game is rated once and its
-- change can be shown later.
CREATE TABLE rated_games (
  game_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  pool TEXT NOT NULL,
  rating_before REAL NOT NULL,
  rating_after REAL NOT NULL,
  rd_after REAL NOT NULL,
  rated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, account_id)
);

CREATE INDEX rated_games_by_account ON rated_games (account_id, rated_at);
