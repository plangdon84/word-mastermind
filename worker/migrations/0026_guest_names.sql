-- Your current name on every Daily board (Dev Plan item 18zw): a guest's
-- name now, set when they start a daily game and when they choose a new
-- name (POST /api/daily/name). Each board row shows it in place of the
-- name the run started with; an account's comes from its synced profile
-- instead. NULL until then: the row's own name is shown.
ALTER TABLE guests ADD COLUMN name TEXT;
