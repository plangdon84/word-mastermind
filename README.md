# Word Mastermind

## Mission

Build and deploy a **web app** for **Word Mastermind**, a 2-player word-guessing game.

> Status: every mode is built: single player, two player vs. the computer
> (four strengths) and vs. a friend (live or correspondence, by link or from
> the friends list), and the four Rush modes, at Easy, Medium (the default),
> Hard and Extreme, with definitions, a profile (history, stats,
> achievements), accounts and synced profiles, friends and leaderboards.
> Random opponent, the rating boards and Competitive Rush are built but
> switched off for 1.0 ([Launch switches](#launch-switches)). Cloudflare
> deploys `main` to production and every branch to staging; the 1.0 launch
> is Dev Plan item 18.

## Contents

**[Dev Plan](docs/dev-plan.md)**: the build order and the post-launch backlog.

- [Development](#development)
- [Game Overview](#game-overview)
- [Rules](#rules)
  - [1. Secret words](#1-secret-words)
  - [2. Guesses](#2-guesses)
  - [3. Evaluating a guess](#3-evaluating-a-guess)
  - [4. Tracking](#4-tracking)
- [Scoring Examples](#scoring-examples)
- [Decisions](#decisions)
- [Game Modes](#game-modes)
  - [Computer strength](#computer-strength)
  - [PvP formats](#pvp-formats)
  - [Rush modes](#rush-modes)
- [Difficulty Levels](#difficulty-levels)
  - [Easy](#easy)
- [User Interface](#user-interface)
  - [Game screen header](#game-screen-header)
  - [Letter bubbles](#letter-bubbles)
  - [Letter marks](#letter-marks)
  - [Title screen](#title-screen)
  - [Unlocking modes](#unlocking-modes)
  - [Two player vs. computer](#two-player-vs-computer)
  - [Two player vs. a friend](#two-player-vs-a-friend)
  - [Random opponent](#random-opponent)
  - [Daily Rush](#daily-rush)
  - [Leaderboards](#leaderboards)
  - [Rush with Friends](#rush-with-friends)
  - [Competitive Rush](#competitive-rush)
  - [Solo Rush](#solo-rush)
  - [Menu](#menu)
  - [Tutorial](#tutorial)
  - [Reporting an issue](#reporting-an-issue)
  - [Sharing a result](#sharing-a-result)
  - [Version and release notes](#version-and-release-notes)
  - [Definitions](#definitions)
  - [Profile](#profile)
  - [Accounts](#accounts)
  - [Synced profile](#synced-profile)
  - [Friends](#friends)
  - [Launch switches](#launch-switches)
- [Word Lists](#word-lists)
- [Tech Stack (Confirmed)](#tech-stack-confirmed)
  - [Backend plan](#backend-plan)
  - [Rating](#rating)
- [Open Questions](#open-questions)

## Development

```sh
npm install
npm run dev             # local dev server (Vite)
npm test                # Vitest: the game, the app and the worker
npm run typecheck       # tsc, for the app and the worker
npm run build           # typecheck, then build the static site into dist/
npm run preview         # serve the built dist/ locally
npm run worker:migrate  # set up the API's local D1 database
npm run worker:dev      # serve the API locally (see worker/README.md)
npm run vapid-keys      # make the Web Push keys for worker/.dev.vars
npm run wordlist        # rebuild the word lists and definitions (wordlist/README.md)
npm run test:wordlist   # the word-list ETL's own tests (Python)
npm run daily-themes -- <env> <folder>  # admin: load the Daily Rush themes into an environment's D1 (worker/README.md)
npm run wipe -- <env>   # admin: wipe game history and leaderboards from an environment's D1
npm run e2e             # browser tests (Playwright, e2e/): builds the app and starts the local API itself
npm run check:size      # after a build: the download-size budget
npm run lighthouse      # after a build: Lighthouse's mobile scores
npm run load-test       # by hand: many players at once, against node e2e/worker.ts or staging
```

CI (`.github/workflows/ci.yml`) runs `npm test`, `npm run typecheck`,
`npm run build`, `npm run check:size` and `npm run test:wordlist` on every
push to a PR. The browser tests (Chromium and WebKit) and Lighthouse run on
`main` and once a PR is marked ready (after its review), and are skipped
when a PR only changes Markdown or `docs/`.
`docs/test-plan.md` says what each covers and what they found;
`docs/manual-checklist.md` is what needs real devices.

Games against a friend, Daily Rush, lobbies, accounts and leaderboards need
the API: run `npm run worker:dev` beside `npm run dev`. The dev server finds
it through `VITE_API_URL` in `.env.development` (`http://localhost:8787`). A
build without a server shows those modes as coming later. To play yourself
locally, use two browsers (or a normal and a private window): each has its
own profile, so its own guest ID.

The build is a static site (`dist/`) for Cloudflare Pages (build command
`npm run build`, output directory `dist`). Everything, fonts and definitions
included, is served from the app's own origin; `public/_headers` sets its
Content Security Policy. Preview builds talk to the staging worker
(`src/buildApiUrl.ts`; `worker/README.md` "Staging").

For search engines (Dev Plan item 18j): `index.html` has link-preview tags
(Open Graph and Twitter cards, with `public/og-image.png`, drawn by
`node scripts/og-image.ts`), a canonical link to `wordmastermind.app` and
structured data; `public/robots.txt` and `public/sitemap.xml` list the
pages. Besides the privacy policy and terms, three static pages are written
for readers and search engines alike, linked from the title screen's
footer: `public/how-to-play.html`, `strategy.html` and
`jotto-and-wordle.html` (all styled by `public/legal.css`). The old address
and every preview send `X-Robots-Tag: noindex` (`public/_headers`), and
from 18f's day a Pages Function (`functions/_middleware.ts`, run for page
addresses only by `public/_routes.json`) redirects the old address
permanently (301) to the new one.

Where things are (`CLAUDE.md` has more on each feature):

- `src/game/`: the rules, as pure TypeScript with no UI, shared by the app
  and the worker. Every game is a record (its secret words, start time and
  moves in order), and everything else is rebuilt by replaying it, so a
  saved game or the server's copy never stores anything it could get
  wrong. Game logic never reads the clock: the time is an argument. A
  record holds the difficulty it started at, and a change of difficulty is
  a move, so a game counts at the easiest difficulty used.
  - Words and scores: `words.ts` (checking a word), `wordLists.ts` (the
    bundled lists), `scoring.ts` (a guess's score, and a Rush's
    `guessesScore` and penalty, tested against the [scoring](#scoring)
    example), `difficulty.ts`, `repeats.ts` (a word already guessed)
  - The modes: `solo.ts`, `twoPlayer.ts` with `computer.ts` (its guesser
    and strengths, calibrated by a test against the word lists), `pvp.ts`
    (two people, with the time controls), `run.ts` (the multi-word engine
    behind every Rush), `daily.ts` and `lobby.ts` (Rush with Friends and
    Competitive Rush); each has a view that hides what one player mustn't
    see
  - Letters: `marks.ts` (Medium's marks and ☰ Check for mistakes),
    `deduce.ts` (Easy's marks), `suggest.ts` (Easy's Suggest)
  - The profile: `records.ts` (reading records back defensively),
    `history.ts` (history entries and what a row shows), `stats.ts`,
    `achievements.ts`, `unlocks.ts`, `profile.ts` (the name rule)
  - `rating.ts` (Glicko-2), `report.ts` (the issue report format),
    `features.ts` (the launch switches)
- `src/app/`: the Preact UI. `App.tsx` switches between screens; each mode
  has a screen (`SoloScreen.tsx`, `TwoPlayerScreen.tsx`, `FriendScreen.tsx`,
  `MatchScreen.tsx`, `RushScreen.tsx`, `DailyScreen.tsx`,
  `LobbyScreen.tsx`), with `TitleScreen.tsx`, `ProfileScreen.tsx` (its
  pages in `profilePages.ts`), `LeaderboardsScreen.tsx`, `Tutorial.tsx`
  and `ReportIssue.tsx`. The pieces they share: `components.tsx` (bubbles,
  histories, keyboard), `gameHeader.tsx` (header, ☰ menu), `panels.tsx`
  (How to play, dialogs, board pages), `rushParts.tsx` (the Rush board and
  results), `friendParts.tsx` and `lobbyParts.tsx`; `messages.ts` has their
  texts. Each server feature has a client that reads
  the server's answers defensively (`*Api.ts`, sharing `apiRequester` and
  `identityHeaders` in `apiIdentity.ts`). Games in progress, settings and
  the profile are kept in `localStorage` (`*Storage.ts`, `settings.ts`),
  finished games in IndexedDB (`historyDb.ts`), and signed in, synced to
  the account (`profileSync.ts`). `definitions.ts` loads the definitions
  the first time one is needed. `public/sw.js` is the service worker that
  shows turn notifications (`turnAlerts.ts`), and
  `public/manifest.webmanifest` lets the game be added to a Home Screen,
  which iPhones need for notifications.
- `worker/`: the backend (see [Backend plan](#backend-plan) and
  `worker/README.md`), a Cloudflare Worker with a D1 database that imports
  `src/game/` unchanged. `wrangler.toml` configures it, `migrations/` holds
  its tables and `src/index.ts` routes requests to a module per feature
  (`guests.ts`, `words.ts`, `accounts.ts` and `authRoutes.ts`, `sync.ts`,
  `friends.ts`, `games.ts`, `dailyRoutes.ts`, `lobbyRoutes.ts`,
  `queueRoutes.ts`, `leaderboards.ts`, `ratings.ts`, `played.ts`,
  `reports.ts`, `pushRoutes.ts`), rate limited by `limits.ts`. Each friend
  game, Daily Rush day, lobby and matchmaking queue is a Durable Object
  (`gameRoom.ts`, `dailyRush.ts`, `rushLobby.ts`, `matchmaker.ts`) running a
  referee that never reads the clock (`room.ts`, `dailyRoom.ts`,
  `lobbyRoom.ts`, `queue.ts`); tests use stand-ins for D1 and each of them
  (`fake*.ts`). `scripts/wipe.ts` empties game history and leaderboards
  from an environment's D1, after you type its name.
- `wordlist/`: the word lists and definitions, built by a Python ETL
  (`wordlist/README.md`).

## Game Overview

Each player secretly chooses a word. Players then take turns guessing the
opponent's word. After each guess, the guesser learns **how many distinct
letters** their guess shares with the opponent's secret word, but not which
letters. The first player to guess the opponent's word wins.

## Rules

### 1. Secret words

Each player picks one secret word at the start of the game. A secret word must:

- be a single English word,
- have exactly **5 letters**,
- contain **only the letters A–Z** (no digits, spaces, or special characters),
- **not** be a proper noun (e.g. `Steve` and `Egypt` are invalid),
- have **no repeated letters** (e.g. `bunny` is invalid because it has two `n`s).

The secret word **does not change** for the duration of the game.

### 2. Guesses

After the game begins, players alternate turns. On each turn the player makes
one guess. A guess must:

- be a single English word,
- have exactly **5 letters**,
- contain **only the letters A–Z** (no digits, spaces, or special characters),
- **not** be a proper noun.

Unlike secret words, a guess **may contain repeated letters** (e.g. `bunny` is a
valid guess). Such a guess can never be the secret word, but it can still be
useful for deducing it.

#### Repeated guesses

A word you've already guessed in this game (in Rush, at this word) is
refused, in every mode and at every difficulty, since it would tell you
nothing new. It doesn't use your turn: the app says which guess it was ("You
already guessed CRANE (guess 3)."), and on Extreme, where your past words are
hidden, it also reminds you of the score ("It scored 2."). The check is
`earlierGuess` (`src/game/repeats.ts`), run before a guess is submitted. The
engines still accept a repeat, so games saved before this rule replay as
they were. The computer never repeats a guess (`computer.ts`), so its
strengths and their average guess counts are unchanged.

### 3. Evaluating a guess

Each guess is evaluated against the opponent's secret word:

1. **Exact match check.** If the guess is the same word as the secret word, the
   guessing player **wins**. Otherwise, continue.
2. **Build letter sets.** Convert the guess into the set of distinct letters it
   contains, and the secret word into the set of distinct letters it contains.
3. **Score.** Compute the intersection of the two sets. The response is the
   **count** of letters present in both. The guesser is told only this number,
   never which letters matched. Letter position does not matter.

### 4. Tracking

Players keep track of their previous guesses and scores, and of which letters
they have deduced to be in or out of the opponent's word, to work toward
guessing it before the opponent guesses theirs.

## Scoring Examples

| Secret word | Guess   | Guess letter set    | Shared letters     | Response    |
|-------------|---------|---------------------|--------------------|-------------|
| `beach`     | `bunny` | {b, u, n, y}        | {b}                | **1**       |
| `beach`     | `beach` | —                   | —                  | **Win**     |
| `crane`     | `nacre` | {n, a, c, r, e}     | {n, a, c, r, e}    | **5** (not a win — anagram) |
| `crane`     | `eerie` | {e, r, i}           | {e, r}             | **2**       |
| `crane`     | `plots` | {p, l, o, t, s}     | {}                 | **0**       |

Notes that follow from the rules:

- The response is always between 0 and 5.
- A guess with repeated letters has fewer than 5 distinct letters, so its
  response is at most the number of distinct letters in the guess.
- A response of 5 without a win means the guess is an anagram of the secret
  word (e.g. `nacre` vs. `crane`).

## Decisions

- **Scoring is automatic.** On paper, the opponent counts the shared letters.
  In the web app, the app computes the response so counting mistakes can't send
  a player off course.
- **Case-insensitive.** Capitalization never matters for secret words or guesses.
- **Custom word list.** "Valid English word" means "on this game's word list",
  which we build ourselves (see [Word lists](#word-lists)).
- **Turn order is random.** No rule decides who goes first; the app picks at random.
- **Final guess and draws.** When both players guess (two-player mode), the
  player who went first may find the word first. The other player then gets
  **one final guess**: finding the word makes the game a **draw**, missing it
  loses. If the player who went second finds the word first, they win at once
  with no final guess, since both have had the same number of turns. Giving up,
  including on the final guess, loses. Single player has no draws. An invalid
  word never uses up a turn, including the final guess.
- **No guess limit.** Time limits come only from the PvP turn times and
  clocks and the Rush timers (see [PvP formats](#pvp-formats)
  and [Rush modes](#rush-modes)).
- **Difficulty is set by how much the app helps you track.** See
  [Difficulty levels](#difficulty-levels).

## Game Modes

1. **Single player** (built): the computer picks a random secret word from the
   list and the human guesses until they find it. Only one side guesses.
2. **Two player vs. computer** (built): the human and the computer each pick a
   secret word and take turns guessing each other's, with the
   [final guess](#decisions) evening out who went first. The computer plays at
   one of four [strengths](#computer-strength).
3. **Two player online (PvP)**, in two forms:
   - **Challenge a friend** (built, live or correspondence): invite a
     specific person to a game by link. See [Two player vs. a friend](#two-player-vs-a-friend).
   - **Random opponent** (built, signed in; switched off for 1.0, see
     [Launch switches](#launch-switches)): enter your secret word, join
     a queue, and get matched with someone near your rating; rated, with a
     [leaderboard](#leaderboards) (item 9b). See
     [Random opponent](#random-opponent).
4. **Rush**: solve 4 secret words against the clock, in four kinds (see
   [Rush modes](#rush-modes)):
   - **Solo Rush** (built, no backend needed): 4 random words.
   - **Daily Rush** (built, on the backend): the day's themed set, once a
     day, with a leaderboard per difficulty.
   - **Rush with Friends** (built, on the backend): up to 5 players, and
     computers, solve the same 4 server-picked words.
   - **Competitive Rush** (built, on the backend, signed in): each player
     sets a word and solves the others'; rated, with a
     [leaderboard](#leaderboards).

Each mode can be played at any [difficulty level](#difficulty-levels). Your
difficulty only affects your own guesses; the computer's strength is separate.

New players start with single player and the tutorial; the other modes
unlock as they win (see [Unlocking modes](#unlocking-modes), built in Dev
Plan item 13).

### Computer strength

A computer that guesses any secret-list word consistent with **every** score
so far finds a word in about **7 guesses**, stronger than most people. So each
turn the computer takes each of its past scores into account only with some
probability (its *recall*), then guesses a random unguessed secret-list word
that fits the scores it recalled. Every guess is plausible; weaker levels just
overlook clues more often. A guess that scored 5 (an anagram of your word) is
never overlooked, at any strength (issue #165): from then on the computer
guesses only anagrams of it. The recalls were retuned for that on 7 October
2026, so each strength keeps the average it had.

| Strength       | Recall | Average guesses (target) |
|----------------|--------|--------------------------|
| **Casual**     | 9.5%   | ~28 (25–30)              |
| **Skilled**    | 19%    | ~18 (15–20)              |
| **Expert**     | 38%    | ~12 (10–15)              |
| **Mastermind** | 100%   | ~7 (never forgets)       |

The app describes the strengths in character rather than by guess counts:
Casual "can play, but sometimes loses its train of thought", Skilled
"determined, but still working on its technique", Expert "highly skilled, and
can challenge the best players", Mastermind "the savant Word Mastermind
player".

`src/game/computer.test.ts` plays a few hundred seeded games per strength and
fails if an average leaves its target range, e.g. after a word-list change;
then recalibrate `RECALL` in `src/game/computer.ts`. A stronger, optimal solver
(best possible guess every turn) is a possible later addition.

### PvP formats

PvP needs the [backend](#backend-plan). Two kinds of game:

- **Correspondence** (built, against a friend): each player has **1 day or
  3 days** per guess, like correspondence chess or online Scrabble. A player
  who runs out of time concedes automatically. The time runs from the
  opponent's last guess (for the first player, from the start of the game),
  including for the final guess; changing difficulty doesn't reset it. The
  app tells you when it's your turn (Web Push; email may follow with
  accounts). This is the first PvP format to build.
- **Live, chess clock** (built, against a friend): each player has **15, 10
  or 5 minutes** in total, and a player's clock runs only on their turn, from
  the other's guess (the first player's, from the start) to their own.
  Running out of time loses, as in correspondence, including on the final
  guess. There is no increment. The server keeps the official clock: the
  game's Durable Object ends the game when the player to move's clock runs
  out (`pvpDeadline`), and each answer carries the server's time, so the
  app's clocks allow for a device whose clock is off. Moves reach an open
  game page at once over a WebSocket.

Either kind can be played against a friend (invite by link, or a challenge
from your [friends list](#friends)) or a [random opponent](#random-opponent).

### Rush modes

Every Rush is built on one **multi-word run**: a list of secret words, a
timer, and a result for each word (guesses, seconds, and whether it was
solved or given up). Each word is played like a single-player game, with no
timer on the individual word. **Rush** on the title screen offers four kinds:

**Shared words, your own order** (Dev Plan item 13): in Daily Rush, Rush
with Friends and Competitive Rush everyone solves the same words, but each
player gets them in their own random order, picked by the server when their
run starts (Daily Rush) or the game starts (a lobby) and kept in the record:
a Daily Rush run's words are in its order, and each lobby seat keeps an
`order`. So nobody learns a word from someone further along, and the group
penalty still compares results word by word (`seatKeys` in
`src/game/lobby.ts`). Lobbies from before play in the words' order.

- **Solo Rush** (built, no backend): *"Practice solving multiple secret
  words in a timed trial."* **4 random secret words** against a stopwatch
  (5 felt too long in playtesting).
  Only you are timed, so the stopwatch **pauses** while you're away (another
  tab, the main menu, the page closed) or press Pause, and the board is hidden
  while paused. You can **give up a word and move on**, after a warning that it
  hurts your score. With no group, the word counts as your worst word found in
  this Rush plus 10 guesses (and at least the guesses and time used on it). A
  Rush with no word found, or given up as a whole, has no score.
- **Daily Rush** (themed): everyone plays the same **themed set of 4 words**
  each day, once.
  - The sets are 578 themes, over a year and a half without repeating: a
    calendar links each theme to a day from **1 October 2026** to **30 April
    2028**. **US holidays** get a theme that suits them (each year takes the
    next theme on the holiday's list), and every other day's theme comes
    from one seeded shuffle. What happens after the last theme is an open
    question.
  - The themes and calendar are **secret**: they're every day's answers, so
    they're kept in a private repo, never this one (which is public), and
    loaded into the server's database (`npm run daily-themes`,
    worker/README.md "Daily Rush themes"). Never name a theme, its day or
    its words in this repo, an issue or a PR.
  - The theme's name is shown when you pick Daily Rush (and in the game
    header). The words stay on the server, which referees every guess, and
    never ship in the app.
  - The day changes at **midnight in New York** for everyone (4:00 or
    5:00 UTC, following daylight saving), so there is one leaderboard a
    day; it was midnight UTC until Dev Plan item 18y (issue 166). The
    switch-over day, 8 October 2026, ran a few hours longer, from midnight
    UTC to New York's midnight, so Friday 9 October's set began at midnight
    in New York; earlier days keep their results. The app
    counts down to the next set in hours and minutes.
  - **Once a day** for each player (an account, or a guest ID). Your name on
    the leaderboard is your profile name (or guest name) when you start.
  - You choose **Medium, Hard or Extreme** before you start, and it can't
    change during the run.
  - The clock stops only for **Pause**, and there is no time limit: a run
    not finished when the day changes can still be finished, but it has no
    leaderboard entry (Dev Plan item 18y; it used to be void).
  - **Giving up** (a word or the run) quits that day's Daily Rush, with no
    leaderboard entry, so Daily Rush has no penalties.
  - **Leaderboard:** one per day **per difficulty**: finishing on Medium
    ranks you against that day's other Medium players. Ranked by **total
    guesses**, with total time breaking ties. It shows your position ("12th
    of 340") and **percentile** ("better than 96%": players − your place,
    ÷ players − 1, so you're left out and first place is 100%; tied players
    share a place, and alone on the board there's no percentage). Past days' boards stay
    viewable, and any day's board can be opened from
    [Leaderboards](#leaderboards) without having played it.
- **Word order:** in every Rush where players share words (Daily Rush, Rush
  with Friends, Competitive Rush), each player gets them in their **own
  random order**, picked by the server when the run starts and kept in its
  record. A posted solution then doesn't say which word you're on, so it
  can't be copied to solve each word in one guess. Rankings are unchanged,
  since everyone still solves the same set. Solo Rush's words are random
  already. *(Built in Dev Plan item 13.)*
- **Rush with Friends** (built): a lobby of up to **5 players** solving the
  same **4 server-picked words** against one shared clock. See
  [Rush with Friends](#rush-with-friends) for the screens.
  - The host opens a lobby and shares its **join code**, and can invite
    players from the [friends list](#friends). The lobby sets **one
    difficulty for everyone** and the **duration**, which defaults by
    difficulty (Medium 30, Hard 40, Extreme 50 minutes, to be tuned; the
    host picks from 10, 15, 20, 30, 40, 50, 60 or 90). A lobby nobody
    starts within a day closes.
  - **Empty seats** can be filled with **computer players** of a strength the
    host picks. A friend who joins a full lobby takes a computer's seat, and
    the host can start with computers alone.
  - The clock starts when the host starts the game and **never pauses**. The
    game ends when everyone has finished or the time is up.
  - Giving up a word shows the same warning as Solo Rush, with the group
    penalty in [Scoring](#scoring); a word unsolved when time is up gets the
    same penalty. Unlike Solo Rush, a word you give up stays hidden until
    the game ends, since the others are still solving it. Standings are
    provisional until the game ends.
  - Nobody sees anyone else's guesses, only how many words they've found and
    how many guesses they've made: the guesses would give the words away.
  - **Turn notifications** (Web Push) when a player (computers included)
    finishes, and with the final result.
  - **Computer pace:** a computer player guesses at a steady interval: the
    duration ÷ 4 words ÷ its strength's **fewest expected guesses per word**
    (the low end of its [target](#computer-strength): Casual 25, Skilled 15,
    Expert 10, Mastermind 7). In a 30-minute game, Skilled guesses every
    30 min ÷ 4 ÷ 15 = 30 s and Mastermind about every 64 s: stronger
    computers make fewer guesses but take longer over each. A computer that
    needs more guesses than that doesn't finish in time. The server plays
    each computer's whole game when the game starts (`computerMoves`), and a
    guess only counts once its time comes.
- **Competitive Rush** (built): Rush with Friends, except each player
  **sets a secret word** and solves everyone else's. See [Competitive
  Rush](#competitive-rush) for the screens.
  - A game always has **5 seats**: computers fill the empty ones, each with
    a random secret word (never one a player set), so everyone solves **4
    words**, as in every Rush. The host picks the computers' strength but
    not how many.
  - You never solve your own word, so setting a hard word helps you; that's
    accepted as part of the strategy.
  - **Two players can't play the same word:** each would find it at once.
    Setting a word taken by another player is allowed (refusing it would
    tell you their word), but the host can't start while two players share
    one: "Two players set the same word, so the Rush can't start", without
    saying whose or what it is. A host can't use this to test words: a word
    nobody else set just starts the game.
  - The group penalty for a word given up or not found counts that word's
    results: the 4 players who solved it (`seatSetters` in
    `src/game/lobby.ts`).
  - **Signed in only**, since it's [rated](#rating): each pair of people is
    a result by their final places, and computers don't count.

#### Scoring

**Decided after playtesting Rush: score by guesses.** A player's score is
their **average guesses per word** (penalties included) × the **difficulty
factor**, lower first, with total time breaking ties. The game still records
raw guesses and seconds for every word, and the formula stays one small,
swappable function (`guessesScore` in `src/game/scoring.ts`).

- **Why guesses:** they measure the skill the game is about, getting the
  most out of each guess, and they're what [your level](#solo-rush) ranks. Time
  mostly measures typing, interruptions and Extreme's thinking time, and solo
  Rush pauses. Speed still matters in the multiplayer Rushes through the
  shared clock, penalties for unsolved words, and tiebreaks.
- **Rejected: composite** (seconds × guesses). A hard word takes more guesses
  *and* more time, so multiplying counts its difficulty twice, and one slow
  word dominated playtest scores (one word was 28% of a 5-word run's score).
  The number also means nothing to a player. Seconds + 20 × guesses was the
  fallback if speed had to count more.
- **Difficulty factor:** harder difficulties count each guess for less, so
  playing Extreme is rewarded even with more guesses: Easy ×1.2, Medium ×1.0, Hard ×0.9, Extreme ×0.8 (`DIFFICULTY_FACTOR` in `src/game/difficulty.ts`). A run is
  scored at the **easiest difficulty used** at any point, since difficulty can
  be lowered from the ☰ menu mid-run (only lowered once you've guessed; see
  [Difficulty Levels](#difficulty-levels)). The factors are a starting guess, to be
  tuned from one Rush at each difficulty, then from local history (PR 3) by
  how many more guesses each difficulty actually takes. Rush with Friends
  and Competitive Rush set one difficulty for everyone, and Daily Rush has a
  leaderboard per difficulty, so the factor doesn't change their standings.
  **Daily Rush** ranks by total guesses (the same 4 words for everyone) and
  has no penalties, since giving up leaves no entry.

**Penalty for giving up or running out of time:** conceding or stalling must
never pay. A word given up, or unsolved when the timer ends, is scored from
**that word's** results in the group:

- guesses = the higher of the guesses used and the **worst solved guess count
  for that word**, plus 10
- seconds (for the time tiebreak) = the higher of the seconds used and the
  worst solved time for that word

If nobody solved the word, the worst solved result on **any** word in the group
is used instead. Because a penalty depends on how others did, standings are
provisional until everyone finishes or the timer ends.

Example: Ann, Bob and Dan all play Cat's word. (The composite column shows
the rejected formula, for comparison.)

| Player | Result | Guesses | Seconds | Guess score | Composite |
|---|---|---|---|---|---|
| Ann | Solved | 12 | 180 | 12 | 180 × 12 = 2,160 |
| Bob | Solved | 18 | 240 | 18 | 240 × 18 = 4,320 |
| Dan | Gave up | 3 | 40 | max(3, 18) + 10 = 28 | 240 × 28 = 6,720 |

Basing the penalty on the player's own worst word instead would leave a
loophole: if Dan's other words were easy (worst 8), giving up would cost only
18, the same as Bob's honest solve.

## Difficulty Levels

The difficulty level controls how much tracking help the app provides.

| Level       | What the player sees |
|-------------|----------------------|
| **Easy** | Medium's full guess history with responses, but the app **automatically marks** the letters that must be in the secret word and those that can't be, in every guess so far, after each guess. Deduction uses **letter logic from the guess history only**, never the word list. See [Easy](#easy). |
| **Medium**  | Full guess history with responses. The player has **manual controls** to mark letters in or out. A mark highlights that letter across every word guessed so far. The app does not deduce anything. |
| **Hard**    | Guess history with responses only: just the words and their numbers. No in/out marking tools and no visual aids. |
| **Extreme** | **No guessed words shown**, except the latest guess, which stays on screen with its response until the next guess. A history of past **scores only** (without the words) is shown. The player must remember which word produced each score. |

Extreme may need calibrating. If a scores-only history is too easy, it could be
reduced to just the last score.

**Changing difficulty during a game** (issue #151, decided with the owner on
7 October 2026): before your first guess you can pick any level, and the one
you pick is the one the game counts at. After your first guess (in a Rush,
your first guess at any of its words) you can only step down to an easier
level, never back up, so the level you and your opponent see is always the
one the game counts at. This holds in every mode; a rated game's difficulty
stays fixed. The rules refuse a harder level (`canPickDifficulty`), and the ☰
menu and the difficulty bubble show the harder levels greyed out. Games saved
before this rule still replay as they were played.

### Easy

Built in Dev Plan item 13c; decided with the owner on 29 September.

- **Screen:** a copy of Medium, but the app does the marking. After each
  guess it marks a letter **in** when every set of 5 different letters that
  fits every score so far contains it, and **out** when none does (complete
  letter logic, the same search as **Check for mistakes**). A letter the
  scores don't settle stays unmarked. It never uses the word list or the
  secret, so it knows only what a perfect note-taker would. The bubbles
  aren't tappable, and ☰ has no **Highlights** (nothing to check or clear).
  The marked-in row shows the letters the app has marked in.
- **Scoring:** difficulty factor ×1.2, to be tuned like the others (see
  [Scoring](#scoring)). Easy is the easiest difficulty, so a game that
  touches Easy is scored as Easy.
- **Modes:** everywhere a difficulty is chosen except rated play: single
  player, vs. computer, Solo Rush, Daily Rush (with its own Easy
  leaderboard, as each difficulty has), Rush with Friends (the host can pick
  Easy for the lobby) and unrated games against a friend. A rated game
  refuses Easy, since automatic marking is a real edge in a race; the
  matchmaking queue and Competitive Rush leave it out when switched back on.
  Easy games count toward badges and unlocks like any difficulty (a harder
  difficulty still awards the easier badges), but a word or game where you
  used Suggest never earns a few-guesses badge (Dev Plan item 13d). The
  badges' descriptions say "without Suggest", and when you find the word in
  20 guesses or fewer after using Suggest, the result says "Suggest used: no
  few-guesses badge" (single player, vs. the computer or a friend).
- **Suggest** (behind the `suggest` launch switch, on at 1.0): on Easy, a
  **Suggest** button fills the input with a secret-list word that could be
  the secret, given every score so far (**fits every score**), never one
  already guessed. The player can submit, edit or clear it. **Once a game**
  (once a word in a Rush). Each suggestion is a move in the game's record,
  so reviews show it ("Suggest used once") and the history CSV names the
  word. No score penalty beyond Easy's factor. If no word fits, it says so
  and isn't used up.
- **How Suggest was settled** (A/B test on the staging preview, 29–30
  September): the owner played 18 games with fits every score and 2 Solo
  Rushes with the other method, **letters only** (any guess-list word
  matching the app's marks), at 3 per game.
  - Fits every score averaged 9.6 guesses per solved word, against 13.3 on
    Medium and 13.0 with letters only (both differences p ≈ 0.03). Letters
    only was no better than Medium, so it was dropped.
  - 9 of the 14 words solved with fits every score were found by the
    suggestion itself, and the owner went 1–1–6 against the Mastermind
    computer. That's no surprise: each suggestion is the Mastermind
    computer's own move. So the limit is 1, not 3.
  - Suggestions were almost always used from the 4th guess on, and always
    submitted unedited.
- **Details settled while building it** (the owner may change them): Easy's
  badges are jade, below bronze Medium, with a green–grey–green icon. A
  lobby opened at Easy starts at 20 minutes. Ticking **Rated game** on a
  friend challenge at Easy moves that challenge to Medium, with a note (Easy is
  greyed out while it's ticked; Dev Plan item 18r), and accepting a
  rated challenge with Easy as your default plays it at Medium, as the
  invite says. With Easy as your default, the random opponent and
  Competitive Rush play at Medium, without changing your default. Guess order
  settings saved before Easy read as oldest first at Easy. Easy's badges count toward Achievement Hunter like any other
  (Dev Plan item 13d; 13c had left them out so Hunter badges earned before
  Easy stayed earned).

## User Interface

Easy, Medium, Hard and Extreme are built (see [Easy](#easy) for Easy).

### Game screen header

1. The game name, the profile button and the ☰ menu (**New game** is in the
   menu, keeping this row uncrowded on phones). The name is also a button
   back to the main menu, like ☰ **Main menu** (Dev Plan item 18), with the
   app's icon beside it (item 18r). Screens
   without it (a setup step, the profile, Leaderboards) have ← Back.
2. Who's playing: **You vs. Computer** (with the computer's strength in two
   player), and your difficulty. On one line: a long opponent name is cut
   short (…), never a rated opponent's rating after it. The difficulty is a
   bubble in its badges' metal (Easy jade, Medium bronze, Hard silver,
   Extreme gold; issue #149), and while it can change, tapping it opens the
   difficulty choices, as ☰ has them (issue #150).
3. On your guesses (Medium): the letters you've marked **in**, as a set of
   green bubbles ("None yet" until there's one; the row is always there, so
   marking a letter never moves the guesses). On the
   computer's guesses (two player): **your word**, turning green if the
   computer finds it. Empty otherwise.
4. Two player only: the **You (n)** / **Computer (n)** tabs.

### Letter bubbles

Letters are shown in round bubbles, not square tiles.

- **Input:** a row of 5 evenly spaced empty bubbles that each take one letter,
  filled left to right as the player types (on-screen or physical keyboard).
  Backspace clears the last letter. The on-screen **Enter** lights up once
  all 5 letters are typed, and a setting (**Enter on the right**) swaps
  Enter and ⌫ for players who prefer Enter on the right. On Easy and Medium
  (rated games too) a **Shuffle** key at the end of the middle row puts the
  typed letters in a new random order, to help unscramble an anagram before
  submitting it.
- **Guess history:** one guess per line, its number (1, 2, 3…), the ⓘ
  button, its 5 letter bubbles, then `–`, then the score, e.g.
  `3 ⓘ (C)(R)(A)(N)(E) – 2`. The winning guess has no score after it (the
  result below says you found it; "Win" didn't fit a phone held upright).
  The newest guess is at the bottom by
  default; a profile setting (per difficulty) puts the newest at the top.
- **Screen readers** hear each part as one whole phrase (1.0's manual
  checklist, VoiceOver): "Guess 3", "Letter C" (a key or a bubble, with its
  mark where one is shown, never "cap C"), "Score 2" or "Found it",
  "Medium difficulty", and an opened definition as a sentence per line
  ("Definition of limes, a form of lime.", "limes, noun: …").

### Letter marks

| Mark         | Style                             |
|--------------|-----------------------------------|
| **Unmarked** | White text on a black background  |
| **In**       | White text on a green background  |
| **Out**      | Black text on a grey background   |

On the keyboard in light mode, a plain key is white with a thin edge and an
out key a darker grey (`#8E8E8E`), so the two are told apart (3:1); the
guess bubbles keep their grey.

- **Medium:** tapping a letter bubble in the history cycles that letter
  unmarked → in → out → unmarked (a physical Enter afterwards submits the
  guess; it doesn't cycle the bubble again). A mark applies to the letter across every
  guess, so marking one `a` as in turns every `a` green. The ☰ menu's
  **Highlights** offers **Check for mistakes**, which says only whether your marks fit
  every score so far (some set of 5 different letters could score each guess
  as it did, containing every letter marked in and none marked out), never
  which mark is wrong; it uses letter logic only, not the word list or the
  secret, so it gives nothing away. It works **once a game** (once a word
  in a Rush), in every mode, rated games included (issue #134, decided with
  the owner on 7 October 2026): the menu says "1 check left" until it's
  used, then greys it out. The app counts it on the device by game, since it
  uses only what the player can see (`src/app/checkLimit.ts`); practice
  after a loss isn't limited. **Clear all highlights** removes every mark.
- **Hard:** every letter is shown unmarked, and the bubbles are not
  interactive.
- **Extreme:** your guessed words aren't shown while you play, except the
  latest: it stays on screen with a large score until your next guess, then
  hides. Below it, a list of past scores by guess number (`Guess 3 … 2`). The
  words are revealed when the game ends. In two player, the computer's guesses
  are still shown in full.
- Double-tapping anywhere, letters included, never zooms on iOS Safari
  (`touch-action: manipulation` on every element, and `doubleTap.ts` for
  iPad's slower, wider double taps and a palm resting on the screen);
  pinch-zoom still works.
- Screens that are content to read (the title, profile, Leaderboards, a
  lobby, a Rush's result) scroll as a whole page, so a swipe or the mouse
  wheel anywhere, the side margins and header included, scrolls them. Game
  screens keep the keyboard in place and scroll only the guesses. While a
  pop-up is open (How to play, Report an issue, the tutorial, an "are you
  sure"), the page behind it stays still.
- A long press or drag on a screen never selects text (no Copy / Look Up
  over the board), except in text fields and definitions.

### Title screen

The app opens on a title screen: **Single player**, **Two player** or
**Rush**. Rush then asks which kind: **Solo Rush**, **Daily Rush** (showing
today's theme and the time until the next set), **Rush with Friends** (then
**Open a lobby**, or a join code and **Join**) or **Competitive Rush**
(the same, then your word); without the game server, the kinds that need
it are shown as coming later. Two
player then asks for the opponent (Computer, A friend or Random opponent),
then the computer's strength (Casual, Skilled, Expert, Mastermind) or,
against a person, the time control: **Live** with 15,
10 or 5 minutes each, or 1 or 3 days per guess.
Every mode then asks for your difficulty, Medium by default, and
**Start game** (against a person, **Next: your word**). Each setup step pre-selects the last choice made
(the home screen's mode choices don't: a tap there goes straight on). A
**Leaderboards** button sits under the mode choices at all times, whatever
is unlocked or in progress and whether or not you're signed in (see
[Leaderboards](#leaderboards)). **Continue** appears for each mode with a
game in progress, naming it (**Continue Daily Rush**), and reloading the page mid-game
goes straight back into the game of the mode last played. **How to play**
under the mode choices opens the rules, beside **Report an issue** (see
[Reporting an issue](#reporting-an-issue)). Until you hide it, a
**Tutorial** card sits above them (see [Tutorial](#tutorial)); once hidden,
**Tutorial** joins the links instead. Below them, a footer of small links
opens the static pages: **Full rules**, **Strategy**, **Jotto and Wordle**,
**Privacy** and **Terms** (Dev Plan item 18j). Under the mode choices, a new player
is offered **Sign in** (opening the profile's **Account**, with **Not now**)
and then, once signed in or after Not now, **Turn on turn alerts** (the same
offer as in a first friend game): one card at a time, each gone once done or
put off (Dev Plan item 18, issue #81). Above the mode choices, under any
**Continue game** (Dev Plan item 14 moved them up from the bottom, where a
phone hid them), friends' **Rush invites** and then **Online games**:
**Online games** lists your games against a friend or a random opponent that you haven't
seen finish, games
waiting on your turn first (tagged **Your turn**, with the time left), then
your friends' turns and invites nobody has accepted yet. You can have any
number going at once; tap one to open it.

On the old address, `word-mastermind.pages.dev` (never a preview), a popup
on the title screen says the game has moved to `wordmastermind.app` and lists
the steps: sign in here first so your games come with you (or, as a guest,
save a backup here and restore it there), open the new address, add it to
your home screen, sign in and turn on turn alerts. ✕ closes it for the
visit; it shows on each visit until **Done**. From 1 November 2026 the old
address sends you straight to the new one, keeping the page's link (Dev Plan
item 18f, issue #92): the server answers with a permanent (301) redirect, so
search engines move the old address's ranking to the new one (item 18j).

### Unlocking modes

Built in [Dev Plan](#dev-plan) item 13. A brand-new player, guest or account, starts
with **Single player** and the **Tutorial** only, and unlocks the rest in
three steps:

1. **Win a single player game** → **Two player** (vs. the computer and vs. a
   friend).
2. **Win a two player game** (vs. the computer or a friend; a draw isn't a
   win) → **Solo Rush**.
3. **Finish a Solo Rush without giving up a word** → every other Rush kind
   (Daily Rush, Rush with Friends, Competitive Rush).

Each step needs the one before it: a win against a friend by invite link
before any single player win opens Solo Rush only once two player is open.

- Unlocks are a pure rule over the saved game records, like
  [achievements](#achievements) (`src/game/unlocks.ts`), never a stored flag,
  so players who already have qualifying games start with them unlocked, and
  resetting the profile locks them again. Any difficulty counts.
- Each step earns a badge (see [Achievements](#achievements)): a seal tagged
  UNLOCKED with an open padlock, in bronze, silver and gold. Its toast says
  what was unlocked ("Solo Rush unlocked! Find it on the home screen").
- On the title screen a locked choice is greyed out with a light grey
  padlock at its right, apart from the text (issue #94), and says how
  to unlock it ("Win a single player game to unlock") in place of its
  description, which comes back once it's open. How to play, the
  Tutorial and [Leaderboards](#leaderboards) are always open.
- An invite link or join code from a friend still opens its game: the gate
  is only on starting a mode from the title screen. A locked Rush with
  Friends keeps a **Join with a code** link, and its step's **Open a lobby**
  is the part that's locked. Games in progress can always be continued.
- While your games load, nothing shows locked, so a player with everything
  open never sees the locks flash.
- Besides easing new players in, it makes a fresh guest ID made to take
  another shot at [Daily Rush](#daily-rush) cost a few games first. The
  server can't yet check an unlock itself (see [Open
  Questions](#open-questions)).

### Two player vs. computer

- **Choose your secret word** first, typed like a guess, with **Pick for me**
  for a random secret-list word and **Recently used**: your last 10 secret
  words, newest first, one tap to fill one in (stored in this browser only).
  A word that's a valid guess but not on the secret list is refused with "Try
  a more common word". Then a coin toss picks who goes first.
- **Your word** shows in header row 3 while the Computer tab is open, turning
  green if the computer finds it.
- **Phones:** two tabs, **You (n)** and **Computer (n)**, with a dot on the
  Computer tab for a guess you haven't looked at. Above the input, a line
  shows the computer's latest guess and whose turn it is ("Your turn", or
  "Computer is thinking…"). The computer waits about 0.8 s before guessing;
  you can type ahead meanwhile. **Wide screens (≥ 900 px):** both guess lists
  side by side, no tabs.
- **The computer's guesses** are marked as on Easy (Dev Plan item 18i, issue
  #95): the letters its scores prove in are green and those they rule out
  grey, worked out from its guesses and scores alone ("Marked as on Easy"
  above them). Letters of your word it has worked out turn green in **Your
  word** at the top. Your own guesses follow your difficulty, as in single
  player.
- **Your final guess** (the computer went first and found your word): a red
  **Last chance** banner with a heartbeat pulse, a pulsing red edge, glowing
  input bubbles and an Enter key reading **Final guess**. A hit is the
  biggest celebration in the game: **Clutch! You tied it on your last guess**,
  a **Draw** badge, the word's bubbles flipping green one by one and confetti.
- **The computer's final guess** (you went first and found its word): a green
  "You found BEACH! Waiting for the computer's final guess…" banner while it
  thinks for about 2 s. With nothing to type, the input bubbles and keyboard
  are hidden until the result (issue #154); against a friend too, with the
  way to your next game.
- **Result:** the outcome, your guess count (turns alternate, so the
  computer's is the same, or one off after a give-up), and the computer's
  word with its definition; **Play again** (same settings) or **Main menu**.
  Their word has a red ring round its letters, so it reads as theirs and not
  one of your guesses. A **×** folds the card to one line, "The computer's
  word" and the word, leaving the history the room; tap the line to open the
  card again (Dev Plan item 18l, issue #101). A game against a friend ends
  the same way.
- Animations are turned off under `prefers-reduced-motion`.

#### Play on after a loss

Dev Plan item 18b, issue #61. When you lose a two player game without
finding their word (vs. the computer or a friend, rated or not, including
giving up, running out of time or missing your final guess), the result card
keeps their word hidden and offers **Keep guessing** beside **Show their
word** (folded, the card reads "Hidden").

- **Keep guessing** closes the card and you carry on on the same board, at
  your difficulty, with your guesses so far. A **Practice** banner says these
  guesses don't count, and a "Practice: these don't count" line on the board
  separates them from the game's. Each guess is checked like any other
  (on the guess list, not a repeat), scored on this device, and there is no
  turn or clock. Medium's marks start from the game's and are kept apart from
  them.
- It ends when you find their word, or with **Show their word** (on the
  banner, or in ☰ in place of Give up). The result card comes back with their
  word and a line on the practice: "Found it after 3 practice guesses. The
  game counted 5 guesses." (the game's count is the one kept; issue #143), or
  "Practice: 3 guesses more before you looked".
- The practice is kept on this device only (the latest 20 games), so a reload
  picks it up. It never changes the game's record, result, history, rating or
  badges, and is never synced or sent to the server. A past game reviewed
  from the history shows their word as before, with no play on.

### Two player vs. a friend

Live or correspondence PvP ([PvP formats](#pvp-formats)), with no login
needed: you play as your guest (this device's profile), so a game can only
be played from the device that joined it, or, once you've signed in (see
[Accounts](#accounts)), from any device signed in to your account.

- **Inviting:** choose the time control (live, or days per guess) and your
  difficulty on the title screen, then your secret word. The server makes the game and the app shows
  its **invite link** (`/?join=…`, with a long random ID nobody can guess),
  with **Copy link** and **Share** (a share icon). Share opens the device's
  share sheet (Messages, WhatsApp, email…) with the link and "Ann wants to
  play Word Mastermind with you! Up to 1 day per guess. Tap the link to accept."
  (for a live game, "A live game, 10 minutes each.").
  On a phone whose browser can't share, the button reads **Text it** and
  opens the messaging app with the same text (an `sms:` link); nothing is
  sent by the server. The first
  person to open the link and choose a word joins; after that the link only
  shows that the invite was taken. The link works for **24 hours** (an
  **hour** for a live game, since you're waiting to play now); if nobody
  accepts it by then, it expires and the app tells you (a turn alert, if
  they're on). **Cancel invite** (in ☰ too) withdraws it before anyone
  joins. You can have any number of invites and games going at once.
- **Accepting:** the link opens "Ann challenges you", with the time
  control; in a live game, the clocks start as soon as you accept. You choose your secret word (with Pick for me and Recently used, as
  against the computer), and the server tosses the coin for who goes first.
  You play at your default difficulty, changeable in ☰ as usual. A
  challenge or rematch sent to you alone (not a link anyone can use) also
  has **Decline**: the sender is told ("Bob declined your challenge"), and
  it can't be accepted after.
- **Names:** the game's screen shows each player by the name they go by
  now, in progress and finished (issue #133): a guest who later signs in,
  or a player who changes their profile name, shows by the new name the
  next time the game is looked at. This follows every guest ID linked to
  the account, so a game played on a shared device shows the name of
  whoever signed in there since (owner, review round 1). A player without
  an account keeps the name they played under, and so does a name the
  profanity filter now refuses. Turn alerts, and a finished game already
  in your profile's history, keep the name from when they were sent or
  saved.
- **Playing** looks like playing the computer, with your friend's name in
  place of "Computer": two tabs (or two columns on wide screens), and the
  final-guess banners. Above the input, one line on any phone: their latest
  guess (`Ann: CRANE – 2`, with a long name cut short) and **Your turn** or
  **Their turn** with the time left (`24h`, `2d 5h`). The result shows your
  guess count.
- **Next game:** while you wait for your friend, and on the invite and
  result screens, a link such as **Your turn vs. Cleo →** takes you to your
  next game waiting on your guess (the one whose time runs out first). It
  takes the status message's space under the input, so nothing moves; on the
  result screen it's the main button. The server is the referee: it scores every guess with the same
  code as the app and never sends you your friend's word until you've found
  it or the game is over. While the page is open, it keeps a WebSocket to
  the game (`/api/games/ID/live`), and the server says "changed" down it
  after every move, so the app fetches the game at once. The socket carries
  nothing else, so it needs no sign-in, and it reconnects if it drops. The
  app also checks every 10 seconds and whenever you come back to the page,
  in case the socket is down.
- **Live clocks:** above the input, both clocks (`You 4:32` and `Ann 3:10`),
  counting down every second; the one running is filled, and turns red under
  30 seconds. Opening your profile on your turn warns first that your clock
  keeps running.
- **Time per guess:** both players see how long the player to move has
  left, beside **Your turn** or **Their turn** (in red under 3 hours on
  your turn), and the title screen's list shows it too ("23 h left"). When it runs out, that player loses: the server's alarm for the game
  ends it at the deadline, even if nobody has the game open ("Ann ran out of
  time. You win!").
- **Turn alerts** (Web Push): a notification when it's your turn, when your
  friend accepts your invite, and when a game ends, even with the game
  closed. A live game skips the alert for each turn, since you're both
  playing. Tapping one opens the game, even when the app is already open on
  another screen (it switches there without reloading), or the app was
  closed. On an iPhone's Home Screen app, which can miss the tap while it
  wakes up, the tap is kept for two minutes and the app opens the game as
  it comes back to the front (issues #132 and #169). The first game offers **Turn on turn
  alerts** (with **Not now**); the browser then asks once whether to allow
  notifications. Once turned on, or after **Not now**, the offer doesn't
  come back on that device unless the browser stops allowing notifications
  or you turn them off. It isn't offered when the server has no push keys;
  the profile's setting says so instead. The profile's settings turn them on or off for this device.
  Each device is turned on separately. On iPhone and iPad they only work once
  the game is on the Home Screen (Share, then Add to Home Screen), which the
  app explains there. A private window can't get them. A newer notification
  about a game replaces an older one, and one a device can't receive within
  a day is dropped.
- **Giving up** is open to either player at any time (☰ **Give up**,
  confirmed first), and loses.
- **Difficulty** is per player, and it never changes who wins.
- **Their board** (Dev Plan item 18i, issue #95): your friend's tab says the
  difficulty they play at ("Ann plays at Medium: …") and marks their guesses
  to match. At **Easy**, the full marks the app works out from their scores,
  as on your own Easy board. At **Medium**, the marks they've made
  themselves, mistakes included, as they were when they sent their latest
  guess (marks travel with each guess, not live). At **Hard** and
  **Extreme**, no marks. Letters of your word they've worked out (Easy) or
  marked in (Medium) turn green in **Your word** at the top. This replaced
  showing your word's letters green in their guesses, which told you
  nothing new.
- **Share my Medium marks** (profile settings, synced, on by default): turned
  off, your marks aren't sent with your guesses, so your friend's tab shows
  none while you play at Medium, and says "Ann plays at Medium. Ann isn't
  sharing marks." (also said of an app older than 1.3.0, which sends none;
  issue #129). Your board at Medium says "Ann sees your
  marks with each guess you send" while it's on; How to play and the ☰
  difficulty note say so too. The server keeps marks only from a player at
  Medium, and only letters a–z marked in or out.
- **Result:** as against the computer, with **Rematch** (below) and
  **Main menu**; **New invite** (a new link anyone can use, same settings)
  is in ☰. After a game from the random opponent queue, **Find another
  opponent** takes Rematch's place.
- The server keeps each finished game's record in its game history (D1).
  Since Dev Plan item 13, games against a friend are in the profile's
  history, stats and achievements too (see [Game history](#game-history)).

#### Rematch

After a game against a friend or a link opponent (Dev Plan item 18h,
issues #96 and #78), **Rematch** is the result's main button (after
**Your turn vs. …** when another game waits on you).

- It asks for your new secret word, then sends a challenge to that player
  only, signed in or a guest, with the same clock, rated if the last game
  was. Each of you plays at the difficulty you ended the last game on.
  Who goes first is a new coin toss.
- They're told by turn alert ("Ann wants a rematch"), it's in their
  **Online games** on the title screen ("Ann wants a rematch"), and if
  their result screen is open, its main button turns into **Ann wants a
  rematch →** at once. They accept by choosing their word, or **Decline**.
- One open rematch per game: once either of you has asked, your result
  shows **Rematch sent →** or **Ann wants a rematch →** instead. If you
  both tap Rematch at once, the second one accepts the first with their
  word.
- It expires like an invite (an hour for a live game, 24 hours otherwise),
  and the sender is told when it's declined or expires. Once it's
  declined or expired, **Rematch** is back on the last game's result
  (**Back to your last game** leads there), so either of you can ask
  again. That happens at once on an open result screen too (issue #119),
  and while the app checks, a greyed **Rematch** holds the button's place.
  If theirs closes just as you tap Rematch, yours is sent as a new one. One its sender cancelled can't be replaced, so cancelling and
  resending can't flood the other player with notifications (owner, review
  round 2); New invite still works.
- A rematch of a rated game is rated, even if you're no longer friends
  (decided with the owner, since a rated queue opponent can be rematched
  too once Random opponent is back).
- Reviewing a past friend game from the history shows **New invite** on
  its result instead of Rematch.

### Random opponent

Built in [Dev Plan](#dev-plan) item 10: the matchmaking queue. It's
switched off for the 1.0 launch, until there are enough players (see
[Launch switches](#launch-switches)), and since item 13b it offers the live
clocks only.

- **Signed in only:** matched games are always [rated](#rating), and a
  rating needs an account. Signed out, the screen says so, with **Open
  profile**.
- **Choosing:** Two player → **Random opponent** → the time control (live
  15, 10 or 5 minutes each) → your difficulty →
  **Next: your word**, then your secret word (with Pick for me and Recently
  used). There's one queue per time control and difficulty, so you only
  meet players on the same clock and difficulty, and difficulty is fixed for
  the game.
- **Live only:** the queue needs your page open while you wait, which suits
  a live game but not one played a guess a day. Correspondence stays a game
  against a friend until the queue works without an open page (the server
  refuses a correspondence queue).
- **Waiting:** **Looking for an opponent…** with the time waited, the
  choices, your word and **Cancel**. The app checks in every 2 seconds; the
  server drops anyone it hasn't heard from in 30 seconds (the page was
  closed), and the app joins again by itself if it was dropped while in the
  background. Leaving the screen leaves the queue.
- **Matching:** two players are paired when their ratings (in that
  [pool](#rating)) are within **200 points**, a gap that widens by 10 points
  each second the longer-waiting of the two has waited (500 after 30
  seconds); the closest rating wins, the longest waiting on a tie. It's to
  tune once there are players.
- **The game:** the player who waited longer is the host; the coin toss
  decides who goes first as usual. It then plays like a game against a
  friend (clocks, turn alerts, **Online games** on the title screen), with
  **Find another opponent** in place of New invite. The waiting player also
  gets a **Matched with Bob** alert.
- The server (`worker/src/queue.ts`) runs one Durable Object per queue
  (`QUEUES`, named like `10m:hard`), which starts the game in a game room
  like any other.

### Daily Rush

- **Rush → Daily Rush** on the title screen shows today's theme and the
  time until the next set. Then you choose your difficulty, once, and
  **Start Daily Rush**; a run in progress opens straight away. Once you've
  finished or given up today's, the tile is greyed out like the kinds coming
  later, tagged **Played today** (or **Given up today**), with a **See
  today's leaderboard** link.
- Header row 2 names the theme (**Daily Rush ·** and its name); row 3 has
  one dot per word, **Pause** and the clock, which follows the server's.
  There's no New game, and the ☰ menu's difficulty can't change.
- **Pause** (Dev Plan item 18y, issue 170) stops your clock and covers the
  board ("Paused", with **Resume**) until you come back; your time leaves
  the pauses out. The server records each pause and resume as moves, so
  the run still replays. It pauses only when you press it, not when you
  leave the page, and a run started before Pause can't pause. Each word plays like Solo Rush's, refereed by the server
  (`worker/src/dailyRoom.ts`): the words stay there until you find them.
- **Give up today's Daily Rush** (☰ menu) asks first, then ends it with no
  leaderboard entry; the words you didn't find stay hidden until the day is
  over.
- **The day's last minutes** (Dev Plan item 18y, issue 161): with 5
  minutes or less of the day left, the game warns above the board,
  counting down ("4 minutes left to finish for today's board."), and the
  start screen warns before you begin ("Only 4 minutes of today left: a
  run not finished by then won't go on the board.").
- **Late finishes** (Dev Plan item 18y, issue 160): a run still going when
  the day changes can be finished during the next day, but it isn't on the
  leaderboard or the Daily Rush streak. While you play it, a note says the
  day has changed; the end says "You finished after the day changed, so
  this one isn't on the board", with **Today's Daily Rush** to go on to the
  new set. Until it's finished or given up, opening Daily Rush goes back
  into it; a day later still, it can't be finished.
- **Result:** each word with its guesses and time, total guesses and time,
  and your **place so far** ("12th of 340 · better than 96%"); places are
  final at midnight New York time. **Leaderboard** shows the day's top 10 for each
  difficulty (ties share a rank), your place below them if you're not in
  it, and earlier days (‹ ›) with their words. Its **← Back** returns to
  the result.
- Before you've played today, **Leaderboard** beside **Start Daily Rush**
  opens today's board too (and [Leaderboards](#leaderboards) opens it from
  the title screen). Today's words stay hidden until the day is over; the
  guess counts you're up against are shown, which is accepted.
- **A known limit, accepted for 1.0** (security review, Dev Plan item 15):
  the words are the same for everyone, so someone can play once as a
  throwaway guest (a private window, or cleared site data), then again as
  themselves already knowing them. No rule stops it outright (requiring an
  account only means a second account), and a limit per internet address
  would stop a household sharing Wi-Fi from each playing, so it stays as it
  is; revisit if impossible scores show up on the boards.

### Leaderboards

Built in [Dev Plan](#dev-plan) item 9b: the page, the Daily Rush board and
the PvP rating boards; Competitive Rush's board came with its mode (item
11). The app side is `src/app/LeaderboardsScreen.tsx` and
`leaderboardsApi.ts`; the server's `worker/src/leaderboards.ts`. At the 1.0
launch only the Daily Rush board is on: the rating boards are switched off
until there are enough rated players (see [Launch switches](#launch-switches)).

- **Leaderboards** on the [title screen](#title-screen), always shown, opens
  the **Leaderboards** page: a header with **← Back** (to the title screen)
  and one tile per board. Without the game server, the tiles are greyed
  out and tagged coming later, like the Rush kinds. While Daily Rush is the
  only board (the rating boards switched off), **Leaderboards** opens it
  directly, and its **← Back** returns to the title screen (Dev Plan item
  14).
  - **Daily Rush:** the day's board by difficulty (see [Daily
    Rush](#daily-rush)), today first, earlier days with ‹ ›.
  - **Live PvP · 15 min**, **Live PvP · 10 min** and **Live PvP · 5 min**:
    rating, one per clock, as the [ratings](#rating) are.
  - **Correspondence PvP**: rating (1 and 3 days per guess together).
  - **Competitive Rush**: rating.
- Every board has **← Back** in its header, returning to where it was opened
  from: the Leaderboards page, or the Daily Rush result or title-screen
  link.
- **Which modes are rated:** one [Glicko-2](#rating) rating per pool, so
  each has a board: each live clock, correspondence, and Competitive Rush.
  Games against a [random opponent](#random-opponent) are rated, as is a
  challenge from the friends list marked **Rated game** and a [Competitive
  Rush](#competitive-rush) with at least two people; invite links are
  unrated.
  Single player, vs. the computer, Solo Rush (all on the device) and Rush
  with Friends are unrated; Daily Rush has its per-day board instead.
- **A rating board** lists the **top 100** by rating (rank, name, rating
  rounded to a whole number, rated games played), with your place below it
  if you're not in the top 100, or how many more rated games until you're
  listed while your rating is provisional (`gamesUntilListed`: draws
  against an established player of your rating, as a typical opponent).
  Signed out, it offers signing in to get rated. Players whose rating is still
  **provisional** (Glicko-2 rating deviation above 110, which also returns
  after a long break) aren't listed. Ties share a rank.
- **Everyone / Friends:** signed in, a toggle narrows any board (Daily Rush
  included) to you and your [friends](#friends).
- Names are profile names (or guest names), which pass the profanity filter;
  rows never carry a player's ID, only whether a row is yours, as on the
  Daily Rush board. Boards are read from D1 when opened (ratings in a
  `ratings` table updated when a rated game ends), never from a cached copy.

### Rush with Friends

- **Rush → Rush with Friends → Open a lobby**, then your difficulty and
  **Open lobby**, makes a lobby with you as host. It shows its **join code**
  (6 letters and digits, leaving out 0, O, 1 and I) with **Copy link** and
  **Share** for its link (`/?lobby=…`, shown only if copying fails, so the
  code isn't on screen twice), the 5 seats, and the host's settings:
  **difficulty** for everyone, **duration**, and **computer players** in
  empty seats (− and +, and their strength). **Start the Rush** needs a
  second player, a friend or a computer. **Close lobby** (confirmed first, in a pop-up)
  ends it for everyone and takes the host back to the main menu. Others see "Waiting for Ann to start", with
  **Leave lobby**.
- **Joining:** type the code on the Rush with Friends step, or open the
  link: "Ann's Rush with Friends" shows the settings and who's in, and
  **Join** takes a seat under your profile name (which must pass the
  profanity filter, as it's shown to the others). A lobby that has started
  or closed says so.
- **Playing:** header row 3 has one dot per word, **Players** (the
  standings so far) and the **time left**, counting down from the server's
  clock. Each word plays like Solo Rush's, with no Pause and a difficulty
  that can't change. ☰ has **Give up this word and move on** and **Give up
  the rest of this Rush**, each warning in red how the group penalty counts.
- **Result:** once your words are done, each word with its guesses and time
  (a word not found stays hidden until the game ends), your **score**
  (average guesses per word, penalties included, × the difficulty factor)
  and **place**, and the **standings**: finished players ranked by score
  (time breaks ties, ties share a place), then those still playing with
  their words found and guesses so far. They're provisional until everyone
  has finished or the time is up.
- **Turn alerts:** the lobby offers them, for a notification when a player
  finishes ("Ann finished the Rush · Score 9.5, with 4 of 4 words found.
  You're 2nd so far.") and at the end ("The Rush is over: you came 2nd of
  4"). Tapping one opens the lobby.
- A reload, or **Continue Rush with Friends** on the title screen, goes back
  to your lobby until it's over. The server keeps each finished game in its
  game history (`games`, mode `lobby`); like Daily Rush, it's not in the
  profile's history or stats yet.

### Competitive Rush

Switched off for the 1.0 launch, until there are enough players (see
[Launch switches](#launch-switches)).

- **Rush → Competitive Rush → Open a lobby**, then your difficulty and
  **Next: your word**, then your secret word (with Pick for me and Recently
  used), opens a lobby with you as host. It plays like [Rush with
  Friends](#rush-with-friends), with these differences:
  - Signed out, the screen says it's rated and needs an account, with
    **Open profile**.
  - **Joining** (by code, link or a friend's invite) asks for your word
    before you take a seat. In the lobby, **Your word: CRANE · Change**
    lets you change it until the host starts. Nobody else ever sees it
    before the game is over.
  - The seats are always full: computers sit in every empty seat and give
    way to people who join. The host sets their strength, the difficulty
    and the duration.
  - Playing, the empty history says whose word you're on ("Word 2, Bob's:
    no guesses yet"), and the result lists whose word each was.
- The server keeps each finished game in its game history (`games`, mode
  `lobby`, the record's `kind` being `competitive`).

### Solo Rush

- Header row 3: one dot per word (green once found, grey if given up,
  outlined for the word being played), a **Pause** button and the stopwatch.
  The stopwatch pauses automatically when the page is hidden or closed, or
  you exit to the main menu. Coming back to a hidden tab resumes it; after
  Pause, the main menu or a reload, a **Paused** panel hides your guesses
  until you press **Resume**.
- Each word plays like single player at your difficulty. Finding one moves
  straight on to the next ("Found BEACH in 4 guesses. Word 3 of 4."), with
  the history and Medium's marks cleared.
- **Give up this word and move on** (☰ menu) warns, in red, that it will hurt
  your score and how it's counted, then reveals the word and goes on.
- **Give up and reveal the words** (☰ menu) ends the Rush, with no score.
- **Result:** each word with its guesses and time (ⓘ for its definition;
  tapping the guess count shows that word's guesses, with their marks),
  then the **score** (average guesses per word × the difficulty factor, see
  [Scoring](#scoring)) and **your level**. One line under them spells out
  the sum where the difficulty changes the number, e.g. "15.0 guesses a word
  × 0.8 (Extreme) = 12.0", then total guesses and time, the average time
  (and at Medium, where the score is the average, the average guesses) per
  word, penalties included, and any penalty for words given up (Dev Plan
  item 14 folded the separate averages into this line). Paused time never counts. There's no
  tiebreak line: a solo result isn't ranked against anyone, so it can't tie. Your level
  ranks the score by the computer strengths and their targets: under 10 is
  Mastermind, under 15 Expert, 15 to 20 Skilled, and above 20 Casual.
- **Difficulty** can still be changed from the ☰ menu, which notes that a
  Rush is scored at the easiest difficulty used. Going easier mid-Rush says
  "This Rush will now be scored at Medium."

### Menu

The ☰ menu holds this game's difficulty (a change is recorded in the game;
where it can't change, as in Daily Rush, a rated game or a game that's over,
it's a line saying which it is rather than a greyed-out control), **How to
play** (a popup with the rules, scoring, how marking works and the
difficulties, ending with the credit for the definitions),
**Report an issue** (see [Reporting an issue](#reporting-an-issue)),
**Give up**, which asks for confirmation before revealing the word (in
single player and two player vs. the computer, before your first guess,
even if the computer has guessed, unless it has found your word and you're
on your final guess, it's **Cancel this game** instead, which
ends the game at once without revealing the word or saving it to your
history; Dev Plan item 18),
**New game**, which starts a new game with the same settings (the
computer's strength and the difficulty you were playing at), asking first
if the current game has guesses, and **Main menu**, which keeps the game so
it can be continued: the same words as the end-of-game panels. Dev Plan item
14 made New game a plain button there rather than the menu's boldest, since
it ends the game you're in. The guess
order (per difficulty) and default difficulty are settings on the
[profile](#profile).

### Tutorial

The title screen offers a tutorial (`src/app/Tutorial.tsx`): a walk through
a sample game against the word BEACH, one step at a time, each with a
mocked-up game screen and numbered rings on the parts worth knowing. The
mock-ups are the game's own components with sample data, made inert, so they
look like the real screens. The steps: the goal (Dev Plan item 18's wording,
issue #83); making a guess (Enter lighting up, the shuffle key, and that a
repeated guess is refused); reading a score; marking letters on Medium (the In
row and the keyboard); ⓘ definitions; the ☰ menu (difficulty, Check for
mistakes and Clear all highlights, Report an issue, Give up); Hard and Extreme;
the modes (two player against the computer or a friend, live or by the day,
and all four Rush kinds) and the profile; and unlocking modes as you play,
with a mock-up of a locked choice (Dev Plan item 13, issue #28). **Next** and
**Back** (or the arrow keys) move between steps; the box keeps one height
for every step, so they stay in place (Dev Plan item 14).

The last step has **Don't show the tutorial on the home page again**, then
**Play now** (single player's difficulty step; from the profile, the title
screen) or **Done**, filled and where **Next** was, so a quick tap through
the steps ends on the home page rather than in a game. The card's
**Hide** does the same at once. Hidden, the tutorial is still a link on the
title screen, and the profile's Help section has **Take the tutorial** and
**Show the tutorial on the home page**, which brings the card back (the
`showTutorial` setting).

### Reporting an issue

**Report an issue** is in every game's ☰ menu, on the title screen and in the
profile's Help section. It opens a form: the kind (**Something went wrong**,
**An idea or request**, **A word or definition**), a description, an
optional screenshot (the app shrinks it to a JPEG of at most 1600 pixels a
side) and, in a game, **Include this game**, which attaches its record so the
game can be replayed (a friend's game sends only your view of it, never its
ID, which would let anyone take an open invite). The form says reports go
privately to the game's developer, and that they carry your display name, the
browser and screen size, never your email (Dev Plan item 18l, issue #112;
item 18uc). Once sent, it thanks you; it doesn't link to the issue, which
players can't open.

The server (`worker/src/reports.ts`) keeps each report in D1 and files it as a
GitHub issue in the private archive repo (`GITHUB_REPO`, never this public
one, since a report can hold your word in a game still going), labelled `bug`, `enhancement` or `word-list`
and `from-app`, so they can be picked up later from one list. The issue reads
the same every time (`issueTitle` and `issueBody` in `src/game/report.ts`): a
title like `[Bug] The keyboard froze…`, then **What happened**,
**Screenshot**, **Where** (who it's from, as "From: Paul (signed in)" or
"(guest)", never a guest ID, email or friend code; screen, difficulty, app build, browser, viewport,
language, time and report ID) and the game record, folded away. Typed text
can't ping people or close issues (`@` and `#` are defanged). GitHub's API
can't attach images, so the screenshot is served by the worker
(`/api/reports/<id>/screenshot`, under a random ID) and shown in the issue.
The token (`GITHUB_TOKEN`, Issues: read and write on that repository only)
stays on the server; without it the report is kept and printed in the logs.
A device can send 5 reports an hour, an internet address 10 an hour (so
made-up guest IDs don't get round it; an IPv6 address counts by its /64,
one home's block; the address is kept hashed, and cleared at the next report
once it's an hour old), and everyone together 100 a day. A build
without a server, or a report the server can't take, says so and to try
again later, keeping what you typed. There is no fallback to GitHub's own
form (Dev Plan item 18uc): issues are off in this public repo, and a report
can hold game data.

### Sharing a result

A finished Daily Rush, a Solo Rush with a score, and a two player win
(against the computer or a friend, by finding their word) or a draw on a
last guess (either side of it), and a finished Rush with Friends have a **Share** button beside the result's other buttons. It opens the
device's share sheet; where there isn't one it's **Copy result**, which copies the text (and shows it, selected, if the browser won't copy).
The text is short and gives nothing away: never a word, a guess or the day's
theme (`src/app/shareText.ts`).

- **Daily Rush**: `Word Mastermind Daily Rush #2 · Hard`, a row of emoji (one
  per word), `41 guesses · 12th of 340 · better than 96%` (the place once the
  server has sent it) and `wordmastermind.app`. Day #1 is 1 October 2026, the
  first day in the calendar.
- **Solo Rush**: `Word Mastermind Solo Rush · Medium`, the emoji,
  `Score 11.3 · Expert level` and the address.
- **Two player vs. computer**, a win: `Word Mastermind`,
  `I beat the computer (Expert) in 9 guesses on Hard 🏆` and the address.
  The difficulty is the easiest you used in the game. A clutch draw (it
  found your word first and your final guess found its word) shares
  `Clutch! I tied the computer (Expert) with my last guess: 12 guesses on Hard 🔥`,
  and the other side of it (you found its word first and its final guess
  found yours) `Clutch! The computer (Expert) found the draw with its last
  guess: 12 guesses on Hard 🔥`. The guesses are always yours.
- **Two player vs. a friend**, a win by finding their word (not when they
  give up or run out of time): `Word Mastermind`,
  `I beat Sam in 9 guesses on Medium 🏆` (their name as the result shows it,
  and your difficulty at the end) and the address. A clutch draw shares
  `Clutch! I tied Sam with my last guess: 12 guesses on Hard 🔥`, and the
  other side `Clutch! Sam found the draw with their last guess: 12 guesses on Hard 🔥`.

- **Rush with Friends**, once it's over: `I came in 2nd place in Word
  Mastermind Rush with Friends!` (`I tied for 1st place…` on a tie), then a
  row per player, best first: their place, emoji, total guesses and name (a
  computer's with its strength), like `1st 🟩🟨🟩🟧 41 guesses Sam`, so the
  emoji line up, and the address. Competitive Rush shares the same, under its own name.

Each word's emoji is the computer strength its guesses match, as a Solo Rush
level is ranked: 🟩 under 10 guesses (Mastermind), 🟨 under 15 (Expert), 🟧 up
to 20 (Skilled), 🟥 more (Casual), and ⬛ for a word given up or not found.

### Version and release notes

The app's version, starting at 1.0.0, is at the bottom of the title screen
(**Version 1.0.0 · What's new**). A change players can see bumps it, 1.1.0
for a feature and 1.0.1 for a fix, with one-line notes in plain words
(`src/app/releases.ts`); other changes leave it alone. Each PR that bumps it
shows its notes in a **Release note** section for the owner to review.

- The first time a device reaches the title screen on a new version, a
  popup shows that version's notes only, with a mock-up of what a note is
  about where it helps (such as the How to play button). **Got it** or ×
  closes it, and it doesn't show again on that device.
- A device on its first visit gets no popup: it has nothing to catch up on.
- Tapping the version opens **What's new**: every version's notes, newest
  first, with **← Back** to the title screen.
- A report from Report an issue gives the version beside the build.
- **Getting the new version** (issue #136): a page left open (above all a
  Home Screen app on an iPhone, which comes back to the front without
  reloading) checks for a newer build on opening and each time it comes
  back, at most once a minute (each build writes `/version.json`). On the
  title screen it quietly reloads into it. Anywhere else, once the version
  number is newer, a bar says **A new version is ready – Update**; Update
  reloads back into the game (saved either way), and ✕ hides it until the
  next version. A build with the same version number (a change players
  don't see) waits for the title screen. A tab reloads for a given build
  only once, so a cache serving the old one can't make it reload again and
  again.

### Definitions

An ⓘ button sits before each guessed word. Tapping it shows the word's
definition under that line, and tapping it again hides it. The result screen
shows the secret word's definition. Being before the word keeps the button
clear of the letter bubbles, which Medium uses for marking.

Definitions come from [Open English WordNet](https://github.com/globalwordnet/english-wordnet)
(CC BY 4.0, so the app must credit it), extracted at build time by the
word-list ETL from a pinned edition. They ship with the app, loaded the first
time someone taps ⓘ, and never come from a third-party service at runtime.
Each word gets up to two short definitions; an inflected word (`plots`,
`dying`) is defined through its base word (`plot`, `die`). Words WordNet
doesn't cover show "No definition available". Every secret word has a
definition, as do about 70% of guess words. The data is built by the
word-list ETL (`wordlist/lists/definitions.json`, see
[`wordlist/README.md`](wordlist/README.md#definitions)); the credit is in the
menu.

### Profile

Built in [Dev Plan](#dev-plan) items 3a and 3b. Everything stays in this browser
unless you sign in: then it's kept with your account too and shared by every
device signed in to it (item 9a, see [Synced profile](#synced-profile)).

- **Profile icon:** header row 1 and the title screen, just left of ☰. Your
  initials in a letter bubble (the first letters of your first and last
  words, or one letter for a one-word name); the logo, cropped to the
  detective's head, until you set a name. Opening it
  mid-Rush pauses the stopwatch, as exiting to the menu does. In a live game
  against a friend, where the clock can't pause, it warns first on your turn.
- **Name:** a display name, 3 to 20 characters, not unique, defaulting to
  something like `Guest-4821`. Spaces are trimmed and collapsed; control and
  invisible characters are refused. The rule lives in `src/game/profile.ts` so
  the server can reuse it. Clearing your name goes back to the guest name. Names
  are shown to other players (the Daily Rush leaderboard, a friend's game),
  so a short profanity filter (`isOffensive`) refuses the obvious ones,
  including spelled out or with digits for letters.
- **Country:** stored as an ISO code (`US`, `GB`), or "prefer not to say".
- **Member since** date.
- **Sections:** analytics, achievements and game history.
- **Layout** (Dev Plan item 13): one long page made the lower sections
  tedious to reach, and game history grows without end, so the profile is a
  hub: the profile card, then a row per section (**Account**,
  **Friends**, **Stats**, **Achievements**, **Game history**, **Settings**,
  **Help**, **Your data**), each with a one-line summary (e.g. "Signed in
  with Google", "142 games", a count of new badges). A row opens its section
  as a subpage with **← Back to profile**; a reviewed game's **← Back to
  history** returns to the history subpage. Links into the profile open the
  right subpage: the badge toast opens **Achievements**, a friend's
  link **Friends**, and signing in (or **Open profile** where a mode needs an
  account) **Account**. The badge dot goes once you open **Achievements**,
  whose row on the hub carries the same dot and reads **2 new badges to
  see** (Dev Plan item 18, issue #86: the dot didn't say where it led). New
  badges are the only thing that shows it.
  Stats and achievements were one page until Dev Plan item 14 split them,
  since the 54 badges made it very long. Each subpage's title is its only
  heading (no label repeating it), and signed out the **Friends** row is left
  off, since **Account** already says to sign in to add friends (a friend's
  link still opens it). The subpages are in `src/app/profilePages.ts`.
- **Settings** move here from ☰: guess order and default difficulty now
  (guess order is set per difficulty, e.g. newest first on Hard and Extreme
  but oldest first on Medium; Easy has its own), and turn
  alerts for games against a friend (on or off for this device), and
  **Enter on the right** for the keyboard (this device only, since a phone
  and a computer can want different ones; Dev Plan item 18). The current game's difficulty stays in ☰.
  The title screen's difficulty step sets the default too, so the setting
  is called **Difficulty for new games** and says so (Dev Plan item 14).
- **Help:** **Show the tutorial on the home page** (see [Tutorial](#tutorial)),
  **Take the tutorial**, **How to play** and **Report an issue**.
- **Your data:** export and import a JSON backup, and **Reset profile**
  (confirmed first), which wipes local data. The backup holds the profile,
  settings, recent secret words and every finished game (not games in
  progress). Restoring adds its games to the ones already here (matched by
  ID, so nothing is duplicated), takes its name, country, settings and the
  earlier member-since date, and keeps this browser's device ID. The app asks the browser to keep
  its storage, but Safari may still clear a site after about 7 days without a
  visit, so the backup matters unless you're signed in (then the account keeps
  everything too). A restored backup's games go to the account when signed in.
  Signing in and out: see [Accounts](#accounts).
- **Storage:** games are kept in IndexedDB as records, each with a random ID
  (so uploading one twice keeps one) and a version number. The profile's
  device ID is the guest ID the server knows this browser by.
- **Account:** signing in with an email link or Google (see
  [Accounts](#accounts)).
- **One screen for any profile:** it shows your own profile with its extra
  controls, and later other players'. Friends (item 9a) see only your name so
  far.
- **Bio** (500 characters, plain text) comes when others can see profiles. **Photo upload** is dropped: moderating public images isn't worth
  it.

#### Analytics

Worked out from the saved records by a pure function (`src/game/stats.ts`),
never kept as counters. Tests measure it at 1,000 and 10,000 games in one
mode; if that's slow, a per-game summary is cached, which can always be
rebuilt from the records. (Replaying and computing 10,000 games takes about
0.3 s on a laptop, so there's no cache.) Only finished games count (won, lost, drawn or given
up); a game counts at the easiest difficulty used.

1. **Headline row:** rating (signed in: the [pool](#rating) you've played
   most, with its clock, and a line listing each pool's when there are
   several, marked provisional with "?"; otherwise **Sign in to get rated**
   or **No rated games yet**), games played, win % (over games with an
   opponent), total guesses.
2. **A card per mode you've played** (Single player, vs. Computer, Solo
   Rush, vs. a friend, Daily Rush, Rush with Friends; since Dev Plan item 14
   a mode you haven't played has no card, rather than one saying "No games
   yet"):
   - games played, and a **gave up** count;
   - **average guesses** to find a word, with its trend. Single-player games
     given up are left out of the average, with no penalty. vs. Computer
     counts the games where you found the word (wins and draws). Rush counts
     per word of each scored Rush, penalties included;
   - **best game**, linking to its record. Single player: fewest guesses ×
     the difficulty factor. vs. Computer or a friend: the win in fewest
     guesses, counting only wins where you found their word (not ones won
     because they gave up, ran out of time or left). Solo Rush: the lowest score. Daily Rush: the fewest guesses in
     all, as its leaderboard counts. Rush with Friends: your lowest score in
     the final standings, and how often you **finished first**. There's no overall best, since the modes' scores
     don't compare;
   - **fastest solve** (the shortest time from starting on a word to finding
     it; a Rush word's time leaves out pauses, and against an opponent only
     your own turns count);
   - modes with an opponent: **win %** with its trend, the wins–draws–losses
     count, and the current and best **win streak**. Giving up counts as a
     loss. vs. Computer has a row per strength. The headline's win % counts
     games against the computer and against friends.
3. **Games by difficulty.**
4. **Top 10 guesses** across all modes; a tie for 10th is cut alphabetically.
5. **Time played:** the time you spent playing. Single player: the game's
   start to its last move. Rush: the same, without its pauses. Against an
   opponent, only your turns (from the move before yours to your move), so a
   correspondence game played over days counts only your thinking time. In
   single player and against an opponent, a gap between moves counts at most
   5 minutes, so a game left open, or picked up again later, doesn't count
   the time away.

**Trends** compare the last 30 days with the 30 before, and are hidden with
fewer than 5 games in either. Win % moves in percentage points (`+5 pts`).
For average guesses, lower is better, so a drop shows green and a rise red.

#### Achievements

Badges, each a pure rule over the saved records (`src/game/achievements.ts`),
so the server can reuse them. Games played before profiles existed don't
count. Earning one shows a toast on the result screen (tap it to open the
profile) and a dot on the profile icon (and on the profile's **Achievements**
row, which it leads to) until you open **Achievements**, where it stands
out with a green, bold name and a **New** tag on that visit (issue #94). Only which badges were announced is remembered
(`src/app/badges.ts`), so a reloaded result screen doesn't announce one twice.

- **Design:** the shape shows the family (circle for difficulty, hexagon for
  Rush, shield for guess count) and the metal the tier (bronze, silver, gold,
  ruby). A tag at the top says **SOLO** or **VS CPU**. Every badge also names
  its tier in words, pips or a number, so it never relies on colour alone.
  Unearned badges are greyed out; earned ones show the date. They're inline
  SVG components (`src/app/Badge.tsx`), so the bundled font applies and
  nothing loads from outside. The approved drafts are in
  [`docs/badges/`](docs/badges/). Streaks (a rounded square, tagged STREAK or
  DAILY, with the count) and one-off feats (a scalloped seal: two level
  bubbles for Clutch) were added in the same style.
- **Rules agreed in Dev Plan item 13d** (the owner's badge sheet, 30
  September). "Solve a word" means you found the word you were guessing, in
  any mode: single player (a win), each word in any Rush, and in two player
  (vs. the computer or a friend) a game where you found their word, a win
  or a draw on your final guess. Easy counts; a word or game where you used
  **Suggest** still counts as a solve or a win, but never earns a
  few-guesses badge.
- **Difficulty (SOLO):** solve a word at Easy, Medium, Hard or Extreme or
  harder, in any mode. A game counts at the easiest difficulty used; a Rush
  word at the Rush's. A harder difficulty also awards the easier ones.
- **Beat each computer (VS CPU):** win against the Casual, Skilled, Expert
  or Mastermind computer at Easy, Medium, Hard or Extreme or harder: 16
  badges, circles in the difficulty's metal with the strength's pips (1–4).
  A harder difficulty also awards the easier ones, and a stronger computer
  the weaker ones, so beating Mastermind at Extreme earns all 16. A draw
  isn't a win.
- **Few guesses:** solve a word (SOLO) in 20 or fewer, 15 or fewer and 10 or
  fewer guesses, in any mode, and win against the computer (VS CPU) having
  made that few. A word solved in 8 guesses earns all three. Any difficulty;
  not with Suggest.
- **Rush level:** finish any Rush (Solo, Daily, with Friends, Competitive)
  at Casual, Skilled, Expert or Mastermind, from its score: average guesses
  per word × the difficulty factor (see [Scoring](#scoring)), under 10
  Mastermind, under 15 Expert, 20 or less Skilled, else Casual. A higher
  level also awards the ones below. The score is worked out from your own
  run alone, as in Solo Rush: a word given up, or left unsolved when a
  lobby's time runs out, counts as your worst solved word in that run plus
  10. It needs at least one word found and the Rush not given up.
- **Win streak:** win 3, 5 and 10 two-player games in a row (vs. the
  computer or a friend, in the order they ended; not the same opponent). A
  loss, draw or give-up ends it; single player and Rush games don't touch
  it.
- **Daily streak:** finish a game of any kind on 7, 30 and 100 consecutive
  local days.
- **Clutch:** tie a two player game with your last chance: your opponent
  went first and found your word, and your final guess found theirs.
- **Daily Rush:** a **top 10 finish** (scalloped seal tagged DAILY) on a
  day's final leaderboard for your difficulty. The runs are on the server,
  so the app keeps the final places the server sends
  (`src/app/dailyStorage.ts`) and passes them to `computeAchievements`; a
  new one shows the profile dot. A **top 10%** finish is built but behind
  the `dailyTopTenPercent` [launch switch](#launch-switches), off at 1.0
  until the Daily Rush regularly has more than 10 players (with fewer, even
  1st place isn't in the top 10%). Also a badge for finishing the day's set
  at each difficulty (Easy, Medium, Hard, Extreme; a harder one doesn't
  award the easier ones, since each is its own day's run), and a **Daily
  Rush streak** (finishing the day's set, before the day ends, on consecutive Daily Rush days, which change at midnight in New York) of 7, 30
  and 100, tagged DAILY RUSH.
- **Friends:** a **win against a friend** (a seal tagged FRIENDS, with two
  bubbles and VS), a **Rush with Friends win** (first in a lobby's final
  standings, with at least one other player, computers included; a seal
  marked 1st) and a **Competitive Rush win** (first against at least one
  other person, since only people are rated; tagged COMPETITIVE; not
  offered while Competitive Rush is switched off).
- **Unlocks (item 13):** one badge for each step in [Unlocking
  modes](#unlocking-modes): **Two player unlocked** (win a single player
  game), **Solo Rush unlocked** (win a two player game) and **Every Rush
  unlocked** (finish a Solo Rush with every word solved, none given up).
- **Achievement Hunter (item 13):** earn 25%, 50%, 75% and 100% of the
  other badges: a seal in bronze, silver, gold and ruby with the share,
  earned with the badge that takes you past it. It counts every badge
  offered except its own, Easy's included: 50 with 1.0's switches, so 13,
  25, 38 and 50. Badges
  earned by the server's games (which have their own result screens) show
  the profile dot when they reach the history.
- **Retired in item 13d:** Beat the Mastermind computer (now the
  Mastermind row of the VS CPU badges) and the four VS CPU difficulty
  badges for any strength (now one per strength).

#### Game history

- **Only games started since your profile was created are saved**, so games
  played before profiles existed never appear in the history or count
  towards stats or achievements.
- **The server's games:** games against a friend, Daily Rush, Rush with
  Friends and Competitive Rush are refereed and kept by the server. The app
  asks it for your finished ones (`GET /api/played`, `src/app/playedGames.ts`)
  on opening, on coming back to the page, and on returning to the title
  screen or profile, and saves each as a history entry from your side: a
  friend game's record with your seat, their name and your rating change;
  a Daily Rush's run and day; a lobby's run with everyone's final places
  (the others' guesses stay theirs). A guest gets their games by guest ID,
  an account every one of its guest IDs' games. The entry's ID is a hash of
  the server's, since a friend game's ID or a join code lets anyone in.
  Rows: **vs. Bob** with W/L/D (and a rated game's rating change); **Daily
  Rush** with your total guesses and final place once the day is over;
  **Rush with Friends** (or **Competitive Rush**) with your place, green
  when you finished first. Each opens its own screen to review.
- **Saved when a game ends,** in every mode. Solo and two-player records now
  hold their difficulty (with changes recorded as moves, as Rush does) and the
  computer's strength. Each history entry adds an ID, the mode, a version
  number and Medium's final letter marks (per word in a Rush), so a review
  looks as it did.
- **Rows,** newest first, loaded in pages: the opponent in bold on one line
  (**vs. Computer · Skilled**, cut short with … if needed; flags later), a
  rated game's rating and its change, your guess count (turns alternate, so the
  opponent's is the same), and a centred column with the difficulty chip and
  the date. The chip takes its difficulty badge's metal: Medium bronze, Hard
  silver, Extreme gold. The result shows as a coloured border plus a
  **W**, **L** or **D** label: green for a win, red for a loss, dark grey for
  a draw. Single player is green if solved, red if given up. A Rush has no
  win or loss, so its border takes its level's badge metal (bronze, silver,
  gold or ruby), drawn as the badges' metallic gradient so ruby never reads
  as a loss's flat red, with the level named beside the score. A Rush with no score
  (given up, or no word found) has a plain border and "No score". Rows are
  dated by the game's last move, and load 20 at a time (**Show more**).
- **Filters:** mode, result and difficulty (the easiest used). A Rush has no
  result, so a result filter leaves Rushes out. **Search** by word, matching
  secret words and guesses (yours and the computer's) that start with what
  you type. Search by player name and by date aren't built.
- **Review:** tapping a row opens that game's end-of-game screen, celebration
  included, with its guess lists and marks and a small **← Past game** tag
  in place of the profile button, which goes back to the history (Dev Plan
  item 18l made the old full-width banner this tag, issue #101); ☰ starts
  with the game's date, and how many times it used Suggest. Plus the usual
  controls. A review is
  read-only: marks can't be changed, and the ☰ difficulty and give-up are
  off. **Play again** (or **New game**) starts a new game of that mode with
  the reviewed game's strength and difficulty. If a game of that mode is in
  progress, it asks first, since the new game ends it unsaved.
- **CSV export** of the filtered list, one row per move, so it keeps
  everything the records hold. Each row repeats its game's details (ID, mode,
  start time, difficulty, strength, who went first, both words, the result)
  and then the move: its number, side, kind, word, score and time (ISO). Over
  20,000 rows (a few hundred games) it asks you to filter further. It's for
  spreadsheets; the JSON backup is for restoring. Any cell starting with `=`,
  `+`, `-` or `` gets a leading `'` so spreadsheets can't run it (nothing
  exported starts that way until player names exist). The columns
  (`src/app/historyCsv.ts`): `game_id, mode, started_at, difficulty` (the
  starting one), `scored_difficulty` (the easiest used), `strength, first,
  your_word, secret_words` (a Rush's four, space-separated), `result`
  (`won`, `lost`, `drawn` or `gave up`; a Rush's level or `no score`),
  `rush_score, move, side` (`you` or `computer`), `kind` (`guess`,
  `give-up`, `concede`, `difficulty`, `give-up-word`, `pause`, `resume`,
  `end`), `word_no` (Rush), `word` (the guess, or the new difficulty),
  `score` (0–5 or `win`) and `time`. Times are ISO 8601 in UTC.

#### Backlog

- Preset avatars (low priority).
- Country flags next to player names wherever they appear, as bundled SVGs
  (flag emoji don't render on Windows).
- Stepping through a reviewed game move by move (low priority).

### Accounts

Built in [Dev Plan](#dev-plan) item 6. Signing in is optional: everything
works as a guest, and signing in keeps your games and settings as they are.
An account adds games against a friend on any device, your profile, settings
and game history on every device ([Synced profile](#synced-profile)), and a
friends list ([Friends](#friends)).

- **Where:** the profile's **Account** section, when the app has a server.
- **Email link:** type your address and tap **Email me a link**. The email
  holds one sign-in link, which works once, for 15 minutes, in whichever
  browser opens it. An address gets at most 5 links an hour, a minute apart.
  The server sends them through [Resend](https://resend.com), from
  `signin@wordmastermind.app`; locally they're printed in the `wrangler dev`
  console instead. Opening the link asks **Sign in as ann@example.com?**
  (**Sign in** or **Not me**) before signing in, so a link someone made for
  their own account and sent you can't sign your device in to it unnoticed.
  It doesn't ask if this device is already signed in to that account. Signed
  in to another account, it adds "You'll be signed out of you@example.com on
  this device", and **Sign in** signs that account out (on the server too)
  before using the link, as **Sign out** does. While
  the server has no Resend key, the app hides the email box and offers
  Google only.
- **Google:** **Continue with Google** goes to Google's own sign-in page and
  comes back signed in. The app loads nothing from Google; the server does
  the OpenID Connect exchange (with PKCE) and asks only for your email.
  The sign-in it ends in works only on the device that started it, so a
  link someone made for their own account can't sign your device in to it.
- **One account per email:** signing in with Google and by email with the
  same address reaches the same account.
- **Upgrading a guest:** the first sign-in makes the account from this
  device's guest: the account's player ID is the guest ID, so every game the
  guest sent or accepted is the account's. Each device that signs in later
  joins its own guest ID to the account, so games it played as a guest come
  along too. From then on, a guest ID that belongs to an account only works
  with that account's session; it proves who you are.
- **Any device:** signed in, you play as your account, and your games
  against friends (from every device) appear on the title screen of each one
  signed in. Turn alerts reach every device of the account that turned them
  on.
- **Staying signed in:** the browser keeps a session token (never in a
  backup file). A session ends after 180 days without use, or on **Sign out**.
  The server stores only a hash of each token and link.
- **Signing out** ends this device's session and its turn alerts for the
  account. Its guest ID is the account's, so the device carries on as a new
  guest (a new device ID), and the account's games leave its list until you
  sign in again. Your name, settings and game history here stay; games
  finished while signed out stay on this device until you sign in again.
- **Deleting your account** (in the Account section, confirmed first) signs
  out every device, stops their turn alerts and forgets your email, synced
  profile and synced game history. Games
  already played stay in your friends' history, and your games and settings
  in each browser stay there. Each device's guest ID is a plain guest's
  again, so games it sent or accepted itself can still be played from it.
- **Privacy policy and terms:** `public/privacy.html` and `public/terms.html`
  (served at `/privacy` and `/terms`, styled by `public/legal.css`), linked
  from the Account section. Google's consent screen needs both. Keep the
  privacy policy in step with what the server stores.
- **Sign in with Apple** comes after the launch (Dev Plan item 12a).

### Synced profile

Built in [Dev Plan](#dev-plan) item 9a. Signed in, your profile and game
history are kept with your account as well as in each browser, so every
device signed in to it shows the same ones. Guests keep everything on their
device, as before.

- **Signing in** moves this browser's games to the account: each finished
  game goes up once (games are matched by their random ID, so none is
  duplicated), and the account's games from your other devices come down.
  Stats and achievements, worked out from the games, then match everywhere.
- **What syncs:** your name, guest name, country, member-since date (the
  earliest of your devices') and the settings that are yours rather than the
  device's: default difficulty, guess order per difficulty and **Show the
  tutorial on the home page**. The title screen's last choices, turn alerts
  and **Enter on the right** stay with each device.
- **The first sign-in on a device** takes the account's profile, filling a
  name or country the account hasn't set from this device. After that a
  change made on any device goes to the account within a couple of seconds,
  and each device picks up the account's when it opens the app or comes back
  to the page.
- **New games:** each game finished while signed in goes up as soon as it's
  saved; one finished offline goes up next time the server can be reached.
  Only finished games sync, never games in progress.
- **Signing out** keeps this browser's games, and stops syncing. Signing in to
  another account moves them to that one.
- The server checks every game it's sent the same way the app does (the record
  must replay to a finished game), and keeps it as the app's history entry
  (D1 `history_entries`); the profile is D1 `profiles`. Deleting the account
  deletes both. An account keeps at most about 20 MB of games (tens of
  thousands; `MAX_ACCOUNT_CHARS`), so one account can't fill the database;
  past it, new games stay on the device only.
- **The server's games** (against a friend, Daily Rush, Rush with Friends and
  Competitive Rush) aren't uploaded: the server keeps them already (`games`)
  and hands them to every device, as [Game history](#game-history) says, so
  a device can't send one that didn't happen.

### Friends

Built in [Dev Plan](#dev-plan) item 9a. Friends are accounts, so the list needs
you to be signed in; the profile's **Friends** section asks you to sign in
first.

- **Your invite link** (Dev Plan item 18, issue #84): a private link
  (`/?invite=…`, 16 random letters and digits) with **Copy link** and
  **Share** (or **Text it**). Whoever opens it is asked, once signed in,
  **Add Ann as a friend?** (**Add** or **No thanks**), and **Add** makes you
  friends at once, with no request for you to accept; you get a turn alert
  saying so. Asking first means a link passed off as something else, or
  left open on a shared computer, can't add anyone unasked.
  Opened signed out, the profile's **Friends** page asks them to sign in
  (the link is kept in the browser through
  Google's round trip, for a day at most, and forgotten on **Sign out**)
  and asks as above once they have.
  **Reset link** (asked first) makes a new one, so links already shared
  stop working; friends made stay friends. Removing a friend renews your
  link too, so one they still have can't make them your friend again. On iPhone a link opens in Safari, not
  the Home Screen app (iOS doesn't let a web app take its links), so a
  player who signed in only in the Home Screen app signs in once in Safari.
- **Your friend code:** 8 letters and digits (no 0, O, 1 or I), shown as
  `ABCD-2345`. The code is public: it finds you and shows your name, nothing
  else, never your account's ID or email. Links with it (`/?friend=…`, shared
  before 1.0) still open the profile with the code filled in.
- **Adding a friend by code:** type their code (any case, with or without the dash)
  and **Add friend**. That sends a request; you're friends once they **Accept**
  it (or add your code too). They can **Decline**, and you can **Cancel** a
  request still waiting. At most 200 friends and requests.
- **The list:** requests to answer first, then the controls for adding
  friends (by code, and your code and invite link), so a long list never
  pushes them out of reach (issue #147), then your friends by name, then the
  requests you sent. Each friend has **Challenge** and ✕ (remove, asked
  first); removing takes you off each other's lists. Names are your friends'
  synced profile names.
- **Challenge:** choose your secret word as for an invite link, pick your
  difficulty and the clock (live 15 / 10 / 5 minutes, or 1 or 3 days a
  guess), both starting from your defaults and set for this game only, and
  tick **Rated game** to make it [rated](#rating). Only that friend can accept it: it's
  on their title screen at once (**Ann challenges you**, marked **Your turn**),
  with a turn alert if they have them on. Your side shows **Challenge sent to
  Bob** instead of a link, with **Cancel challenge**. From then on it's a game
  against a friend like any other, and it expires after 24 hours the same way
  (an hour for a live game).
- **Rush with Friends:** in an open lobby, the host sees **Invite friends**,
  each with **Invite**. The invite shows on the friend's title screen (**Rush
  invites · Ann's Rush with Friends**) until they join, the lobby starts or
  closes, or a day passes, with a turn alert if they have them on. They still
  tap **Join** in the lobby.
- **Turn alerts** also tell you about a friend request, an accepted request,
  a challenge and a lobby invite; the first two open the friends list.
- The server keeps the list in D1 (`friends`, two rows per pair, and
  `lobby_invites`), with each account's code on `accounts.friend_code`.
  Deleting the account removes you from every list.

### Launch switches

Built in [Dev Plan](#dev-plan) item 13b. Some modes need more players than a
new game has, so they're built but switched off for the 1.0 launch, in one
list read by both the app and the worker: `FEATURES` in
`src/game/features.ts`. Turning one on is a one-line change there, and the
same merge ships it to both.

| Switch | At 1.0 | What's off |
|---|---|---|
| `randomOpponent` | Off | [Random opponent](#random-opponent): the choice under Two player, and the queue's routes |
| `ratingBoards` | Off | The rating boards (Live 15, 10 and 5 min, Correspondence, Competitive Rush) on the [Leaderboards](#leaderboards) page, and their route. The Daily Rush board stays |
| `competitiveRush` | Off | [Competitive Rush](#competitive-rush): the Rush kind, opening one on the server, and its badge |
| `suggest` | On | Easy's **Suggest** button and its routes (see [Easy](#easy)) |
| `dailyTopTenPercent` | Off | The Daily Rush **top 10%** badge (see [Achievements](#achievements)), until the Daily Rush regularly has more than 10 players |

A mode that's off is left off the title screen and the Leaderboards page
(a saved choice of it falls back to the default), the tutorial doesn't
mention it, its badge isn't offered (nor counted by Achievement Hunter),
and the worker refuses its routes with 404 `off`. Ratings themselves stay
on: a [rated challenge](#rating) between friends is still rated, and shows
in the profile.

## Word Lists

We maintain two lists, both lowercase, 5 letters, with no proper nouns:

- **Secret list:** words that can be a secret word (no repeated letters). The
  computer draws its secret words from here. It should favour reasonably common
  words so that the solo mode is fair.
- **Guess list:** every accepted guess, repeated letters allowed. It is a
  superset of the secret list.

A human's secret word must be on the secret list. A guess must be on the guess
list.

Both lists are built from [ESDB](https://github.com/en-wl/wordlist)
(formerly SCOWL, built mainly from 12dicts) by an ETL script, at an upstream commit
we pin and never refresh automatically. A hand-maintained ban list removes
offensive words. See [`wordlist/README.md`](wordlist/README.md).

The current lists (2,231 secret words and 8,672 guess words) are the agreed
baseline:

- **Secret words** are common words (ESDB size ≤ 35) in any conversational
  form: base words, plurals, "-s" verbs, past tenses, "-ing" forms,
  comparatives and superlatives (`caves`, `hates`, `liked`, `dying`, `wider`).
  Forms that exist but aren't conversational (`balds`, `bayed`, `apter`) are
  excluded by hand and stay valid guesses.
- **Guess words** are any valid word up to ESDB size 80, including British and
  Canadian spellings.
- **Offensive words** are banned from both lists.

## Tech Stack (Confirmed)

The aim is to stay lean: a static web app first, with a backend added only when
PvP needs one.

- **Language/build:** TypeScript + [Vite](https://vitejs.dev/). Fast dev
  server, tiny static build output, no framework lock-in.
- **UI:** [Preact](https://preactjs.com/) (~4 KB, React-compatible API).
  Plain TypeScript would also work, but a small component library keeps the
  guess history and letter board manageable as modes grow.
- **Game logic:** a pure TypeScript module (word validation, scoring, computer
  player) with no UI dependencies, shared with the backend, which referees
  every mode played with other people.
- **Word lists:** static files bundled with the app. No backend needed.
- **Tests:** [Vitest](https://vitest.dev/) for the game logic, the app and
  the worker.
- **Hosting:** static hosting on **Cloudflare Pages** (or GitHub Pages).
  Free, global CDN, deploys on push.
- **Backend:** Cloudflare only (see [Backend plan](#backend-plan)).
  Supabase was considered and ruled out: its main advantage, ready-made login,
  doesn't outweigh how well Durable Objects fit per-game state and clocks.

**Computer player approach:** guess from the secret-list words consistent
with the responses it recalls; strength is set by how many it recalls (see
[Computer strength](#computer-strength)).

### Backend plan

The backend came with PvP (Dev Plan item 4 on), and everything runs on
Cloudflare:

- **Pages** serves the static site, as it does now.
- **Workers** serve the API.
- **Durable Objects:** one per game, one per matchmaking queue, one per
  Rush with Friends or Competitive Rush lobby, and one per day's Daily Rush. Each is the referee. It holds the secret words, scores guesses
  with the shared `src/game/` code, and never sends a player the opponent's
  word. Its alarms enforce correspondence turn times, and it keeps live clocks
  and WebSocket connections.
- **D1** (SQLite) stores accounts, game history, synced profiles, friends,
  leaderboards and ratings.
- **Sign-in** is the worker's own (see [Accounts](#accounts)): Google
  through OpenID Connect, and an emailed link sent by Resend. Sign in with
  Apple needs a paid Apple Developer Program membership ($99 a year) with any
  backend, so it comes after the launch (Dev Plan item 12a).

What needs the backend:

| Feature | Without a backend |
|---|---|
| Accounts and login | Not possible |
| Profile, history, achievements, analytics | Local-only for single player, vs. computer and Solo Rush; syncing and anything others see need the server |
| Friends list | Not possible |
| PvP (correspondence or live) | Not possible |
| Rating | A local rating vs. the computer only |
| Daily Rush, Rush with Friends, Competitive Rush | Not possible (Solo Rush is fine) |

### Rating

Built in [Dev Plan](#dev-plan) item 10. **Glicko-2** rather than plain Elo,
since it copes with players who have few games: each rating comes with a
**rating deviation** (RD, how sure it is) and a **volatility** (how erratic
the player is). Uncertain ratings move more, and an uncertain opponent counts
for less. The code is `src/game/rating.ts`, a pure function tested against
the worked example in Glickman's paper; the worker applies it
(`worker/src/ratings.ts`, D1 `ratings` and `rated_games`).

- **Who:** signed-in players only ([Accounts](#accounts)); a rating needs a
  lasting identity. A guest can still play unrated games by invite link.
- **Which games:** only results the server recorded, from **rated games**: a
  challenge from the friends list marked **Rated game** (the friend sees
  "Ann challenges you to a rated game" before accepting), every matched
  game, and every [Competitive Rush](#competitive-rush) with at least two
  people in it. Invite links and unmarked challenges are unrated.
- **Pools:** one rating per live clock (**15 min**, **10 min**, **5 min**)
  and one for **correspondence** (1 and 3 days per guess together), as chess
  sites rate blitz and rapid apart, and one for **Competitive Rush**.
- **Scores:** a win is 1, a loss 0; giving up and running out of time
  lose. A **draw** in a two player game changes neither player's rating
  nor volatility (issues #131 and #153), but it still counts as a game
  played: toward being listed on the boards, and it makes the rating more
  certain (RD narrows as for any game).
- **Competitive Rush:** each pair of people in the game is a result by
  their final places (a better place wins, a shared place draws), all in
  the one rating period (`rateGroup` in `src/game/rating.ts`). Computers
  don't count, so a Rush against computers alone is unrated. The result
  panel shows your change once the Rush is over.
- **Rating periods:** each game is its own period, rated the moment it ends.
  Time away counts as one empty period per whole week since your last rated
  game in that pool, widening RD (never past a new player's 350), so a
  returning player's first games move them more.
- **Starting values:** 1500, RD 350, volatility 0.06, with τ = 0.5. A rating
  is **provisional**, shown with a "?" (`1512?`), while RD is over 110, as on
  Lichess. All four are to tune once there's real data.
- **Difficulty:** fixed for the whole of a rated game (☰ shows it greyed,
  "It's fixed in a rated game"; the server refuses a change), and never part
  of the rating itself.
- **Showing it:** a rated game shows the opponent's rating beside their name
  in the header (`You vs. Ann (1512?)`), and the result panel shows your
  change (`Rating 1500? → 1662? (+162)`). The profile's
  [analytics](#analytics) headline shows your ratings. `GET /api/ratings`
  lists them. Each pool has its own board on the [Leaderboards](#leaderboards)
  page.
- The wipe script (`npm run wipe`) empties `ratings` and `rated_games` with
  the game history.

## Dev Plan

The build order is in [`docs/dev-plan.md`](docs/dev-plan.md): each
numbered item is one PR. Items still to build come first, in build order
(the first is next), then finished items, latest first.

## Open Questions

- **Share text:** a shareable result (e.g. mode, difficulty, guess count and
  scores) is wanted; the format is still to be decided.

- **Difficulty factors:** Easy ×1.2, Hard ×0.9 and Extreme ×0.8 are a
  starting guess, to tune from playtesting (see [Scoring](#scoring)).
- **Difficulty in PvP:** each player can play at a different difficulty. It
  never affects who wins. In a [rated](#rating) game it's fixed, and the
  matchmaking queue pairs players at the same difficulty, so it stays out of
  the rating itself; whether it should count after all is to discuss.
- **Rush with Friends durations:** the defaults (Medium 30, Hard 40, Extreme
  50 minutes) and the range the host can pick from, to tune from play.
- **Daily Rush after the last theme** (30 April 2028): start again from the
  first, reshuffle, or write new themes.
- **Checking unlocks on the server:** the unlocks come from records kept on
  the device, so the worker can't yet refuse Daily Rush to a guest who
  hasn't earned it. Signed in, history is synced (item 9a), so it could check
  the server's copy, but single player and Solo Rush games are played
  locally and could be faked. To decide how far to go.
- **Shuffled order still leaks the set:** with the day's 4 words posted, a
  player can try each in turn and solve every word in at most 4 guesses.
  Daily Rush themes have exactly 4 words, so drawing different words per
  player isn't possible without bigger themes. To discuss.
- **Leaderboards by country:** the profile has a country, so a board could
  be filtered by it. Later, if wanted.
