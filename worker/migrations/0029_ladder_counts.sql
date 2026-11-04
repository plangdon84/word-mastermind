-- The rated ladder's computer games kept on each rating row (Dev Plan item
-- 19x): how many of the pool's rated games were against a ladder computer,
-- counted as each game is rated (`ratingStatements`), so a board reads one
-- number per row rather than counting the player's `rated_games` each time.
-- Filled in once here from the games already rated.
ALTER TABLE ratings ADD COLUMN computer_games INTEGER NOT NULL DEFAULT 0;
UPDATE ratings SET computer_games = (
  SELECT COUNT(*) FROM rated_games g
  WHERE g.account_id = ratings.account_id AND g.pool = ratings.pool AND g.computer_recall IS NOT NULL
);

-- The usage dashboard's ladder table (Dev Plan item 19x, `worker/src/admin.ts`)
-- counts only the last 90 days of games against a ladder computer: this
-- index holds only those games, by when each was rated, so it reads just
-- that period's rows. Its filter matches the query's, as SQLite needs.
CREATE INDEX rated_games_computer_by_time ON rated_games (rated_at) WHERE computer_recall IS NOT NULL;
