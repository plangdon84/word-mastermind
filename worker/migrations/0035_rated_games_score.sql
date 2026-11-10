-- Each rated game's result for each player (Dev Plan item 19zh): 1 a win,
-- 0.5 a draw, 0 a loss, written by `ratingStatements`. Once a draw moved
-- ratings, the result could no longer be read from which way the rating
-- went. Null for a Competitive Rush row (a result per pair, not one) and
-- for rows rated before this, which `npm run rerate` fills in from each
-- game's record; until then a null row's result is read the old way
-- (`worker/src/admin.ts`), which held while a draw moved no rating.
ALTER TABLE rated_games ADD COLUMN score REAL;
