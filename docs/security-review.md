# Security review (Dev Plan item 15)

Done on 30 September 2026, against `main` at `031d0d5`: every worker route
and Durable Object, sign-in, sync, push, reports, the app's handling of
names, reports and definitions, the Pages headers, dependencies and the git
history. Nothing was high severity. Each finding below says what was done;
the owner accepted every one that wasn't fixed.

## Threat model

What someone might want, and how they'd try, from the browser, the API or a
WebSocket:

- **A place on a leaderboard, or a rating, they didn't earn:** by sending
  made-up words, scores or moves; by replaying or forging moves; by playing
  again under a new identity; by farming a second account.
- **Another player's words:** from an API answer, a WebSocket, a
  notification, a report or a record.
- **Taking over an account or a guest:** by stealing or guessing a token,
  guest ID, friend game ID or join code; through the OAuth round trip; by
  getting someone's device to sign in to the attacker's account.
- **The server's secrets** (the Google client secret, VAPID private key,
  GitHub token, Resend key): from the code, the git history or the logs.
- **Spam or cost:** issue reports, push notifications, emails, friend
  requests, or filling the database and Durable Objects with junk.

## Findings

| # | Severity | Finding | Outcome |
|---|---|---|---|
| M1 | Medium | Login CSRF: a sign-in link someone made for their own account (Google or email), sent to you, signed your device in to their account and linked your device's guest ID and games to it. | **Fixed for Google:** the round trip remembers the guest ID of the device that started it, and only that device can use its sign-in link. **Email:** fixed in item 12b: an emailed link asks "Sign in as …?" (the server's `POST /api/auth/link` says whose it is without using it) before signing in. |
| M2 | Medium | No limit per internet address: limits counted per guest ID, which a device makes up, so a script could create games, lobbies, guests and Daily Rush entries without end, and use up the 100-a-day report cap, filing junk public issues and blocking real reports. | **Fixed:** Cloudflare rate limiting bindings per address (`worker/src/limits.ts`): 30 a minute for what makes something new, 3 for reports and sign-in emails; playing is never limited. Reports also count 10 an hour per address, kept hashed and cleared at the next report once an hour old. An IPv6 address counts by its /64 (one home's block), so a new address each time doesn't get round it (fresh review, #1). Syncing history isn't limited, since a first upload can be many requests (fresh review, #2). |
| M3 | Medium | Synced history had no cap per account: one account could upload about 10 MB a request until D1 was full. | **Fixed:** at most `MAX_ACCOUNT_CHARS` (20 MB) per account; past it, new games stay on the device. |
| M4 | Medium | Pages sent no security headers: no Content Security Policy, no protection from framing (clickjacking), and a referrer could carry a sign-in link's token. | **Fixed:** `public/_headers`: a CSP allowing only the site and this account's workers, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. Checked in Chromium: no violations. |
| M5 | Medium | Daily Rush: a player can play once as a throwaway guest to learn the day's words, then again as themselves. | **Accepted for 1.0** by the owner: requiring an account only means a second account, and a limit per address would stop a household each playing. Recorded in README "Daily Rush". |
| L1 | Low | Signing in with a device ID already linked to another account made a session on it, so a leaked linked guest ID could receive that account's turn alerts (which say your secret word) or switch them off. | **Fixed:** refused with `sign-in-needed`, the link left unused; the app switches to a new guest ID and tries again. |
| L2 | Low | Push notifications' `Topic` header carried the first half of a friend game's ID (a credential) to the push service. | **Fixed:** a hash of it (`topicOf`). |
| L3 | Low | The service worker opened whatever address a notification carried. | **Fixed:** only the app's own pages (defence in depth; only the server can send one). |
| L4 | Low | `npm audit`: 3 advisories (1 high, 2 moderate) in `undici`, through `wrangler` and `miniflare` (development tools, never shipped). | **Fixed:** `npm audit fix`; 0 now. |
| L5 | Low | Ratings can be farmed with a second account (rated friend challenges, Competitive Rush). | **Accepted:** the rating boards and Competitive Rush are off for 1.0; revisit when they're switched on. |
| L6 | Low | Many accounts could fill someone's friends list to `MAX_FRIENDS` with requests. | **Accepted:** needs many Google accounts; declining clears them. |
| L7 | Low | An account with more than about 100 device IDs would pass D1's 100-parameter limit in the queries that list its games (only that account is affected). | **Fixed in item 16:** looked up by account with one bound parameter (`isPlayers`); the tests' D1 stand-in refuses more than 100, as D1 does. |
| L8 | Low | (Fresh review #5) Each history upload re-adds the size of all the account's games, and two uploads at once can pass the cap by about one batch. | **Fixed in item 16:** a running total per account (`accounts.history_chars`, kept by triggers), checked in the same statement as each insert. |
| L9 | Low | (Second fresh review) Someone with a larger IPv6 block (a /56 or /48, as some tunnel services give) can still use a new /64 each time. | **Accepted** by the owner: the 100-a-day cap on reports still holds, no worse than many IPv4 addresses; if report spam happens, count IPv6 reports by /56 or /48. An IPv4 address written as IPv6 (`::ffff:…`) now counts as its IPv4 address (second review, fixed). |

## Checked and fine

- **Authorization:** every route checks who is asking (`identify`); a guest
  ID linked to an account needs that account's session. Friend games,
  lobbies and Daily Rush act only on the asker's own seat or run; hosts
  alone change a lobby or cancel an invite; a challenge is taken only by its
  invitee; rated games need both players to be accounts and fix difficulty.
- **Words and scores are never trusted from the app:** the referees in the
  Durable Objects validate every word, compute every score, keep the
  records, time moves by the server's clock and handle one request at a
  time, so moves can't race or be replayed. Uploaded history must replay to a
  finished game, and the server's own modes are never taken from uploads.
- **Other players' words** stay hidden (`pvpView`, `dailyView`, `lobbyView`)
  until found or the game is over; leaderboard and lobby rows never carry a
  player's ID; played-game entry IDs are hashes of the game ID.
- **Input sizes:** names, words, reports, screenshots (type checked against
  their first bytes), push subscriptions and history entries are bounded.
- **Tokens:** sessions and sign-in links are 32 random bytes, stored only as
  SHA-256; sign-in links work once, for 15 minutes; OAuth `state` is hashed
  and single-use, with PKCE (S256); the ID token's issuer, audience, expiry
  and `email_verified` are checked; `returnTo` must be an allowed origin.
  The app clears `?login=` from the address bar at once.
- **CORS:** only the allowed origins, and no cookies anywhere, so there's
  no cross-site request forgery; WebSockets check the origin too.
- **Push:** subscriptions only to the four real push services (no SSRF),
  keys checked, payloads encrypted (RFC 8291) and signed (VAPID).
- **XSS:** Preact escapes all text; the only raw HTML is the bundled logo
  SVG. The sign-in email escapes its link. Report text is defanged (no
  @-mentions or issue closing) and screenshots are served with `nosniff`
  and `default-src 'none'`.
- **Secrets:** none in the code or in any of the 185 commits in the git
  history (searched for Google, GitHub, Resend, AWS and private-key
  patterns and `.dev.vars`); none logged in staging or production (the
  sign-in link is printed only locally, with `LOG_LOGIN_LINKS`).

## Confirmed by the owner

- In Google Cloud Console, the OAuth client secret replaced on 28 September
  is deleted (confirmed 30 September).
- The Workers rate limiting bindings cost nothing extra on the Free or Paid
  plan (Cloudflare's rate limiting docs; confirmed 30 September). Cloudflare
  counts them per location, loosely synced, so they slow abuse rather than
  set an exact quota; the exact caps on reports are counted in D1.
