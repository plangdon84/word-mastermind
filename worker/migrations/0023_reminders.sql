-- Reminders (Dev Plan item 18zj, README "Reminders"): time running out in a
-- correspondence game, the day's daily games at 8pm in New York, and coming
-- back after a week with no game. They reach only devices with turn alerts
-- on, and each kind has its own switch, on unless switched off.

-- A device's own switches, as it last sent them; signed in, the account's
-- synced settings (`profiles.settings`) must want each reminder too. A
-- device sends the dailies off while they're locked there, so devices from
-- before reminders have them off until the app next sends its switches.
ALTER TABLE push_subscriptions ADD COLUMN remind_time_low INTEGER NOT NULL DEFAULT 1;
ALTER TABLE push_subscriptions ADD COLUMN remind_dailies INTEGER NOT NULL DEFAULT 1;
ALTER TABLE push_subscriptions ADD COLUMN remind_come_back INTEGER NOT NULL DEFAULT 1;
UPDATE push_subscriptions SET remind_dailies = 0;

-- Who started each day's daily games, finished or not (the runs themselves
-- are in the day's Durable Object): the 8pm reminder skips what you played.
CREATE TABLE daily_played (
  -- The player's ID (their account's, once signed in).
  player_id TEXT NOT NULL,
  -- The day, as Daily Rush's are named (midnight to midnight in New York).
  day TEXT NOT NULL,
  -- daily (the Daily Set) or dailyWord.
  mode TEXT NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  played_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, day, mode)
);

-- When each player last played a game the server knows of: a finished
-- online game, a synced game, a friend game sent or accepted, a guess in one,
-- or a daily game started. Kept by the triggers below and by the game room.
CREATE TABLE player_activity (
  player_id TEXT PRIMARY KEY,
  played_at INTEGER NOT NULL
);

-- The last reminder of each kind sent to each player, and what it was about
-- (the day for the dailies, the last game's time for coming back), so each
-- is sent once. Written before sending.
CREATE TABLE reminders_sent (
  player_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  about TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, kind)
);

INSERT INTO player_activity (player_id, played_at)
SELECT player_id, MAX(played_at) FROM (
  SELECT gp.guest_id AS player_id, COALESCE(g.finished_at, g.started_at) AS played_at
    FROM game_players gp JOIN games g ON g.id = gp.game_id
  UNION ALL SELECT account_id, MIN(started_at, uploaded_at) FROM history_entries
  UNION ALL SELECT guest_id, added_at FROM friend_game_players
) GROUP BY player_id;

CREATE TRIGGER activity_game_players AFTER INSERT ON game_players
BEGIN
  INSERT INTO player_activity (player_id, played_at)
    SELECT NEW.guest_id, COALESCE(finished_at, started_at) FROM games WHERE id = NEW.game_id
    ON CONFLICT (player_id) DO UPDATE SET played_at = MAX(played_at, excluded.played_at);
END;

-- A synced game counts from when it started, never later than it arrived
-- (a device's clock can be ahead).
CREATE TRIGGER activity_history_entries AFTER INSERT ON history_entries
BEGIN
  INSERT INTO player_activity (player_id, played_at) VALUES (NEW.account_id, MIN(NEW.started_at, NEW.uploaded_at))
    ON CONFLICT (player_id) DO UPDATE SET played_at = MAX(played_at, excluded.played_at);
END;

CREATE TRIGGER activity_friend_game_players AFTER INSERT ON friend_game_players
BEGIN
  INSERT INTO player_activity (player_id, played_at) VALUES (NEW.guest_id, NEW.added_at)
    ON CONFLICT (player_id) DO UPDATE SET played_at = MAX(played_at, excluded.played_at);
END;

CREATE TRIGGER activity_daily_played AFTER INSERT ON daily_played
BEGIN
  INSERT INTO player_activity (player_id, played_at) VALUES (NEW.player_id, NEW.played_at)
    ON CONFLICT (player_id) DO UPDATE SET played_at = MAX(played_at, excluded.played_at);
END;
