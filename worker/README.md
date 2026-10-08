# Word Mastermind API

The backend (README "Backend plan"): a Cloudflare Worker with a D1 database,
and Durable Objects for games against a friend (live or correspondence),
the matchmaking queues, Daily Rush and Rush with Friends. It imports the game logic
from `../src/game/` unchanged, so the server and the app score games and
check words with the same code and the same bundled word lists. The app
calls it for every mode played with or against other people, and for
accounts, synced profiles, friends, leaderboards and issue reports; single
player, vs. the computer and Solo Rush run on the device alone.

## Local development

From the repo root:

```sh
npm run worker:migrate  # create or update the local D1 database (worker/.wrangler/)
npm run daily-themes -- local --test  # made-up Daily Rush sets around today
npm run worker:dev      # serve the API on http://localhost:8787
npm run dev             # the app, which finds the API through .env.development
npm test                # includes the worker's tests (worker/src/*.test.ts)
npm run typecheck       # includes worker/tsconfig.json
```

`wrangler dev` runs the Durable Objects locally too, so there is nothing to
set up in Cloudflare to play a game on your own machine. Turn notifications
need a VAPID key pair: `npm run vapid-keys -- --dev` writes one to
`worker/.dev.vars` (never committed); without it they're off, and the app
doesn't offer them. The local server sends real notifications through the
browsers' push services. Sign-in emails are printed in the
`wrangler dev` console (`LOG_LOGIN_LINKS`), so open the link from there.
Google sign-in needs an OAuth client (below); put its ID and secret in
`worker/.dev.vars` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, with
`http://localhost:8787/api/auth/google/callback` among its redirect URIs.
Without them, the app offers only the email link. The worker's tests
run in Vitest against a stand-in for D1 built on Node's SQLite
(`node:sqlite`), with the real migrations applied, and in-memory stand-ins
for the game rooms (`src/fakeRooms.ts`) that run the same referee code.

## Layout

- `wrangler.toml`: the worker, its D1 binding (`DB`) and vars, for local
  development and the `staging` and `production` environments.
- `migrations/`: D1's tables, one numbered SQL file per change. Never edit an
  applied migration; add a new one.
- `src/index.ts`: routing (`handle`, which takes the time as an argument,
  like the game logic). `src/http.ts` has the JSON answers, errors and
  CORS, and `src/limits.ts` the rate limits by internet address (`limitOf`
  names the routes limited).
- `src/guests.ts`: guest identity. A guest is the ID their device created
  (the profile's `deviceId`). On its own it identifies a player but proves
  nothing; once it belongs to an account, only that account's session can
  use it (`identify` in `src/accounts.ts`).
- `src/accounts.ts`: accounts, sign-in links and sessions (README
  "Accounts"). Tokens are stored only as their SHA-256. `identify` works
  out who a request is from: the account (with its guest IDs from every
  device) for a session, or the device's guest.
- `src/sync.ts`: the synced profile (`/api/profile`, `/api/history`): the
  account's profile and settings, and its history, capped per account by a
  running total (`accounts.history_chars`).
- `src/friends.ts`: friends by friend code (`/api/friends`), and lobby
  invites.
- `src/played.ts`: `GET /api/played`, each player's history entries for the
  games the server refereed, built from the `games` table.
- `src/leaderboards.ts`: the rating boards, and `inCircle`, the SQL for
  "you and your friends".
- `src/authRoutes.ts`: the `/api/auth` routes. `src/mail.ts` sends the
  sign-in email (Resend), and `src/google.ts` does Google's OpenID Connect
  round trip.
- `src/words.ts`: word checks with the app's own `validateSecretWord` and
  `validateGuess`.
- `src/games.ts`: the `/api/games` routes. They check who is asking and the
  request, then pass it to the game's Durable Object, and note who sent or
  accepted each invite (`friend_game_players`) for listing a player's games.
- `src/gameRoom.ts`: `GameRoom`, the Durable Object, one per game. Cloudflare
  runs one instance per game and handles its requests one at a time, so two
  moves can't race. It stores the game in its own storage, and keeps open
  game pages' WebSockets (`/api/games/:id/live`, via `routeLiveSocket` in
  `src/games.ts`), saying `changed` down each after every move (hibernation
  API; `ping` is answered with `pong` without waking it).
- `src/notices.ts`: the turn notifications a change to a game sends, and
  what they say.
- `src/push.ts`: Web Push with WebCrypto only: encrypting a message for a
  device (RFC 8291), signing the request with the server's VAPID key (RFC
  8292), sending it, and the `push_subscriptions` table. `src/pushRoutes.ts`
  has its routes.
- `src/reports.ts`: Report an issue (README "Reporting an issue"): `POST
  /api/reports` keeps a report in the `reports` table and files it as a
  GitHub issue; `GET /api/reports/<id>/screenshot` serves its screenshot,
  which the issue shows. Without `GITHUB_TOKEN`, it prints the issue instead.
- `src/room.ts`: the referee `GameRoom` runs (`handleRoom`): the invite, the
  game's record (replayed through `src/game/pvp.ts` on every request), and
  each player's view (`describeRoom`). It saves a finished game to D1, and
  rates it once if it's rated. The time per guess, or a live game's clock,
  is the room's alarm, set to the player to move's deadline after every move
  (`handleAlarm`); every request checks the deadline too, in case the alarm
  runs late.
- `src/ratings.ts`: Glicko-2 ratings in D1 (`ratings`, `rated_games`), from
  `../src/game/rating.ts`: a player's current rating in a pool, rating a
  finished game, and `GET /api/ratings`.
- `src/queueRoutes.ts`: the `/api/queue` routes (Random opponent). Signed in
  only; they read your rating and pass the request to the queue's Durable
  Object.
- `src/matchmaker.ts`: `Matchmaker`, the Durable Object, one per queue, named
  by its time control and difficulty (`QUEUES.idFromName("10m:hard")`).
- `src/queue.ts`: the referee `Matchmaker` runs (`handleQueue`): who is
  waiting, dropping anyone who hasn't checked in for 30 seconds, and pairing
  two players within the allowed rating gap (`pickOpponent`) into a rated
  game (`startMatchedGame` in `src/games.ts`).
- `src/dailyRoutes.ts`: the `/api/daily` routes (Daily Rush). They check
  who is asking and the request, pass moves to the day's Durable Object,
  and read the leaderboards (`daily_results`) from D1.
- `src/dailyRush.ts`: `DailyRush`, the Durable Object, one per day, named by
  the UTC day (`DAILY.idFromName`). It keeps every player's run for that day.
- `src/dailyRoom.ts`: the referee `DailyRush` runs (`handleDaily`): once a
  day per player (any of an account's IDs), the run engine with the day's
  words, nothing after midnight UTC, and a finished run saved to
  `daily_results` and `games` (mode `daily`).
- `src/dailyThemes.ts`: the day's theme, from D1 (`daily_themes`); never
  from the repo, and never in the app. `src/themeDays.ts` has the rules for
  loading them (`npm run daily-themes`, "Daily Rush themes" below), and
  `src/testThemes.ts` the made-up sets tests use.
- `src/lobbyRoutes.ts`: the `/api/lobbies` routes (Rush with Friends). They
  check who is asking and the request (a name shown to others passes the
  profanity filter), make a new lobby's join code, and pass the request to
  the lobby's Durable Object.
- `src/rushLobby.ts`: `RushLobby`, the Durable Object, one per lobby, named by
  its join code (`LOBBIES.idFromName`). Its alarm wakes it when a computer
  player finishes or the time is up, so the game ends with nobody looking.
- `src/lobbyRoom.ts`: the referee `RushLobby` runs (`handleLobby`): the
  lobby's record (`src/game/lobby.ts`), replayed on every request, each
  player's view (words hidden until found, others' guesses never shown), and
  a finished game saved to `games` (mode `lobby`).
- `src/wipe.ts` and `scripts/wipe.ts`: the admin wipe (below).
- `src/fakeD1.ts`: the tests' D1 stand-in; `src/fakeRooms.ts`,
  `src/fakeDaily.ts`, `src/fakeLobbies.ts` and `src/fakeQueues.ts` stand in
  for the Durable Objects.

## API

| Route | Body | Answer |
|---|---|---|
| `GET /api/health` | | `{ ok, secretWords, guessWords }` (list sizes) |
| `POST /api/guests` | `{ id }` | `{ id, createdAt, lastSeenAt }`; 400 `bad-guest-id` |
| `POST /api/words/check` | `{ kind: "secret" \| "guess", word }` | `{ ok: true, word }` or `{ ok: false, error }`, as `WordValidation` in `src/game/words.ts`; 400 `bad-request` |
| `GET /api/games` | | `{ games: [{ id, addedAt }] }`: the 50 newest games you sent or accepted, from any of your devices once signed in |
| `POST /api/games` | `{ name, secret, difficulty, timeControl, friend?, rated? }` | 201, the game (below): a new invite (`timeControl` is `15m`, `10m`, `5m`, `1d` or `3d`; older apps send `turnDays`); `rated` only with `friend` |
| `GET /api/games/:id` | | The game, from your side, with the deadline for the player to move, a live game's clocks, the server's time (`serverNow`) and a rated game's ratings |
| `GET /api/games/:id/live` | WebSocket | Says `changed` after every move; answers `ping` with `pong` |
| `POST /api/games/:id/join` | `{ name, secret, difficulty }` | The game, started; 409 `own-invite`, `invite-taken`, `invite-closed` or `invite-expired` |
| `POST /api/games/:id/guess` | `{ word }` | The game; 409 `not-your-turn` or `game-over` |
| `POST /api/games/:id/concede` | `{}` | The game, lost; before anyone joins, it cancels the invite |
| `POST /api/games/:id/difficulty` | `{ difficulty }` | The game; 400 `difficulty-fixed` in a rated game |
| `POST /api/games/:id/suggest` | `{ word }` | The game, with Easy's Suggest recorded; 404 `off` while Suggest is switched off |
| `GET /api/played?after=` | | `{ games, next, cursor }`: your finished games the server refereed (a friend's, Daily Rush, lobbies) as history entries, after the cursor `after` |
| `GET /api/profile` | | `{ profile }`, the account's synced profile (null before any device sent one); signed in only (401 `signed-out`) |
| `POST /api/profile` | `SyncedProfile` (`src/app/syncApi.ts`) | `{ profile }`, as kept |
| `GET /api/history?after=` | | `{ entries, next, cursor }`: the account's synced games after the cursor `after` |
| `POST /api/history` | `{ entries }` (at most `UPLOAD_BATCH`) | `{ added, skipped }`: games that don't replay, or the server's own modes, are skipped, not refused |
| `GET /api/friends` | | `FriendsList` (`src/app/friendsApi.ts`): your friend code, friends, requests both ways and lobby invites; signed in only |
| `POST /api/friends/add` | `{ code }` | `FriendsList`: a request sent, or theirs accepted; 404 `not-found`, 400 `own-code`, 409 `too-many-friends` |
| `POST /api/friends/remove` | `{ code }` | `FriendsList`: a friend removed, a request declined or withdrawn |
| `GET /api/ratings` | | `{ ratings: [{ pool, rating, provisional, games }] }`, your ratings, signed in; 401 `signed-out` |
| `GET /api/leaderboards/ratings?pool=&circle=` | | `RatingBoard` (`src/app/leaderboardsApi.ts`): a pool's top 100 by rating, provisional players left out (ties share a rank), how many are listed, and, signed in, your rating and place or about how many rated games until you're listed; `circle=friends` narrows it to you and your friends (401 `signed-out` for a guest) |
| `POST /api/queue` | `{ timeControl, difficulty, name, secret }` | `QueueStatus` (`src/app/queueApi.ts`): `waiting` or `matched` with the game's ID; signed in only |
| `POST /api/queue/poll` | `{ timeControl, difficulty }` | `QueueStatus`, keeping your place; `idle` if you were dropped |
| `POST /api/queue/leave` | `{ timeControl, difficulty }` | `{ state: "idle" }` |
| `GET /api/auth/me` | | `{ account, methods }`: the signed-in account (null without an `authorization` header) and `{ email, google }`, the ways to sign in; 401 `signed-out` if the session ended |
| `POST /api/auth/email` | `{ email, returnTo }` | `{ ok: true }`: emails a sign-in link to `returnTo` (an allowed origin) `/?login=…`; 400 `bad-email`, 429 `too-many-emails`, 404 `email-off`, 502 `email-failed` |
| `POST /api/auth/google` | `{ returnTo }` | `{ url }`, Google's sign-in page; 404 `google-off` |
| `GET /api/auth/google/callback` | | Google sends the browser here; it's sent on to `returnTo/?login=…`, or `?login-error=google` |
| `POST /api/auth/session` | `{ token }`, from `?login=` | `{ token, account }`, a session for this device (`x-guest-id`); 400 `bad-login` if the link is used or expired |
| `POST /api/auth/logout` | `{}` | `{ ok: true }`, ending the session in `authorization` and that device's turn alerts |
| `POST /api/auth/delete` | `{}` | `{ ok: true }`: deletes the account, signing out every device; 401 `signed-out` without a session |
| `GET /api/daily` | | `DailyToday` (`src/app/dailyApi.ts`): today's UTC day, theme (null without one), when the next set is out, the server's clock, your run (`DailyView`, unfound words hidden) and your final places on past days |
| `POST /api/daily/start` | `{ day, difficulty, name }` | `DailyToday` with your run started; 409 `already-played`, 404 `no-theme`, 400 `offensive-name` |
| `POST /api/daily/guess` | `{ day, word }` | `DailyToday`; 409 `not-started`, `game-over`, or `day-over` once `day` isn't today |
| `POST /api/daily/give-up` | `{ day }` | `DailyToday`, given up: no leaderboard entry |
| `POST /api/daily/suggest` | `{ day, word }` | `DailyToday`, with Easy's Suggest recorded at the word being played |
| `GET /api/daily/board?day=&difficulty=&circle=` | | `DailyBoard`: the theme, the top 10 (ties share a rank), how many finished, your place, and the words once the day is over; 404 for a day to come or without a theme. `circle=friends` narrows it to you and your friends, signed in |
| `POST /api/lobbies` | `{ name, difficulty, kind?, word? }` | 201, `LobbyAnswer` (`src/app/lobbyApi.ts`): `{ lobby, now, rating }`, a new lobby with you as host and its join code; `kind: "competitive"` with your `word` for Competitive Rush (signed in); 400 `offensive-name` |
| `GET /api/lobbies/:code` | | `LobbyAnswer`: the lobby from your side (`LobbyView`: your run with unfound words hidden, everyone's progress); 404 `not-found` |
| `POST /api/lobbies/:code/join` | `{ name, word? }` | `LobbyAnswer`; 409 `lobby-full`, `already-started` or `lobby-closed` |
| `POST /api/lobbies/:code/word` | `{ word }` | `LobbyAnswer`: your Competitive Rush word changed, before the game |
| `POST /api/lobbies/:code/invite` | `{ friend }` | `LobbyAnswer`: the host invites a friend by their friend code, signed in |
| `POST /api/lobbies/:code/leave` | `{}` | `LobbyAnswer`, before the game; 403 `not-host` for the host |
| `POST /api/lobbies/:code/close` | `{}` | `LobbyAnswer`: the host closes it before the game |
| `POST /api/lobbies/:code/settings` | `{ difficulty, minutes, computers, strength }` | `LobbyAnswer`; the host only (403 `not-host`), 400 `bad-settings` (a duration not offered, or more computers than empty seats) |
| `POST /api/lobbies/:code/start` | `{}` | `LobbyAnswer`, started with 4 server-picked words and the computers' games played out; 409 `need-players` alone |
| `POST /api/lobbies/:code/guess` | `{ word }` | `LobbyAnswer`; 409 `game-over` or `time-up` |
| `POST /api/lobbies/:code/suggest` | `{ word }` | `LobbyAnswer`, with Easy's Suggest recorded |
| `POST /api/lobbies/:code/give-up-word` | `{}` | `LobbyAnswer`, on to the next word |
| `POST /api/lobbies/:code/give-up` | `{}` | `LobbyAnswer`, every word not found given up |
| `GET /api/push/key` | | `{ publicKey }`, the VAPID key to subscribe with; 404 `push-off` without keys |
| `POST /api/push/subscribe` | The browser's `PushSubscription.toJSON()` | `{ ok: true }`; 400 `bad-request` for an endpoint that isn't a known push service |
| `POST /api/push/unsubscribe` | `{ endpoint }` | `{ ok: true }` |
| `POST /api/reports` | `Report` (`src/game/report.ts`), with an optional screenshot | `{ id, issueUrl }`: kept, and filed on GitHub when it can be; 429 `too-many-reports` |
| `GET /api/reports/:id/screenshot` | | The report's screenshot, which its issue shows; 404 `not-found` |

Every route needs the `x-guest-id` header (400 `bad-guest-id`) but the
health check, `/api/guests` (the ID is in its body), word checks, the push
key, sending a sign-in email, Google's callback, signing out and a report's
screenshot.
Routes that make something new are rate limited per internet address (429
`too-many-requests`). Signed in, they also carry the
session, and you act as your account: its ID is the one games record, and a
seat taken under any of its guest IDs is yours. A guest ID that belongs to
an account is refused without its session (401 `sign-in-needed`), and an
ended session is refused with 401 `signed-out`. Turn alerts stay per device
(under its guest ID), and a game's notice reaches every device of the
player's account.
A game is `FriendGame` in `src/app/friendApi.ts`: its ID (64 hex digits),
your seat (`host`, `guest`, or null if you're not in it), its state
(`waiting`, `playing`, `over`, `cancelled`, `expired`), both names, the
time per guess, when an unaccepted invite expires (24 hours after it's sent),
and your view of it (`PvpView` in `src/game/pvp.ts`), which never holds your
opponent's word until you've found it or the game is over. Someone who isn't
in the game sees only the invite. A word the rules refuse answers 400 with
the word's error, as in `WordValidation`; a request from someone who isn't
in the game answers 403 `not-a-player`.

A session is sent as `authorization: Bearer <token>`.
Errors are `{ error }`. Requests from the origins in `ALLOWED_ORIGINS` get
CORS headers.

## Deploying

Both environments deploy themselves, through Workers Builds: each worker is
connected to this repository in the Cloudflare dashboard, and a worker's
builds deploy only that worker. Both have the build command `npm ci` and the
root directory `/`.

- **`word-mastermind-api`** (production). Settings → Build → **Production**:
  branch `main`, deploy command `npm run deploy:production`. **Previews
  Base**: builds for preview branches on, preview command
  `npm run check:worker`, which bundles the worker without deploying it. The
  "Workers Builds: word-mastermind-api" check on a pull request is that
  build, so it's red only when the worker doesn't build. (Until 13b the
  preview command was `npx wrangler preview`, which failed on every pull
  request: it needs a `previews` block in `wrangler.toml`, which this
  project doesn't have. Staging does that job instead, with its own worker
  and database.)
- **`word-mastermind-api-staging`** (see [Staging](#staging)), connected to
  the same repository: **Production** deploy command
  `npm run deploy:staging`, and **Previews Base** on, with the preview
  command `npm run deploy:staging` too, so every push to any branch deploys
  staging, with the `word-mastermind-staging` database. Its check, "Workers
  Builds: word-mastermind-api-staging", is red when the staging deploy fails.

Each deploy script applies new D1 migrations before the code that needs them
goes out, then deploys. GitHub Actions (`.github/workflows/ci.yml`) runs the
tests, typecheck, app build and word-list tests on every pull request.

To deploy an environment by hand instead (staging, say), from a computer
with `npx wrangler login` done:

1. `npx wrangler d1 migrations apply DB --config worker/wrangler.toml --env <env> --remote`
2. `npx wrangler deploy --config worker/wrangler.toml --env <env>`. The
   first deploy creates the `GameRoom`, `DailyRush`, `RushLobby` and
   `Matchmaker` Durable Object classes (the `v1` to `v4` migrations in
   `wrangler.toml`); there is nothing to set up for them in the Cloudflare
   dashboard.

Then, once per environment: set `ALLOWED_ORIGINS` in `wrangler.toml` to the
origin(s) the app is served from, and in the Pages project set the build
variable `VITE_API_URL` to the worker's address
(`https://word-mastermind-api….workers.dev`), so the app knows where to find
it.

Vars live in `wrangler.toml`, and each deploy replaces the worker's vars
with them, so a var set only in the dashboard is lost on the next push.
Secrets (the private keys below) are kept across deploys: add them with
`wrangler secret put`, or in the dashboard under the worker's Settings →
Variables and Secrets, as type Secret.

Turn notifications, once per environment (before deploying, or deploy
again after): `npm run vapid-keys` makes a key pair. Put the public key in that
environment's `VAPID_PUBLIC_KEY` in `wrangler.toml`, and store the private
key as a secret with
`npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml --env <env>`.
Keep the pair: devices that turned notifications on are tied to it.

Sign-in, once per environment:

- **Email:** make a [Resend](https://resend.com) account and add the domain
  `wordmastermind.app` (Domains → Add domain). Resend lists its DNS
  records (a TXT for DKIM, CNAMEs for sending, an optional `_dmarc` TXT):
  **Auto configure** adds them to Cloudflare, or add each by hand in
  Cloudflare's DNS for the domain as **DNS only** (grey cloud; Cloudflare
  proxies a new CNAME unless told not to, and Resend can't verify it then).
  Verifying can take a few hours. `EMAIL_FROM` in `wrangler.toml` is already
  `Word Mastermind <signin@wordmastermind.app>`. Make an API key (API Keys →
  Create, permission **Sending access**, domain `wordmastermind.app`) and
  store it with
  `npx wrangler secret put RESEND_API_KEY --config worker/wrangler.toml --env <env>`
  (or the dashboard, as type Secret). Email sign-in turns on with the next
  request: the profile's Account page shows **Email me a link**. An emailed
  link asks "Sign in as …?" before it signs a device in.
- **Google:** in the Google Cloud console, make an OAuth client ID (type
  "Web application") with the redirect URI
  `https://<the worker's address>/api/auth/google/callback`. Set
  `GOOGLE_CLIENT_ID` in `wrangler.toml` and store the secret with
  `npx wrangler secret put GOOGLE_CLIENT_SECRET --config worker/wrangler.toml --env <env>`.
  The consent screen needs only the `openid` and `email` scopes.

Report an issue, once per environment: on GitHub, make a fine-grained
personal access token with access to this repository only and the
permission **Issues: Read and write**, and store it with
`npx wrangler secret put GITHUB_TOKEN --config worker/wrangler.toml --env <env>`.
`GITHUB_REPO` in `wrangler.toml` names the repository. Create the labels
`from-app`, `word-list` (and `bug`, `enhancement`, which GitHub makes by
default) first; an issue whose labels GitHub refuses is filed without them.
Without the token, reports are kept in the `reports` table and printed in
the worker's logs; to file one later, read it with
`npx wrangler d1 execute DB --remote --env <env> --config worker/wrangler.toml --command "SELECT title, body FROM reports WHERE issue_url IS NULL"`.

## The game's domain

Production runs on the game's own domain, `wordmastermind.app` (Dev Plan
item 18, issue #77): the app at `https://wordmastermind.app` and the worker
at `https://api.wordmastermind.app`, so Google's sign-in page names the
game rather than a `workers.dev` address. Setting it up, once, in this order:

1. **Buy the domain** with Cloudflare Registrar (the Cloudflare dashboard →
   Domain Registration), on the same account as the worker and Pages
   project (a yearly fee; Cloudflare charges what the registry does). `.app` sites are
   HTTPS-only, which Cloudflare's certificates cover.
2. **Deploy the worker** (merging to `main` does it). `wrangler.toml`'s
   `routes` puts it on `api.wordmastermind.app` as a custom domain:
   Cloudflare makes the DNS record and certificate. A deploy before step 1
   fails, since the domain isn't on the account yet.
3. **Pages:** in the Pages project, Custom domains → **Set up a custom
   domain** → `wordmastermind.app`. Then set the production build variable
   `VITE_API_URL` to `https://api.wordmastermind.app` and retry the latest
   production deployment, so the app talks to the new address.
4. **Google:** in the Google Cloud console, add
   `https://api.wordmastermind.app/api/auth/google/callback` to the OAuth
   client's redirect URIs (keep the old ones), and on the OAuth consent
   screen (Branding) set the app name **Word Mastermind**, the home page
   `https://wordmastermind.app` and the authorized domain
   `wordmastermind.app`. Google's page then says "to continue to Word
   Mastermind".

The old addresses keep working (`ALLOWED_ORIGINS` still lists the Pages
address, and `workers_dev = true` keeps the worker's `workers.dev` address on,
which wrangler would otherwise turn off once it has a custom domain), but each address keeps its own browser storage: a player's
profile and games saved on `word-mastermind.pages.dev` aren't on
`wordmastermind.app`. Signing in on the old address first carries them
over with the account (or **Save a backup** there and **Restore** it on the
new one). Turn alerts are turned on again on the new address.
The app on the old address says so in a popup with these steps, and from
`REDIRECT_FROM` in `src/app/moved.ts` it sends players straight to the new
address instead (Dev Plan item 18f, issue #92).

## Staging

Pull requests are tested on staging, so testing never touches production
data (Dev Plan item 13b):

- **The worker:** every push to a branch other than `main` deploys
  `word-mastermind-api-staging` (`npm run deploy:staging`, from that
  worker's own Workers Builds; see [Deploying](#deploying)), with
  its own D1 database (`word-mastermind-staging`) and Durable Objects. Every
  branch deploys the same staging worker, so it runs the branch pushed
  last.
- **The app:** Pages builds each branch as a preview
  (`https://<id>.word-mastermind.pages.dev`, and one named after the
  branch). The Pages project's variables (Settings → Variables and
  Secrets) are the same for every branch, and it has no preview-only ones,
  so `VITE_API_URL` (the production worker's address) is used only by
  `main`, and a preview uses the staging worker's address from the code,
  `STAGING_API_URL` in `src/buildApiUrl.ts` (read by `vite.config.ts`). A
  Pages variable `VITE_API_URL_PREVIEW` overrides it, to try another
  server. A preview never reads `VITE_API_URL`; one given the production
  worker's address is built without a server instead. Each build's log
  names the server it uses (`Build of <branch>: game server …`).
- **Origins:** staging's `ALLOWED_ORIGINS` is
  `https://*.word-mastermind.pages.dev`: any one preview address, but not
  the production site. Production's lists only the production site.
- **Sign-in on staging:** Google, with the same OAuth client as
  production: `GOOGLE_CLIENT_ID` in `wrangler.toml` is production's, the
  staging worker has its own copy of the `GOOGLE_CLIENT_SECRET` secret, and
  the client's redirect URIs list the staging worker's callback
  (`https://word-mastermind-api-staging.<your subdomain>.workers.dev/api/auth/google/callback`)
  beside production's. Until the secret is set, previews play as guests.
  If the client secret is ever reset in Google, store the new one on both
  workers, staging and production.
  A staging account is separate from a production one, with its own games,
  and a sign-in lasts per preview address (a PR's branch address keeps it
  across that PR's pushes). Email sign-in and filed issues are off there,
  unless their keys are set for staging.
- **Turn notifications on staging:** staging has its own VAPID key pair
  (never production's): the public key is in `[env.staging.vars]`, and the
  private key is the staging worker's `VAPID_PRIVATE_KEY` secret. Until
  that secret is set, notifications are off on previews
  (`GET /api/push/key` answers 404 `push-off`).
- **Wiping:** `npm run wipe -- staging` empties staging's history whenever
  wanted.

## Daily Rush themes

Each day's theme and words are a row in D1's `daily_themes`. They're every
day's answers, so they're never in this repo (which is public): the themes,
calendar and the script that builds the calendar live in the private repo
`word-mastermind-daily`. Load them from a checkout of it, signed in to
Cloudflare (`npx wrangler login`). On a database that doesn't have the
`daily_themes` table yet, apply the migrations first
(`npx wrangler d1 migrations apply DB --config worker/wrangler.toml --env production --remote`;
a deploy does it too):

```sh
npm run daily-themes -- staging ../word-mastermind-daily
npm run daily-themes -- production ../word-mastermind-daily
npm run daily-themes -- local --test   # made-up sets (src/testThemes.ts), local only
```

It checks every day first (a real date, 4 different words on the secret
list) and loads nothing if one is wrong. It adds new days and replaces days
to come; **today and earlier days are never changed**, since they've been
played. It never deletes a day either: a day taken out of the calendar
keeps its old row, and is still played, until it's given a new theme or
deleted by hand (`wrangler d1 execute`). A day with no row has no Daily
Rush (`no-theme`). Run it again
after changing a theme to come, and before the calendar runs out. The
wipe keeps the table. Never paste its output, the SQL or a day's words into
an issue, a PR or a log.

## Wiping game history

```sh
npm run wipe -- <local|staging|production>
```

Deletes every row of game history and leaderboards from that environment's
D1 database, keeping players. It asks you to type the environment's name
first and does nothing otherwise. It is an admin script, never reachable from
the game; the 1.0 launch runs it on production (Dev Plan item 18). Needs
Node 22.18 or later, which runs TypeScript directly.

Every migration that adds a table must add it to `WIPE_TABLES` or
`KEEP_TABLES` in `src/wipe.ts`; `src/wipe.test.ts` fails until it does.
