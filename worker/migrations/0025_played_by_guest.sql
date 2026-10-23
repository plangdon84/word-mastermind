-- Your finished online games (Dev Plan item 18zd, Issue 209): each
-- game_players row keeps its game's rowid (game_seq, the cursor of
-- GET /api/played), so a page reads each of your IDs' games in order from
-- where the device got to, through game_players_by_guest_seq, instead of
-- every game you've played.
ALTER TABLE game_players ADD COLUMN game_seq INTEGER;
UPDATE game_players SET game_seq = (SELECT rowid FROM games WHERE games.id = game_players.game_id);
CREATE INDEX game_players_by_guest_seq ON game_players (guest_id, game_seq);

-- Every game is saved before its players, so the trigger finds its rowid.
CREATE TRIGGER game_players_seq AFTER INSERT ON game_players
BEGIN
  UPDATE game_players SET game_seq = (SELECT rowid FROM games WHERE id = NEW.game_id) WHERE rowid = NEW.rowid;
END;
