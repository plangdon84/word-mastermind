-- Private friend invite links (Dev Plan item 18, issue #84): opening one
-- makes you friends with its owner at once, with no request to accept.
-- Unlike the public friend code, the key is shared only by its owner, who
-- can reset it (making a new one) to stop old links working. 16 letters
-- and digits, made the first time the friends list is opened.
ALTER TABLE accounts ADD COLUMN invite_key TEXT;

CREATE UNIQUE INDEX accounts_by_invite_key ON accounts (invite_key);
