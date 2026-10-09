-- The Daily Word (Dev Plan item 7b): one word a day, the same for everyone.
-- Each day's word, picked at random from the secret list by the server the
-- first time someone starts that day's (`worker/src/dailyWords.ts`), so
-- nothing in the public repo can tell what it will be.
CREATE TABLE daily_words (
  -- The day, as Daily Rush's are named (midnight to midnight in New York).
  day TEXT PRIMARY KEY,
  word TEXT NOT NULL
);

-- The Daily Word's leaderboards: one row per player per day, once they've
-- found the word, as `daily_results` is for the Daily Set. Ranked by fewest
-- guesses, then time. The run itself is in `games` (mode 'dailyWord') and in
-- the day's Durable Object.
CREATE TABLE daily_word_results (
  day TEXT NOT NULL,
  player_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  name TEXT NOT NULL,
  guesses INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (day, player_id)
);

CREATE INDEX daily_word_results_board ON daily_word_results (day, difficulty, guesses, ms);
CREATE INDEX daily_word_results_by_player ON daily_word_results (player_id, day);
