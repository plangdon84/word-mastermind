# Dev Plan

Moved out of the [README](../README.md) so it's quick to reach. Game rules
and decisions stay in the README, which this plan links to.

Each numbered item is **one PR**, and its bullets are the commits. Items
still to build come first, in build order, so "the next PR in the dev plan"
means the first one under **To build**. Tick it in the same PR and move it
to the top of **Done**, which lists finished items latest first. Item
numbers never shift, since other sections refer to them: a new item takes a
letter (like 13b). Every PR can ship on its own.

Issues live in the private archive, `plangdon84/word-mastermind-archive`
(issues are off in this public repo, since a report can hold game data).
Items cite them in full, or as `Issue N` inside an item; a bare `#N`
written before 8 October 2026 is an archive issue too. `/triage-issues`
plans them here and closes the ones a merged PR fixed.

## To build

Open GitHub issues were triaged with the owner on 2 October 2026, in two
rounds, again on 4 October 2026, on 7 October 2026, and on 8 October 2026
in the archive (each issue has its severity and the decisions as a comment).

**Next, in this order** (reordered with the owner on 3 October 2026:
18h, 18i, 18b, 18o, 18c and 18d moved ahead of 18m, and 18h built
before 18l; on 4 October 2026, 18q to 18t, from that day's issues, went
first; on 7 October 2026, ordered by value in as few PRs as make sense:
18u first, since CI is out of free minutes, then that day's issues folded
into 18q, 18s and 18t where they fit, and new items 18v to 18z and 7b;
later that day, 18ub went first, since the browser tests passed CI's 30-minute
limit; on 8 October 2026, 18ud went first: small fixes players hit now,
and 7b moved after 18d, ahead of 18m; then 18za, a new title screen agreed
from a mock-up, went before 18z)

- [ ] **18c. Friends' profiles** (issues #64 and #155; server and privacy,
  review gate)
  - Tap a friend's name (friends list, games, boards) to see their name,
    country, achievements, stats and their whole game history as they see
    it, opponents' names and reviews included; nothing else of their
    profile (settings, email, friends list). Signed-in players only, and
    only your friends
  - #155: their stats page also shows your record against them (wins,
    draws and losses, by mode), built from your own games
- [ ] **18d. Finding friends** (issues #79 and #78; server and privacy,
  review gate)
  - Type a friend's email to send them a request, without ever saying
    whether they have an account ("If they play, they'll get your
    request")
  - Search players by name (name and country shown, so you can pick the
    right one) and send a request
  - A **Share** button for your invite link (Messages, WhatsApp and so
    on). A phone's contacts and social accounts are left out (a web app
    can't read an iPhone's contacts)
  - Once Random opponent is switched on: add your opponent as a friend
    during or after the game (#78)
- [ ] **7b. Daily Word** (issue #159; worker, review gate; changes README
  "Daily Rush" and "Leaderboards", and adds a "Daily Word" section)
  - One word a day, the same for everyone, picked from the secret list
    (not themed), played once, at a difficulty you choose once, changing
    at the same time as Daily Rush (18y)
  - Its own board per difficulty, by fewest guesses, time breaking ties,
    on the Leaderboards page beside Daily Set, with place and "better
    than X%" (as 18x); Leaderboards then lists the two boards
  - Its row on 18za's Daily card (greyed once played, "Your place ›"
    opening its result), a streak badge and a Share button like Daily
    Set's; unlocked with Daily Set
  - A minor release with its notes
- [ ] **18m. Usage dashboard** (issue #103; worker, review gate)
  - A page at a hidden address (`wordmastermind.app/admin`, not linked in
    the game), kept out of 18j's sitemap and footers and sent with
    `X-Robots-Tag: noindex` (`public/_headers`), never named in
    `robots.txt`, which anyone can read; if it needs a Pages Function, it
    goes in 18j's `public/_routes.json`. Behind Cloudflare Access:
    Cloudflare asks for an allowed email and sends a one-time code before
    the page loads (free for up to 50 people). The worker's figures route checks Access's signed
    token itself too, so it can't be reached around Access. The PR lists
    the owner's setup steps in the Cloudflare dashboard
  - It counts only what the server already has, collecting nothing new:
    players (guests and accounts), new and active players per day, week
    and month, games per mode (online games and signed-in players' synced
    games), Daily Rush entries per day and difficulty, and players by the
    country they chose in their profile. Guests' offline games aren't
    counted, and the page says so
  - Totals only: never a player's ID, name or email. Charts drawn by the
    page itself (no third-party scripts). The layout is settled in the
    PR's **Decisions needed before review**
- [ ] **18n. Switching accounts by an emailed link** (issue #109; sign-in,
  review gate)
  - Signed in and opening another account's link, **Sign in** on "Sign in
    as …?" uses the link first, as a new guest, and signs the old account
    out only once that works; if the link fails (expired or offline), you
    stay signed in to the old account and see why
- [ ] **18e. Test personas on preview builds** (issue #56; testing only,
  never on the real site)
  - Persona backups made by a script from real game records (new player,
    everything unlocked, badge collector, a veteran with thousands of
    games), checked by a test, with a picker in preview builds' profiles,
    shown only when signed out
- [ ] **17d. Faster first load of a long history** (from item 17)
  - With 5,000 games, opening the app takes about 2 seconds on a slow phone
    to replay every game (each profile page is then under 1); keep each
    game's summary with it instead, so the history isn't replayed in full
- [ ] **17c. Two player and Solo Rush in two tabs** (from item 17)
  - With the same game open in two tabs, a move in one is lost when the
    other saves (item 17 fixed it for single player). Harder here: the
    computer's moves and the Rush clock's pauses run in each tab, so one
    tab has to lead
- [ ] **18p. A shorter title screen footer** (agreed with the owner on 2
  October 2026; app only, no review gate)
  - The links under Leaderboards become one wrapped row of small print:
    How to play · Full rules · Strategy · Jotto and Wordle · Privacy ·
    Terms · Version, with Report an issue and the Tutorial link kept as
    they are, so the bottom of the screen takes about two rows less on a
    phone
  - Every static page keeps a link from the title screen (18j's SEO), and
    Privacy stays there, since Google's sign-in approval checks the
    homepage links to the privacy policy
  - Each link stays a full tap target; the version still opens What's new
    (18g). A change players see, so it bumps the version (1.0.1) with its
    release note

**Later** (when their cost is worth it)

- [ ] **12a. Sign in with Apple** (needs the $99-a-year Apple Developer
  Program membership)
- [ ] **Competitive Rush shared places** (issue
  plangdon84/word-mastermind-archive#187; when Competitive Rush is
  switched back on): decide with the owner whether players sharing a place
  leave each other's ratings alone, like a rated two player draw, and
  record it in README "Rating"

Marketing that isn't a PR (agreed with the owner on 2 October 2026): once
18j and 18k are live, the owner posts the game to Reddit (r/WebGames,
r/wordgames, r/puzzles), Hacker News (Show HN), Product Hunt, IndieHackers
and itch.io (a free page linking to the site), and tracks new players and
Daily Rush entries per week from D1. Only if those bring players: a small
paid test (about $50 of Reddit or Google ads) and a Google Play listing as
a Trusted Web Activity ($25 once); the iOS App Store ($99 a year) waits.

## Done, latest first

**Phase D: after the launch**

- [x] **18z. Rush and Crush** (Issue 167; worker, review gate; changes
  README "Rush modes", "Scoring", "Daily Rush", "Leaderboards" and
  "Achievements"; after 18za, whose title screen it builds on)
  - Players read "Rush" as a race, so: **Rush** ranks by fastest total time
    (fewer guesses break ties), and **Crush** is today's scoring, fewest
    guesses with time breaking ties. A word given up still adds its
    penalty to both time and guesses (README "Scoring")
  - Word Sets (18za): Solo picks Rush or Crush with a **Ranked by: Rush ·
    fastest / Crush · fewest** switch above the difficulty, remembering
    the last pick; in a lobby the host sets it with the lobby's settings.
    The games are named **Solo Rush**, **Solo Crush**, **Rush with
    Friends** and **Crush with Friends** in the header, history and
    badges. Past games stay as they were scored (Crush)
  - Daily Set: still played once a day, and each run goes on one board
    per difficulty with a **Rush · fastest / Crush · fewest** switch,
    opening on Crush the first time, then on your last pick, and keeping
    the day, difficulty and Everyone / Friends as you flip. The result
    shows both places, each opening the board at its side. Playing twice
    would give away the day's words
  - Badges and their labels follow the two names (a Rush level by time, a
    Crush level by guesses); badges already earned stay earned
  - Competitive (switched off at 1.0) gets the same choice when it's
    switched on. If the PR grows past a reviewable size, split it: Solo
    and lobbies first, then Daily
  - A minor release with its notes
  - Agreed with the owner on 8 October 2026: a Rush's word given up adds 2
    minutes (Crush's time, only a tiebreak, stays as it was); a Rush level
    by average time a word is under 2:00 Mastermind, under 3:00 Expert, up
    to 5:00 Skilled; the difficulty factor applies to a Rush's time too;
    built as one PR
- [x] **18za. A new title screen** (agreed with the owner on 8 October 2026
  from a clickable mock-up; UI only; changes README "Title screen",
  "Unlocking modes", "Tutorial" and "Achievements" wording)
  - Top to bottom: a **Daily** card, **Games in progress**, then
    **Practice**, **Two player** and **Word Sets**, then **Leaderboards**,
    How to play and Report an issue. The tagline goes, to save height
  - **Daily card:** one row per daily game, each with its own marker (4
    words, 1 word) and **Play**: Daily Set (today's Daily Rush, renamed;
    its theme on the row) and, once 7b ships, Daily Word. A played row
    is greyed but still a button, with a line that isn't greyed ("Your
    places ›") opening that game's result, which links to its board. A
    new player sees both rows locked, saying how to unlock them. Daily
    leaves the Rush menu
  - **Games in progress:** one collapsible list for Continue, friend games
    (your turn first), Rush invites and lobbies. Open when something waits
    on you, closed otherwise; your own open or close holds until something
    new arrives. Its header counts the games and what's your turn, even
    closed. A Daily game in progress stays on the Daily card
  - **Practice** is Single player renamed (one word, no opponent), and
    only the name changes: it counts toward stats, badges and the first
    unlock as before ("Win a Practice game"), and saved data keeps its
    mode, so old games and backups load. **Two player** is one-word games
    against the computer, a friend or (once switched on) a random
    opponent. **Word Sets** is Rush renamed: Solo and With friends
    (Competitive once switched on), not Daily
  - The tutorial's steps, the static How to play page and the browser
    tests' screens follow; a minor release with its notes
- [x] **18o. New badges: beating a friend at a harder level, and
  Clairvoyant** (issues #104 and #141; app only: a friend game's record
  holds both players' levels; changes README "Achievements")
  - **Two badges**: win a game against a friend (by link or challenge,
    rated or not; not the computer, and a draw doesn't count) while you
    played at a harder level than them, and while you played two or more
    levels harder (Easy < Medium < Hard < Extreme; e.g. Extreme against
    Medium, or Hard against Easy)
  - Each player's level is the easiest they used at any point in the game,
    as scoring does, so switching levels mid-game can't earn it
  - #141: **Clairvoyant**: find a word with your first guess, in any mode
    (single player, vs. the computer or a friend, or any one word of a
    Rush). An opponent giving up before then doesn't count, and neither
    does a first guess picked by Suggest (as for the few-guesses badges)
  - Achievement Hunter counts the new badges, but a Hunter badge already
    reached stays earned: the new badges count only toward Hunter levels
    not yet reached (as 13c did for Easy's)
  - A minor release with its notes
- [x] **18y. Daily Rush: New York's midnight, late finishes and a pause**
  (issues #166, #160, #161 and #170; worker, review gate; changes README
  "Daily Rush")
  - #166: the day changes at midnight New York time (it follows daylight
    saving: 4:00 or 5:00 UTC), for Daily Rush and its calendar, boards,
    streaks and badges. On the switch-over day, that day's puzzle runs a
    few hours longer. Past days keep their results (owner, 8 October 2026:
    the 8th runs to New York's midnight, so Friday 9 October's set starts
    then)
  - #160: a run still going when the day changes can be finished, but it
    isn't counted for the board or the streak, and the end says "You
    finished after the day changed, so this one isn't on the board"
  - #161: with 5 minutes or less of the day left, the Daily Rush screen
    warns "5 minutes left to finish for today's board", and the start
    screen warns too before you begin
  - #170: a **Pause** button stops your time and covers the board until
    you come back. The server records each pause and resume as moves, so
    the record still replays
  - A minor release with its notes
- [x] **18ud. Small screen fixes** (issues
  plangdon84/word-mastermind-archive#194,
  plangdon84/word-mastermind-archive#191 and
  plangdon84/word-mastermind-archive#182; app only, no review gate)
  - Issue 194: at Extreme, the latest guessed word and its score are
    pinned at the top of the guess area, and only the score list below it
    scrolls, so the word never scrolls out of view. The header and tabs
    are unchanged, and newest-first order stays a profile setting
  - Issue 191: on a challenge from the friends list, the difficulty and
    rating choices push the keyboard below the bottom of an iPhone screen.
    The whole keyboard fits at every phone size, with the settings more
    compact or scrolling above it; a browser test checks it
  - Issue 182: the stats headline's Rating stays inside its box at every
    phone size. 1-day and 3-day games share one Correspondence rating, so
    the tile's label reads **Corresp.** and the "Ratings:" line below keeps
    the full name
  - A patch release with its notes
- [x] **18uc. Reports only through the server** (agreed with the owner on
  8 October 2026, once issues were turned off in this repo; app only, no
  review gate)
  - A report the server can't take, or one from a build without a server,
    says to try again later and keeps what was typed; GitHub's own
    new-issue form (`newIssueUrl`) is gone
  - The form says reports go privately to the game's developer, and the
    thank-you no longer links to the issue, which players can't open; the
    privacy page says the same
  - This also settles the archive's Issue 195 (the **Include this game**
    box that did nothing on GitHub's form)

- [x] **18ua. Going public: the Daily Rush answers off GitHub** (agreed
  with the owner on 8 October 2026: the repo goes public so CI's minutes are
  free; worker, review gate)
  - The plan: this item
  - The worker reads each day's theme and words from D1 (`daily_themes`,
    kept by the wipe), never from files in the repo; tests, the browser
    tests and the load test use made-up test sets
  - `npm run daily-themes` loads the themes into a database from files kept
    outside this repo; the themes, calendar and their generator move to a
    private repo
  - The docs stop naming themes, their days or their words
  - The switch, with the owner: the themes go into staging's and
    production's databases before this merges (or Daily Rush has no theme),
    then the public repo starts from a clean copy (one commit, no history),
    and this one stays private as the archive, where reports are filed

- [x] **18x. Profile, stats and friends list fixes** (issues #162, #157,
  #174 and #147; app only, no review gate)
  - #162: **Best win** counts only games you won by finding their word, not
    ones won because they gave up, ran out of time or left
  - #157: Suggest already rules out the few-guesses badges (README
    "Achievements"), which is why that game's win in 10 didn't earn one.
    The game-over card says so when it happens ("Suggest used: no
    few-guesses badge"), and the badge's description says it too
  - #174: Daily Rush's "better than X%" leaves you out: (players − your
    place) ÷ (players − 1), so first place is 100%; alone on the board it
    shows no percentage, as now. Tied players share a place
  - #147: the friends list sits below the controls for adding friends, so
    they're reachable without scrolling past a long list
  - #152 (the app icon) was taken out: neither a green nor a grey icon
    worked for the owner, so the icon is unchanged and the issue stays open
  - A patch release with its notes
- [x] **18t. Rated draws, current names and rematch follow-ups** (issues
  #131, #153, #156, #133 and #119; worker, review gate; changes README
  "Rating" and "Two player vs. a friend")
  - #131 and #153: a draw in a rated game changes neither player's rating.
    It still counts as a game played (toward being listed on the boards,
    and it makes the rating more certain)
  - #156: a rating went down after a win. A win can't lower a Glicko-2
    rating, so find why: most likely other rated games (correspondence
    runs several at once) finished between this game's start and end, so
    the header's number at the start isn't the one this game began from;
    or a bug in which seat won. Fix a bug if there is one, and the
    game-over card shows this game's own change ("Rating 1512 → 1527,
    +15")
  - #133: friend games show each player's current name, in progress and
    finished, so a guest who signs in, or a player who changes their
    profile name, shows by their new name on the next look. Names still
    pass the profanity filter
  - #119: the last game's **Rematch sent →** notices a decline or expiry
    while you're on the screen, doesn't flash before **Rematch** while it
    loads, and the rare race where both players ask at once gives the
    second a rematch instead of "invite closed"
  - A minor release with its notes
- [x] **18ub. Browser tests in fewer CI minutes** (the owner's review of
  the browser-test strategy, 7 October 2026; CI only, nothing players see,
  no review gate). A run took about 28 minutes, twice a PR: 9 to 13 to
  install the browsers' system libraries from a slow Ubuntu mirror (1 on
  1 to 3 October), and 17 of tests, two thirds of it WebKit and four
  fifths the screens at every size. The owner chose options 1 and 2
  - Cache the system libraries' .deb files (about 126 MB, kept a month)
    beside the browsers, saved by `main` and read by PRs, so a run
    installs in about a minute
  - A PR marked ready runs the browser tests in Chromium only (all of
    them, the screens at every size included); `main`, and a run started
    by hand (Run workflow), add WebKit. A WebKit failure on `main` is
    fixed in a follow-up PR
  - CLAUDE.md and the test plan say so
- [x] **18w. Game screen fixes** (issues #172, #171, #154, #164, #175
  and #143; app only, no review gate)
  - #172: in light mode an unmarked letter is black on the guess list but
    white on the keyboard. The keyboard's unmarked keys match the bubbles
    (white on black, README "User Interface") in both themes
  - #171: How to play and the tutorial show the three marks as real
    bubbles (unmarked, **in** green, **out** grey) beside their words,
    instead of a sentence a new player read the wrong way round
  - #154: once you've found their word and they have their final guess,
    the keyboard and the five input circles are hidden; a line says
    "Waiting for their final guess"
  - #164: tapping ⓘ on the last guess scrolls the guess list so the
    definition shows
  - #175: on a wide screen, where both boards sit side by side, the two
    guess lists line up row for row (the extra line above one board is
    matched or moved)
  - #143: practice after a loss keeps the official count (the game's
    guesses), and when practice finds the word the closing message says
    both, e.g. "Found it after 4 practice guesses. The game counted 12
    guesses."
  - A patch release with its notes
- [x] **18s. Reported words** (issues #118, #126, #130, #173, #144, #145,
  #142 and #158; word list only, no review gate)
  - Real but uncommon words stay valid guesses (the guess list is meant to
    be broad); secret words must be common
  - Take emirs and uteri off the secret list (`secret-exclude.txt`); they
    stay valid guesses; the two Daily Rush themes that used them each take
    a new word
  - Ban "babby" (internet slang, #145 and #142) and "bints" (a slang
    insult) in `wordlist/rules/ban.txt`
  - Hand-written definitions (`wordlist/rules/definitions.txt`) for knurl,
    flams ("a drumbeat of a quiet grace note followed at once by a louder
    stroke") and any other reported guess word without one. Bunts (the
    baseball hit) and swale ("a low, marshy area") already have
    definitions and stay; swale's ⓘ most likely opened out of sight below
    a full guess list (#164, item 18w). Doled had none either and gets one
  - A patch release with its notes
  - (#134, Check for mistakes, moved to 18v on 7 October 2026)
- [x] **18v. Fair play: difficulty, checks and the computer** (issues
  #151, #149, #150, #134 and #165; app and the shared rules in
  `src/game/`, no worker code, no review gate; changes README "Difficulty
  Levels", "User Interface" and "Two player vs. computer")
  - #151: before your first guess you can pick any level; after it you can
    only step down to an easier one (e.g. Hard → Medium), never back up, so
    the level you and your opponent see is always the one the game counts
    at (scoring and badges already count the easiest used). In every mode;
    the engines refuse a harder level after the first guess, and old
    records still replay. Rated games stay fixed as now
  - #149 and #150: the difficulty bubble in the header is coloured like
    that level's badges, and tapping it opens the difficulty choices
    (harder levels shown greyed out once you've guessed). The ☰ menu keeps
    its difficulty row, so the tutorial's menu step stays right
  - #134: ☰ Highlights → **Check for mistakes** works once a game (once a
    word in a Rush), in every mode and at every level it's offered at,
    rated games included. The menu says "1 check left" until it's used,
    then greys it out. Counted by the app with the game in progress (it
    uses only what the player can see, so the server doesn't need to
    enforce it)
  - #165: every computer strength remembers any guess that scored 5 (an
    anagram of your word) and from then on guesses only anagrams of it.
    Then retune each strength's memory so they still average about 28 /
    18 / 12 / 7 guesses (`computer.test.ts`)
  - A feature players see: release 1.6.0 with its notes
- [x] **18r. Challenge settings and screen fixes** (issues #137, #127,
  #124, #135 and #128; app only, no review gate)
  - #137 and #127: challenging a friend from the friends list shows the
    difficulty and clock pickers (live 15 / 10 / 5 minutes or
    correspondence 1 or 3 days) on the challenge screen, starting from your
    defaults. They set this game only and don't change your defaults.
    Ticking **Rated game** while on Easy moves the difficulty to Medium,
    with a note, instead of refusing
  - #124: the opponent's rating in the header (e.g. "Ann (1512?)") is no
    longer cut off on a phone; it keeps the word "rating" (a number that
    goes up and down; "ranking" would read as a place like 3rd)
  - #135: a long finished game against a friend scrolls to its last line
    without the history being clipped
  - #128: the "Word Mastermind" home link in the header gets the app's icon
    beside it
  - A feature players see: release 1.5.0 with its notes
- [x] **18q. Getting the new version, and notification taps** (issues #136,
  #132, #169, #129 and #163; app only, no review gate; high: every fix
  waits on players getting it)
  - #136: each build writes its version to a small file the app checks when
    it comes back to the front (and on opening). If a newer version is out:
    on the title screen the app quietly reloads into it; mid-game a bar
    says **A new version is ready – Update** (the game is saved either
    way). Also find why the title screen's version line sometimes doesn't
    show on a home-screen app, and fix it
  - #132 and #169: tapping a turn alert on an iPhone home-screen app opens
    the app but not the game, including when the app is already open on
    another game or the profile. Reproduce it on a real iPhone (the service
    worker already sends the game's link, and the open app is asked to show
    it; iOS may not answer or not support the fallback) and make the tap
    open that game, lobby or friends list
  - #129: the opponent's Medium marks didn't show because their guesses
    carried none (most likely their app was older than 1.3.0, which #136
    fixes; or they turned off **Share my Medium marks**). The opponent's
    tab says so instead of showing a plain board: "Ann isn't sharing marks"
  - #163: a guest's single player screen flashed for several seconds after
    a guess, then showed an old finished game. Look for a reload loop
    (an update or service worker reloading the page over and over) or a
    sync replacing the game in progress, fix what's found, and add a
    browser test for it; if it can't be reproduced, the PR says what was
    ruled out
  - A fix players see: a patch release (e.g. 1.4.2) with its notes
- [x] **18u. CI within GitHub's free plan** (issues #168 and #148; CI and
  browser tests only, nothing players see, no review gate; high: CI is out
  of minutes and storage, which stops every other PR)
  - #168: the repo is private, so the free plan gives 2,000 minutes a
    month and 500 MB of storage, and the screenshot gallery (about 140 MB
    a run, kept 14 days) filled it. Keep the gallery, the Playwright report
    and the Lighthouse report only when a run fails, for 3 days
  - Run the browser tests in Playwright's ready-made container image, so
    the ~10-minute browser install is skipped; cache what's left to
    install. The browser tests and Lighthouse still run once a PR is marked
    ready and on `main`, never on drafts or docs-only changes. Built: the
    image ran WebKit about 3 times slower (7 more minutes a run), so the
    browsers are cached between runs instead
  - #148: fix the WebKit tests that fail at random (a different one each
    run), so runs aren't repeated: the keyboard tests wait for the title
    screen and poll the focus ring (`expect.poll`) instead of one read; the
    friend-game and screen tests wait on the real signal, found from each
    failure's trace, rather than longer timeouts. Never skip or quarantine
    a test
  - The PR says how many minutes a run takes before and after, and how
    many runs a month fit
- [x] **18b. Play on after a loss** (issue #61; app only, no review gate;
  README "Play on after a loss")
  - After losing a two player game (vs. the computer or a friend, rated
    or not), **Keep guessing** sits beside showing their word: you carry
    on on the same board with your guesses so far until you find it or
    give up
  - The extra guesses are practice, kept on this device only: they never
    change the game's record, result, history, rating or badges
- [x] **18i. The opponent's board by their difficulty** (issue #95; worker,
  review gate; changes README "Two player")
  - The opponent's tab shows the difficulty they play at, and marks to
    match: on Easy, the full marks the app deduces from their scores; on
    Medium, the marks they have made themselves (sent with each of their
    guesses, not live); on Hard and Extreme, no marks at all (today every
    difficulty shows their guesses' letters that are in your word, which
    tells you little)
  - Letters of your secret word the opponent has worked out (Easy) or
    marked in (Medium) turn green in your word at the top
  - Against the computer, its tab shows Easy's marks
  - A profile setting, **Share my Medium marks**, on by default, and a
    line in How to play and the friend game screen saying your opponent
    sees your Medium marks
- [x] **18l. Game-over card, unlock badge and reporter's name** (issues
  #101, #110 and #112; app only, no review gate: the worker uses the shared
  report format unchanged)
  - #101: the card with their word and its definition, shown when a two
    player game ends (vs. the computer or a friend, and in reviews), gets
    a × that folds it to one line (their word; tap to open it again). Their
    word has a red ring round its letters, so it reads as not your guess.
    A review's "past game" banner shrinks to a small **Past game** tag in
    the header row, leaving more room for the history
  - #110: the unlock badges (title-screen steps) put the padlock beside or
    above the text, never over it, in the badge toast, the profile and the
    title screen, following #94's fix in 18f
  - #112: a report's **Where** list in the GitHub issue gains "From:" with
    the reporter's display name and whether they're signed in or a guest
    (e.g. "From: Paul (signed in)"); the report form says the name is sent.
    Never their guest ID, email or friend code (README "Reporting an
    issue")
- [x] **18h. Rematch** (issues #96 and #78's rematch; worker, review gate)
  - After a game against a friend or a link opponent, **Rematch** replaces
    **New invite** as the main button: a challenge to that player only
    (signed in or a guest), with the same clock and difficulty. They
    accept or decline, both pick new words, and who goes first is random.
    **New invite** (a link anyone can use) moves to ☰
  - The challenged player sees it with their games waiting (and by turn
    alert); a declined or expired rematch says so to the sender
- [x] **18g. Version number and release notes** (issue #91; app only)
  - The version (starting 1.0.0) at the bottom of the title screen. A PR
    that changes what players see bumps it (1.1.0 for a feature, 1.0.1
    for a fix) and adds its notes; other PRs leave it alone
  - The first time a device opens the title screen on a new version, a
    popup shows only that version's changes (it may show pictures, such as
    the How to play button) and, once closed, doesn't show again
  - Tapping the version opens **What's new**: every version's notes as
    one-line bullets, newest first, with **← Back**
  - The PR template gains a **Release note** section, so the owner reviews
    each version's words in the PR
- [x] **18k. Share your result** (agreed with the owner on 2 October 2026;
  app only)
  - After Daily Rush, a **Share** button (the system share sheet, or Copy
    where there isn't one, as the invite link does) with a short,
    spoiler-free result: the day's number, difficulty, total guesses, your
    place (`placeText`) once known, a row of emoji for guesses per word,
    and `wordmastermind.app`. Never a word, a guess or the theme's answers
  - The same after a two player win (strength, difficulty and guesses) and
    a Solo Rush (its score and strength level)
  - The exact share texts and emoji are an owner decision, settled in the
    PR's **Decisions needed before review**
- [x] **18j. SEO basics** (agreed with the owner on 2 October 2026; app
  and static pages only, no review gate; before 18f's redirect on 1
  November 2026, so search engines learn the new address)
  - Link previews: Open Graph and Twitter card tags in `index.html` (title,
    description, `https://wordmastermind.app/`) and a 1200×630 preview
    image in `public/`, so a shared link shows a picture in Messages,
    WhatsApp and Discord
  - `public/robots.txt`, `public/sitemap.xml` and a canonical link to
    `wordmastermind.app`; preview builds and `word-mastermind.pages.dev`
    send `X-Robots-Tag: noindex`, so only the real address is listed
  - The old address's redirect becomes a permanent (301) one on the
    server (a Pages Function or a Cloudflare Bulk Redirect, keeping the
    rest of the link as 18f does), so its search ranking moves to the new
    address; 18f's popup and date stay as they are
  - Structured data (`WebApplication` / `VideoGame` JSON-LD) in
    `index.html`
  - Static pages search engines can read, built like `privacy.html` and
    linked from the title screen's footer: **How to play** (the README's
    rules and the `beach` / `bunny` example), **Strategy** (deducing
    letters from the scores) and **Jotto and Wordle** (how Word Mastermind
    relates to the classic Jotto and differs from Wordle), each in the
    sitemap and the browser tests' screens
  - The owner registers the site in Google Search Console and Bing
    Webmaster Tools (DNS verification, no script) and submits the sitemap;
    the PR lists the steps. Visits are counted with Cloudflare's own
    analytics, which the app doesn't load a script for
- [x] **12b. Sign-in by email in production** (built in item 6; worker
  and sign-in, review gate; high priority, moved up from **Later** on 2
  October 2026; after 18f, since it uses 18f's domain)
  - The game's domain, `wordmastermind.app`, verified in Resend (the domain
    is about $10 a year)
  - `EMAIL_FROM` in `wrangler.toml` and the `RESEND_API_KEY` worker secret
    (see `worker/README.md`)
  - Before it's on: an emailed link asks "Sign in as ann@example.com?"
    before signing in, so a link someone made for their own account and
    sent you can't sign your device in to it unnoticed (a Google sign-in is
    already tied to the device that started it; security review, item 15).
    The server's `POST /api/auth/link` says whose a link is without using
    it; **Not me** leaves the device as it was
- [x] **18f. The move to wordmastermind.app, and small fixes** (issues #92,
  #93, #94 and #90; app and word list only, no review gate)
  - #92 (high): on `word-mastermind.pages.dev` itself (never a preview), a
    popup on the title screen says the game has moved, links to
    `wordmastermind.app` and lists the steps: sign in here first so your
    games come with you (or, as a guest, export a backup here and import it
    there), open the new address, add it to your home screen, sign in and
    turn on turn alerts. It shows on each visit until **Done**. After a
    date the owner sets in the PR, the old address sends you straight to
    the new one
  - #93 (low): DARNS out of the secret list, plus a sweep of the secret
    list's other plurals and "-s" verbs for awkward ones, the candidates
    listed in the PR for the owner to approve (`secret-exclude.txt`; every
    one stays a valid guess)
  - #94 (low): locked title-screen tiles grey their lock and move it off
    the text, so the text reads first; new, unseen achievements stand out
    (green, bold name and a **New** tag until seen)
  - #90 (low): a quick test of a dark home-screen icon on an iPhone (a
    dark icon in the manifest and a transparent one); if iOS ignores both,
    the issue is closed as not possible for a web app yet. Tested on the
    preview with a test page offering a dark icon: on a Dark home screen, the
    App Store apps' icons turned dark and the web app's stayed light, so the
    issue was closed and the test pages removed before merging
- [x] **16b. Shared Rush screen parts** (no visible change; from item 16's
  review)
  - Solo Rush, Daily Rush and the lobby screens repeat the same game board
    (slots, history, keyboard, ☰ Highlights) and results list (a word per
    row, opening its guesses): share them as components
  - Split the largest modules along the way (`LobbyScreen.tsx`,
    `FriendScreen.tsx` and `components.tsx`, 670 to 920 lines each)
  - Preact 11 (a major version, out at the review) considered then, with
    the tutorial and every screen checked by eye: taken, every screen and
    tutorial step the same as on Preact 10, pixel for pixel
- [x] **17b. Tap targets of 44 px** (design; from item 17's test plan)
  - Bring the buttons the browser tests' gallery lists between 24 and
    44 px up to 44 (the difficulty switch, the history's letter bubbles,
    Back and Close, the smaller secondary buttons), with the owner's eye on
    the look, then raise the test's minimum to 44

**Phase C: 1.0 readiness** (after item 13, before the launch). Items 13c
and 13d came first, so the reviews and the test plan covered Easy and the
final achievement rules. Each review wrote up its findings and fixed what
it could in its own PR; anything larger became a new Dev Plan item.

- [x] **18. 1.0 launch**
  - Combine and close as many open GitHub issues as we can, those after
    launch moved to Phase D below:
    - Keyboard: Enter lights up once a word is typed (#74), a setting puts
      Enter on the right (#60), and a Shuffle key on Easy and Medium
      (rated games too) reorders the typed letters (#76)
    - Getting around: the "Word Mastermind" name top left goes home from
      any screen (#82), and a turn notification opens its game even when
      the app is already open (#87)
    - Guess lists number each guess before its ⓘ (#85), and a single
      player or vs. computer game you haven't guessed in yet (even if the
      computer has) can be cancelled without saving it (#67)
    - New players: the tutorial's new opening words (#83), the profile dot
      explained where it leads (#86), and sign-in and turn alerts offered
      up front (#81)
    - Friends: a private invite link (you can reset it) adds the friend in
      one tap; typing the public code still sends a request (#84)
    - The game's domain, `wordmastermind.app` (Cloudflare Registrar, the
      one item 12b uses): the app on it and the server on
      `api.wordmastermind.app`, so Google sign-in names the game instead of
      the developer's address (#77)
    - The home screen's tiles losing their left edge on iPhone (#80): the
      title screen scrolls, and its scroll area ends exactly at the tiles'
      borders, so Safari clips the left one; give it a few pixels of room
    - SLOPE stays out of the secret list (an ethnic slur too) and stays a
      valid guess; the issue is closed with that reason (#72)
  - Run item 17's manual checklist (`docs/manual-checklist.md`) on the
    staging preview, the load test against staging included, and fix or
    plan what it finds: done on iPhone, iPad and computers, with 17
    findings fixed (`docs/manual-checklist-findings.md`); Android and turn
    notifications (once staging has its own keys) still to run
  - The Daily Rush calendar starts on launch day (`holidays.json` and
    `npm run calendar`), and the launch switches are set as item 13b left
    them
- [x] **17. 1.0 build test plan** (beyond unit tests)
  - A written test plan for the 1.0 build, discussed and agreed first
    ([`docs/test-plan.md`](test-plan.md)), covering:
    - Boundary tests: word and name lengths, clock and timer edges (a move
      at the deadline, a day flipping at midnight UTC), the largest lobby,
      the longest game, empty and full histories
    - Edge cases: going offline and back, two tabs or devices at once,
      signing in or out mid-game, a returning page after a long sleep,
      old saved records and backups still replaying
    - Performance: bundle size and first load on a slow phone, a long
      history (thousands of games) in the profile and stats, the worker
      and Durable Objects under many players
    - Responsive layouts: every screen at a set of phone, tablet and
      desktop sizes, portrait and landscape, with large text and the
      on-screen keyboard open
    - Accessibility: keyboard use, screen reader labels, contrast
  - Decide what tools, code or skills the automated part needs (for
    example Playwright end-to-end tests against `npm run dev` and
    `wrangler dev`, screenshot comparisons per screen size, Lighthouse, a
    load test for the worker) and add them, running in CI where they can
  - A manual checklist for what can't be automated (real devices, push
    notifications, sign-in with Google, no double-tap zoom on the board on
    iOS Safari, issue #39)
- [x] **16. Whole-codebase review** (no visible change)
  - Built in chunks, so look across them: inconsistent names, patterns and
    error handling, duplicated code to share, dead code and deprecated APIs
    or dependencies, and modules that grew too large
  - Code comments: accurate, explaining why rather than what, none left
    stale
  - Documentation: README, `CLAUDE.md`, `worker/README.md` and
    `wordlist/README.md` checked against the code, trimmed and made
    consistent (planned wording updated to built where it's done)
  - An account with more than about 100 device IDs (a sign-in on each new
    browser, over years) would pass D1's 100-parameter limit in the
    queries that list its games (`listGames`, `/api/played`, Daily Rush
    places): look them up by account instead (security review, item 15)
  - Keep a running total of each account's synced history size, instead
    of adding up all its games on every upload (which also lets two
    uploads at once pass `MAX_ACCOUNT_CHARS` by a batch; item 15's review)
- [x] **15. Security review** (low risk, but checked)
  - Threat model: what an attacker could want (a leaderboard or rating they
    didn't earn, another player's words, account or guest takeover, the
    server's secrets, spam through reports, push or email) and how they
    would try, from the browser, the API and the WebSockets
  - Check every worker route and Durable Object for authorization (the
    right player, seat and account), input validation and size limits,
    rate limits, and replayed or forged moves; words and scores never
    trusted from the client
  - Tokens and credentials (session and sign-in tokens, guest IDs, friend
    game IDs, join codes, VAPID and GitHub keys): stored hashed, never
    logged, never in URLs or issue reports longer than needed; OAuth state
    and PKCE, CORS, cookies and redirects
  - The app: XSS through names, reports and definitions, a Content Security
    Policy and security headers on Pages, and `npm audit` for known
    vulnerabilities in dependencies
  - Git history scanned for committed secrets, and the Google OAuth
    client secret replaced on 28 September confirmed revoked
  - Fix what's found, with a test for each, and write up what was checked
    (`docs/security-review.md`)
- [x] **14. Streamline review** (design)
  - Walk every screen, the ☰ menu and the profile at phone and desktop
    widths through a design-principles lens (hierarchy, consistency, fewer
    taps and words, one way to do each thing, clear empty and error states)
    and list what could be streamlined, merged or cleaned up without losing
    a feature
  - Agree the list, then make the changes; the tutorial's steps and How to
    play follow
- [x] **13d. Achievement rules review** (before the 1.0 reviews)
  - Audit every badge's trigger in every mode, including the modes built
    after the badges (friend games, Daily Rush, lobbies): issue #65, the
    few-guesses badges not being earned in some modes, and any like it
  - Agree with the owner what each badge should take, including how Easy
    and Suggest count (for example, a game where Suggest was used not
    earning the few-guesses badges or Beat the Mastermind computer)
  - Tweak the rules in `src/game/achievements.ts`, with tests for each
    mode, and update README "Achievements"; badges are recomputed from
    saved games, so say in the PR which earned badges could change
- [x] **13c. Easy mode** (see [Easy](../README.md#easy))
  - `src/game/deduce.ts`: complete letter logic from the guesses and scores
    alone (a letter is in when every set of 5 different letters that fits
    every score contains it, out when none does; never the word list),
    sharing its search with `marksFitScores`, with tests
  - Easy as a difficulty: first in `DIFFICULTIES`, factor ×1.2, so it's the
    easiest for "scored at the easiest used"; Medium's screen with the app's
    marks after each guess, no tapping and no ☰ Highlights; its own guess
    order setting, Easy badges, and the title screen, profile, ☰ and
    tutorial offering it (no more "Coming later")
  - Easy in every mode but rated play: single player, vs. computer, Solo
    Rush, Daily Rush (its own board), Rush with Friends and unrated friend
    games; the worker accepts `easy` and a rated game refuses it (the queue
    and Competitive Rush leave it out for when they're switched back on)
  - Suggest behind a launch switch: fills the input with a word that fits,
    each a recorded move; both methods (fits every score and letters only)
    behind a flag for the owner's A/B test on the staging preview
  - After the A/B test: the losing method removed, the limit and the
    switch set as decided, and README updated, before the PR merges

**Phase B: backend** (see [Backend plan](../README.md#backend-plan))

- [x] **13b. 1.0 cleanup and launch scope** (from the retrospective of 29
  September; numbers no longer shift, so a new item takes a letter)
  - CI: a GitHub Actions workflow running `npm test`, `npm run typecheck`,
    `npm run build` and `npm run test:wordlist` on every PR; the failing
    Workers preview build fixed, or non-production builds turned off, so a
    red check always means something
  - Loose ends: #40 (the share text, as written there) done; #39
    (double-tap zoom on the board, back since PR #5) fixed and added to
    item 17's manual checklist. (PR #35's ideas and issues #28 and #29 went
    into item 13.)
  - README against the code: Open Questions answered by what shipped
    recorded as decided (rated challenges from the friends list; one rating
    pool per live clock) and removed; `compositeScore` gone from
    Development; Easy described as deferred everywhere; stale item numbers
    fixed
  - Launch switches: one feature-flag list read by the app and the worker.
    Off at 1.0: **Random opponent**, the **rating boards** (the Daily Rush
    board stays) and **Competitive Rush**. A mode that's off is left off
    the title screen and Leaderboards page, and the worker refuses its
    routes. Rated challenges between friends stay on
  - The matchmaking queue offers the live clocks only; correspondence
    stays a friend game until the queue works without an open page
  - Staging: preview deploys use the staging worker and D1, so testing
    never touches production data
- [x] **13. Profile overhaul, unlocking modes and shuffled Rush words** (see
  [Profile](../README.md#profile), [Unlocking modes](../README.md#unlocking-modes) and [Rush
  modes](../README.md#rush-modes))
  - The profile as a hub of section rows, each opening a subpage with
    **← Back to profile**, and every link into the profile opening the
    right subpage (see [Profile](../README.md#profile) "Layout"); the tutorial's steps
    follow
  - Games against a friend, Daily Rush and Rush with Friends join the
    profile's history (new history modes, synced like the rest), with their
    rows, filters and review screens
  - Their stats cards (see [Analytics](../README.md#analytics)) and achievements (see
    [Achievements](../README.md#achievements)): first win against a friend, a Rush with
    Friends win, Daily Rush at each difficulty and the Daily Rush streak
    (issue #29)
  - Achievement Hunter: 25%, 50%, 75% and 100% of all other badges (issue
    #29)
  - `src/game/unlocks.ts`: which modes are open, from the saved records
    (friend wins count, now that they're in the history), with tests
  - The title screen greys out and locks what isn't open, with how to unlock
    it; the tutorial, How to play and Leaderboards stay open
  - The three unlock badges, with a toast naming what was unlocked
  - Each player gets the shared Rush words in their own random order, picked
    by the server and kept in the run's record (Daily Rush, Rush with
    Friends and Competitive Rush)
  - The tutorial refreshed for everything added since it was written: Rush
    with Friends, playing a friend, the locked modes and how to unlock them
    (issue #28)
- [x] **11. Competitive Rush** (replaces tournaments)
  - Rush with Friends' lobby, with each player setting a word and solving
    the other 4; computers fill every empty seat with a random word
  - Rated with item 10's Glicko-2
  - The Competitive Rush rating board on the Leaderboards page
- [x] **9b. Leaderboards screen** (see [Leaderboards](../README.md#leaderboards))
  - **Leaderboards** on the title screen at all times, opening the
    Leaderboards page (← Back to the title screen) with a tile per board;
    Daily Rush and the four rating boards (item 10), Competitive Rush's
    tagged coming later
  - The Daily Rush board opens from there, and from **Leaderboard** on the
    Daily Rush screen before you've played; every board gets **← Back** to
    where it was opened from (replacing the Daily Rush board's Close)
  - The rating boards, one per [rating pool](../README.md#rating) (Live 15, 10 and 5
    minutes, and Correspondence) from item 10's D1 `ratings`: top 100, your
    place, provisional players hidden, ← Back
  - Everyone / Friends on every board, signed in
- [x] **10. Live PvP and rating**
  - Chess clocks (15, 10 or 5 minutes) over WebSockets
  - Glicko-2 as a pure function in `src/game/rating.ts`, applied to
    server-recorded results, with one rating per live clock and one for
    correspondence; a challenge between friends can be rated
  - Matchmaking queue, one per time control and difficulty, matching by
    rating
- [x] **9a. Synced profile and friends** (see [Synced profile](../README.md#synced-profile)
  and [Friends](../README.md#friends))
  - Local history moves to the server on sign-in
  - Friends list, and challenging a friend from it, or adding them to a
    Rush with Friends lobby
- [x] **8. Rush with Friends**
  - One Durable Object per lobby: join code, up to 5 players, one
    difficulty, and a duration defaulting by difficulty; the same 4
    server-picked words for everyone on one clock that never pauses
  - Computer players in empty seats, at the host's chosen strength, with
    the pace model in [Rush modes](../README.md#rush-modes)
  - Standings with the group penalty, provisional until everyone finishes
    or time is up, and Web Push when a player finishes and at the end
- [x] **7. Daily Rush** (reuses PR 2's run engine)
  - Rush becomes a choice of kind on the title screen; today's Rush is
    renamed **Solo Rush**
  - The theme calendar (each theme in `wordlist/themes/` linked to a date)
    and one Durable Object per day that serves the words and referees every
    guess; the themes never ship in the app
  - The Daily Rush screen: today's theme, difficulty chosen once, no pause,
    the countdown to the next set, once a day
  - Leaderboard per day and difficulty (total guesses, time breaks ties),
    with your position and percentile, past days, and the top 10 and top
    10% badges
- [x] **6. Accounts**
  - Email magic link and Google login
  - Upgrading a guest to an account
- [x] **5. Correspondence PvP with a friend** (no login needed)
  - One Durable Object per game as referee, and invite links
  - 1- and 3-day turn timers with automatic concede
  - Turn notifications (Web Push)
- [x] **4. Backend foundation** (nothing visible yet)
  - `worker/` folder beside `src/` (importing `src/game/`), Cloudflare config
    (wrangler) and D1 tables
  - Guest identity (an ID created on the device), and checking words on the
    server with the bundled word lists
  - An app-side game source with local and remote versions; today's modes use
    the local one
  - An admin script, outside the game, that wipes game history and
    leaderboards from D1 (it asks you to type the environment's name first).
    Each later PR that adds tables adds them to it

**Phase A: static site, no backend**

- [x] **3b. Stats and achievements**
  - `src/game/stats.ts`, timed at 1,000 and 10,000 games, and the analytics
    section
  - `src/game/achievements.ts`, the badge SVGs, the toast and the profile-icon
    dot
  - Feedback from 3a: text fields are 16px, since iOS zoomed the page in on a
    smaller one and stayed zoomed, making keyboard typos likelier; the name
    field hides its guest-name placeholder while you type
  - Feedback on 3b: time played against an opponent counts only your turns;
    top guesses stop at 10; history rows keep both players on one line and
    show one guess count; rows name only the opponent, the difficulty chip
    takes its badge's metal, and the right column is centred
- [x] **3a. Profile and game history** (see [Profile](../README.md#profile))
  - Game records gain difficulty and computer strength; finished games are
    saved to IndexedDB with an ID, mode, version and marks
  - Profile screen: the icon left of ☰, name, country, initials bubble,
    member since, settings moved from ☰, JSON backup and reset
  - Game history: rows, filters, word search, and the review screen with
    **← Back to history**
  - CSV export
- [x] **2. Rush**
  - `src/game/run.ts`: the multi-word run engine (words, timer, per-word
    results)
  - `src/game/scoring.ts`: the guess and composite formulas and the per-word
    penalty, with the [scoring](../README.md#scoring) example as tests
  - Rush screen and a title-screen entry
- [x] **1. Game-state refactor** (no visible change). The server will reuse
  `src/game/` unchanged.
  - Single player: game state can be saved and rebuilt by replaying its moves
  - The same for two player vs. computer
  - Time passed in as an argument, never read inside game logic, and a
    per-player view that hides the opponent's secret
