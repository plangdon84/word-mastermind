-- A friend's history has listed games by when each ended since 0033 (Dev Plan
-- item 19z), so profile_games.started_at is no longer read (Dev Plan item
-- 19ze). Every worker since 2.4.1 writes ended_at itself, so 0033's trigger,
-- which filled it in for a worker from before that and fell back to the
-- start, goes too: SQLite won't drop a column a trigger still names.
DROP TRIGGER IF EXISTS profile_games_ended;
ALTER TABLE profile_games DROP COLUMN started_at;
