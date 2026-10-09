-- Friends' profiles (Dev Plan item 18cb, round 1 review of PR #16): server
-- games are indexed in the order their game_players rows were added (as
-- each game finishes), so each request reads only the rows after its
-- bookmark, not a player's whole history; and whether a game is indexed
-- already is one lookup.
CREATE INDEX profile_games_by_game ON profile_games (account_id, game_seq);

-- played_through now counts game_players rows: indexing server games
-- starts over (only staging has indexed any).
UPDATE shared_profiles SET played_through = 0;

-- Your record against a friend reads only your games against people.
CREATE INDEX profile_games_by_mode ON profile_games (account_id, mode);
