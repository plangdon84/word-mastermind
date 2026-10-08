-- Each rated game's RD going in, so a change read back from `rated_games`
-- shows whether the rating before it was provisional (Competitive Rush
-- rebuilds a game's changes from these rows). Null for games rated before.
ALTER TABLE rated_games ADD COLUMN rd_before REAL;
