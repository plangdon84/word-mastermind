-- Turn notifications (Web Push): one row per device that turned them on.
-- The endpoint is the push service's address for that device; p256dh and
-- auth are the device's keys for encrypting messages to it (RFC 8291).
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL REFERENCES guests (id),
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  -- Milliseconds since the epoch, by the server's clock.
  created_at INTEGER NOT NULL
);

CREATE INDEX push_subscriptions_by_guest ON push_subscriptions (guest_id);
