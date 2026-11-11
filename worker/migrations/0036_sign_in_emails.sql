-- Each sign-in email asked for, by internet address (Dev Plan item 19zk),
-- for the daily cap of `SIGN_IN_EMAILS_PER_DAY` per address, to any
-- emails. Only the address's hash (`signInAddressHash`), never the email,
-- and each row is deleted a day on (`countSignInEmail`).
CREATE TABLE sign_in_emails (
  ip_hash TEXT NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  at INTEGER NOT NULL
);

CREATE INDEX sign_in_emails_by_ip ON sign_in_emails (ip_hash, at);
