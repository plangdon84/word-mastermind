-- The Daily Set's Rush board (Dev Plan item 18z): each day and difficulty
-- ranks the same results two ways, Crush by fewest guesses then time
-- (`daily_results_board`), and Rush by fastest time then guesses, read
-- through this index.
CREATE INDEX daily_results_board_time ON daily_results (day, difficulty, ms, guesses);
