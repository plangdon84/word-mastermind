-- Security review (Dev Plan item 15).
-- A Google sign-in belongs to the device that started it: the guest ID it
-- started from, carried on to the sign-in link, which only that device can
-- trade for a session. NULL on an emailed link, which may be opened anywhere.
ALTER TABLE oauth_states ADD COLUMN guest_id TEXT;
ALTER TABLE login_links ADD COLUMN guest_id TEXT;

-- The report's sender's address, hashed, for the rate limit (a made-up guest
-- ID doesn't get round it). Cleared after a day; never shown on GitHub.
ALTER TABLE reports ADD COLUMN ip_hash TEXT;
CREATE INDEX reports_by_ip ON reports (ip_hash, created_at);
