-- Friends' profiles, rebuilt (Dev Plan item 18cb): PR #14's tables, which
-- the server filled by working out stats itself, are replaced. Both were
-- only ever filled by that PR, which was reverted, so nothing is lost.
DROP TABLE IF EXISTS profile_games;
DROP TABLE IF EXISTS profile_summaries;

-- Each account's games as a friend sees them, indexed by its own devices'
-- requests a few at a time (worker/src/friendProfiles.ts).
CREATE TABLE profile_games (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  -- The history entry's ID.
  id TEXT NOT NULL,
  -- The record's start, which the history lists newest first by.
  started_at INTEGER NOT NULL,
  -- What the history's filters match: the mode, the result ('won', 'lost',
  -- 'drawn' or NULL), the easiest difficulty used, and every secret word
  -- and guess, each with a space before and after.
  mode TEXT NOT NULL,
  result TEXT,
  difficulty TEXT NOT NULL,
  words TEXT NOT NULL,
  -- A Daily Set's day: friends see it only from the day after it is over.
  daily_day TEXT,
  -- A Word Set with friends: their place (1 is first; 1000000 if they
  -- weren't placed; NULL without one), for your record against them.
  rank INTEGER,
  -- A server game: its games row, and its entry from their side, built by
  -- the server, without their rating. NULL for a synced game, whose entry
  -- is history_entries'.
  game_seq INTEGER,
  entry TEXT,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX profile_games_by_start ON profile_games (account_id, started_at);

-- What each account shares with friends: its stats and badges as its own
-- device worked them out (JSON, NULL until one sends them), and how far
-- profile_games has indexed its synced and server games.
CREATE TABLE shared_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id),
  summary TEXT,
  summary_at INTEGER,
  -- The last history_entries seq and games rowid indexed, and how many
  -- guest IDs the account had (a newly linked one's games go back
  -- further, so they're looked through again).
  synced_through INTEGER NOT NULL DEFAULT 0,
  played_through INTEGER NOT NULL DEFAULT 0,
  players INTEGER NOT NULL DEFAULT 0,
  -- JSON: games rowids whose room couldn't answer for now, to retry.
  retry TEXT NOT NULL DEFAULT '[]'
);
