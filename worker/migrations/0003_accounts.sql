-- Accounts (Dev Plan item 6): a player who signed in with an email link or
-- Google. An account upgrades a guest in place: its ID is the guest ID of
-- the device that made it, so that guest's games are the account's.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  -- Lowercase. Google accounts give theirs, verified by Google.
  email TEXT NOT NULL UNIQUE,
  -- Google's ID for the person (the ID token's `sub`), once they've used Google.
  google_sub TEXT UNIQUE,
  -- Milliseconds since the epoch, by the server's clock.
  created_at INTEGER NOT NULL
);

-- Every device that signs in links its guest ID to the account. A linked
-- guest ID is the account's: using it takes a session, not just the ID.
ALTER TABLE guests ADD COLUMN account_id TEXT REFERENCES accounts (id);

CREATE INDEX guests_by_account ON guests (account_id);

-- A signed-in device. The app holds the token; only its SHA-256 is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  -- The device's guest ID when it signed in.
  guest_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_by_account ON sessions (account_id);

-- Sign-in links: one per email sent, or per finished Google sign-in. Each
-- works once, briefly. Kept a day after they expire, to limit how many
-- emails an address gets.
CREATE TABLE login_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- Set when Google vouched for the email.
  google_sub TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX login_links_by_email ON login_links (email, created_at);

-- A Google sign-in on its way: the `state` sent to Google (hashed), the PKCE
-- verifier, and the app's origin to send the browser back to.
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
