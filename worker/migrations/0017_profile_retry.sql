-- Friends' profiles (Dev Plan item 18cb, round 1 review): server games
-- whose room couldn't answer for now when copied into profile_games are
-- passed over, so they don't hold up the games after them, and asked
-- about again on the next refresh. JSON: their games rowids.
ALTER TABLE profile_summaries ADD COLUMN retry TEXT NOT NULL DEFAULT '[]';
