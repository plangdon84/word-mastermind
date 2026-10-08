-- Daily Rush leaderboards (Dev Plan item 7): one row per player per day, once
-- they've found all 4 words. A run given up, or not finished by the day's
-- end, has no row. The run itself is in `games` (mode 'daily') and in the
-- day's Durable Object.
CREATE TABLE daily_results (
  -- The UTC day, e.g. 2026-10-31.
  day TEXT NOT NULL,
  -- The player's ID (their account's, once signed in).
  player_id TEXT NOT NULL,
  -- medium, hard or extreme: each has its own leaderboard.
  difficulty TEXT NOT NULL,
  -- Their display name when they started.
  name TEXT NOT NULL,
  -- Ranked by total guesses, then total time (milliseconds, start to last word found).
  guesses INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (day, player_id)
);

CREATE INDEX daily_results_board ON daily_results (day, difficulty, guesses, ms);
CREATE INDEX daily_results_by_player ON daily_results (player_id, day);
