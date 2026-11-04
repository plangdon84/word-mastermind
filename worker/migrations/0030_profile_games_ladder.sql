-- A friend's history filters their rated ladder games apart from their games
-- against friends (Dev Plan item 19t): each indexed game marks whether it was
-- a ladder game (1) or not (0), set as it's indexed (`indexRow` in
-- worker/src/friendProfiles.ts). A ladder game is always one the server
-- refereed, so its entry is here: filled in once from the games already
-- indexed.
ALTER TABLE profile_games ADD COLUMN ladder INTEGER NOT NULL DEFAULT 0;
UPDATE profile_games SET ladder = 1
  WHERE mode = 'friend' AND entry IS NOT NULL AND json_extract(entry, '$.record.ladder') IS NOT NULL;
