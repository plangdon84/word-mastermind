-- The Daily Rush's themes, one row per UTC day (Dev Plan item 18ua). They
-- used to be bundled from files in the repo; once the repo is public those
-- files would give away every day's words, so they live only here, loaded
-- by `npm run daily-themes` from files kept outside the repo. `words` is
-- the day's 4 secret words, comma-separated, in the theme's order.
CREATE TABLE daily_themes (
  day TEXT PRIMARY KEY,
  theme_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  words TEXT NOT NULL
);
