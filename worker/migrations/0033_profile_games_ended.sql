-- A friend's history lists their games newest first by when each ended, the
-- date its row shows, so a rated game's rating follows on from the one below
-- it (Dev Plan item 19zc). Each indexed game keeps its end: its record's last
-- move, or its start without one (`summarizeGame`'s `endedAt`), set as it's
-- indexed (`indexRow` in worker/src/friendProfiles.ts), and filled in here
-- once for the games already indexed, from the entry (a synced game's is
-- history_entries').
ALTER TABLE profile_games ADD COLUMN ended_at INTEGER NOT NULL DEFAULT 0;

UPDATE profile_games SET ended_at = COALESCE((
  SELECT CASE WHEN json_valid(e.entry) THEN json_extract(e.entry, '$.record.moves[#-1].at') END
  FROM (SELECT COALESCE(profile_games.entry, (
    SELECT h.entry FROM history_entries h WHERE h.account_id = profile_games.account_id AND h.id = profile_games.id
  )) AS entry) e
), started_at);

DROP INDEX profile_games_by_start;
CREATE INDEX profile_games_by_end ON profile_games (account_id, ended_at);
