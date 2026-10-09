-- Friends' profiles kept ready (Dev Plan item 18cb): each account's games
-- as a friend sees them, and their stats and badges worked out from those
-- games, refreshed as games finish (worker/src/friendProfiles.ts). Both
-- are rebuilt from history_entries and games, so the wipe empties them.

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
  -- A server game: its games row, and its entry from their side, without
  -- their rating. NULL for a synced game, whose entry is history_entries'.
  game_seq INTEGER,
  entry TEXT,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX profile_games_by_start ON profile_games (account_id, started_at);

CREATE TABLE profile_summaries (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id),
  -- How far profile_games has copied: the last history_entries seq and
  -- games rowid, and how many guest IDs the account had (a newly linked
  -- one's games go back further, so they're looked through again).
  synced_through INTEGER NOT NULL,
  played_through INTEGER NOT NULL,
  players INTEGER NOT NULL,
  -- The Daily Rush day it was worked out on: a new day shows a Daily Set
  -- that was hidden, and moves the stats' trends on.
  day TEXT NOT NULL,
  -- JSON: the game count, stats, badges and the games the stats point at;
  -- NULL until worked out from every game copied.
  summary TEXT,
  updated_at INTEGER NOT NULL
);
