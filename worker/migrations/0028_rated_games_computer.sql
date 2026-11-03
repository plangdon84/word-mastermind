-- Ladder games against a computer (Dev Plan item 19p): the computer's
-- recall on the player's row of `rated_games`, null against a person, so a
-- board can count each player's rated games against computers and the
-- usage dashboard can compare results with what the ratings expected.
-- A computer has no row of its own, and no rating in `ratings`.
ALTER TABLE rated_games ADD COLUMN computer_recall REAL;
