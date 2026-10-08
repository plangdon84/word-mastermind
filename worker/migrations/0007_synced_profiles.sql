-- The synced profile (Dev Plan item 9): a signed-in player's profile and
-- settings, shared by every device signed in to the account. The device ID
-- stays on each device.
CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id),
  guest_name TEXT NOT NULL,
  -- NULL until they set a name: others see the guest name.
  name TEXT,
  -- An ISO 3166-1 code, or NULL for "prefer not to say".
  country TEXT,
  -- Milliseconds since the epoch: the earliest of the account's devices.
  member_since INTEGER NOT NULL,
  -- JSON: the settings that follow you (SyncedSettings in src/app/syncApi.ts).
  settings TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- A signed-in player's game history: every finished game from any of their
-- devices, as the app's history entry (JSON: ID, mode, version, record,
-- marks). Keyed by the entry's random ID, so uploading one twice keeps one.
-- `seq` orders them as they arrived, so a device downloads only what's new.
CREATE TABLE history_entries (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  id TEXT NOT NULL,
  mode TEXT NOT NULL,
  version INTEGER NOT NULL,
  entry TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  uploaded_at INTEGER NOT NULL,
  UNIQUE (account_id, id)
);

CREATE INDEX history_entries_by_account ON history_entries (account_id, seq);
