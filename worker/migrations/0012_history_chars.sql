-- Whole-codebase review (Dev Plan item 16).
-- A running total of each account's synced history, as characters of JSON,
-- so an upload checks it instead of adding up every game the account has.
-- The triggers keep it in step with every insert and delete (an upload,
-- deleting the account, the wipe), so the total and the rows can't disagree.
ALTER TABLE accounts ADD COLUMN history_chars INTEGER NOT NULL DEFAULT 0;

UPDATE accounts SET history_chars =
  (SELECT COALESCE(SUM(LENGTH(entry)), 0) FROM history_entries WHERE account_id = accounts.id);

CREATE TRIGGER history_entries_added AFTER INSERT ON history_entries
BEGIN
  UPDATE accounts SET history_chars = history_chars + LENGTH(NEW.entry) WHERE id = NEW.account_id;
END;

CREATE TRIGGER history_entries_removed AFTER DELETE ON history_entries
BEGIN
  UPDATE accounts SET history_chars = history_chars - LENGTH(OLD.entry) WHERE id = OLD.account_id;
END;
