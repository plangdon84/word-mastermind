-- The usage dashboard (Dev Plan item 18m, src/admin.ts): indexes so its
-- counts over a period read only that period's rows, and its counts per mode
-- read an index rather than every game's record. Each expression matches the
-- query's exactly, as SQLite needs to use it.
CREATE INDEX games_by_played ON games (COALESCE(finished_at, started_at));
CREATE INDEX games_by_mode ON games (mode, json_extract(record, '$.kind'), started_at);
CREATE INDEX history_entries_by_start ON history_entries (started_at);
CREATE INDEX history_entries_by_mode ON history_entries (mode, started_at);
CREATE INDEX friend_game_players_by_time ON friend_game_players (added_at);
CREATE INDEX daily_played_by_time ON daily_played (played_at);
CREATE INDEX daily_played_by_day ON daily_played (day, mode);
CREATE INDEX player_activity_by_time ON player_activity (played_at);
CREATE INDEX guests_by_last_seen ON guests (last_seen_at);
CREATE INDEX guests_by_created ON guests (created_at);
CREATE INDEX accounts_by_created ON accounts (created_at);
