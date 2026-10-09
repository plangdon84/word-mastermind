-- Friends' profiles (Dev Plan item 18cb, round 2 review of PR #16): a
-- bookmark for each of an account's IDs (JSON: ID to game_players rowid),
-- so a newly linked guest ID's games are looked through from the start on
-- their own while the others carry on, instead of everyone's starting over.
-- It replaces played_through and players, which are no longer used.
ALTER TABLE shared_profiles ADD COLUMN bookmarks TEXT NOT NULL DEFAULT '{}';
