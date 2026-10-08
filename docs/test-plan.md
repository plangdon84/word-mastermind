# 1.0 test plan (Dev Plan item 17)

What we test before the 1.0 launch, beyond the unit tests, and how. Written
on 30 September 2026 for the owner to agree **before** any of the tooling is
built. Each numbered question at the end has a recommendation; answer by
number.

**Outcome:** the owner agreed every question as recommended on 1 October
2026, and the tools and tests were built in the same PR (#75). Each section
below now says what was built and what it found; **Found and fixed** and
**Left for later** at the end sum up.

Running it all:

```sh
npm test                 # unit tests, including the 1.0 saved-data fixtures
npm run e2e              # browser tests (Playwright): starts the local server and a test build itself
npm run check:size       # after npm run build: the download-size budget
npm run lighthouse       # after npm run build: Lighthouse's mobile scores
node e2e/worker.ts       # then, in another terminal: npm run load-test
```

In a cloud session, set `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
(or wherever its Chromium is) for `npm run e2e` and `CHROME_PATH` for
`npm run lighthouse`. A cloud session has no WebKit (its network can't reach
Playwright's downloads), so it runs `npm run e2e -- --project=chromium`. CI
runs everything but the load test on `main` and on every PR once it's
marked ready (drafts get only the quick checks), the browser tests in
Chromium only on a PR and in WebKit too on `main` (Dev Plan item 18ub). To fit
GitHub's free plan (500 MB of storage, issue #168), it keeps the screenshot
gallery and Playwright's report only when a test fails, for 3 days, and
prints each failing page's snapshot in the log; `npm run e2e` makes the
gallery locally (`e2e-gallery/index.html`).

## Where we start

- **Unit tests:** 678 tests in 71 files (Vitest), all passing, run on every
  PR by CI with the typecheck, the build and the word list tests. They
  already cover the game rules, the worker's routes and rooms (with
  stand-ins for D1 and Durable Objects), moves at a deadline, the Daily Rush
  day flip, a full 5-seat lobby, name length and history versions.
- **Nothing runs the real app in a browser.** No end-to-end tests, no
  screen-size checks, no accessibility checks, no size budget for what a
  phone downloads, and no load test of the server.
- **Download size today:** the app is 115 KB (gzipped script) plus 9 KB of
  styles and the fonts. The word definitions (212 KB) load only when you
  tap ⓘ.

## How each part is tested

Three layers, cheapest first. A case goes in the lowest layer that can
catch it.

1. **Unit tests (Vitest, existing):** anything about rules, time or data.
   Game logic never reads the clock, so edges like "a move at the last
   second" are exact and instant here, where a browser test would have to
   wait out a real 5-minute clock.
2. **Browser tests (new, Playwright):** the real app, built as it ships,
   talking to the real worker running locally (`wrangler dev`, with its
   local Durable Objects and database). Run in CI on every PR once it's
   marked ready (in Chromium; WebKit too on `main`).
3. **Manual checklist (new):** what needs a real phone or a real Google
   account, done by hand on the staging preview before launch.

## 1. Boundary tests

| Case | Layer | Built |
| --- | --- | --- |
| Words: 4, 5 and 6 letters, spaces round them, capitals, non-letters, a repeated letter in a secret | Unit + browser | Unit tests already; `modes.spec.ts` types a short word, an unknown one and a repeat, and none is played |
| Names: empty, 1 and 20 characters, 21, emoji, offensive | Unit + browser | Unit tests already; `edges.spec.ts` sees the profile refuse 21 characters and an offensive name, and keep 20 |
| A move exactly at a live clock's deadline, and one millisecond after | Unit | Already covered (`pvp`, `games`) |
| Correspondence: a guess at the end of day 1 or 3 | Unit | Added: a guess in the last millisecond of 1 or 3 days counts, and one at the deadline is refused |
| Daily Rush at midnight UTC: starting just before, finishing just after | Unit | Added: a run finished in the day's last millisecond counts (one a second after midnight was already refused) |
| The largest lobby: 5 seats, all people, all computers, and a mix | Unit + browser | Unit tests already; `modes.spec.ts` plays a lobby of 5 browsers to the end |
| The longest game: 200 guesses in single player and vs. computer, and a Rush word at 100 guesses | Unit + browser | Added: each saves, parses and replays, under the server's size limit for a synced game; the game screen with 200 guesses keeps the newest and the keyboard in view |
| Empty history: profile, stats, achievements and every list | Browser | Added: each says so, with no errors |
| Full history: 5,000 games, and an account at the sync size limit | Unit + browser | Under Performance; the size limit's unit tests were already there |

## 2. Edge cases

| Case | Layer | Built |
| --- | --- | --- |
| Going offline mid-game and back | Browser | Single player carries on offline and keeps its guesses; a friend game that was offline (and hidden) catches up on the move made meanwhile. Lobbies and Daily Rush use the same refresh on return as friend games, so they aren't repeated. Reloading while offline isn't offered at 1.0 (the service worker only handles notifications) |
| Two tabs on one device, same game | Browser | A friend game: a move in one tab shows in the other. Single player: **lost a guess** (the other tab saved over it); fixed, so the other tab now follows. Two player and Solo Rush have the same problem, which needs more than a small fix: Dev Plan item 17c |
| Two devices, one account | Browser | Two browsers signed in to one account: a game finished on one reaches the other's history |
| Signing in and out mid-game | Browser | Signing in (the emailed link, which the local server prints) keeps a single player game and a friend game going; signing out gives a new guest ID |
| A page returning after a long sleep | Browser + unit | The local server runs on the real clock, so a browser test can only move the page's clock: Solo Rush's stopwatch leaves out 3 hours away. What depends on the server's time (deadlines, the day flipping) is in the unit tests, where time is an argument |
| Old saved records and backups | Unit | Added: `src/app/fixtures/1.0/` holds a backup with a game of every mode and kind, and every localStorage key the app writes, as the 1.0 build writes them; `savedData.test.ts` loads each through the app's parsers and compares the replayed moves, stats, badges and unlocks with frozen snapshots. The browser tests restore that backup through the profile too |

## 3. Performance

| Case | Target | Result |
| --- | --- | --- |
| Download size | App script ≤ 140 KB gzipped (130 KB until Dev Plan item 18z, raised with the owner on 8 October 2026), styles ≤ 12 KB; definitions still load only on ⓘ | 112 KB and 8.5 KB at 1.0, 131.1 KB of script at 18z; `npm run check:size` in CI fails over budget |
| First load on a slow phone | Lighthouse mobile performance ≥ 90 | 98 (accessibility 93, best practices 100); `npm run lighthouse` in CI warns under 90, and `--strict` fails |
| A long history | 5,000 games on a slow phone's CPU: each profile page opens in under 1 second | Profile 0.35 s, stats 0.45 s, achievements 0.6–0.7 s, history 0.4–0.5 s. Opening the app reads and replays every game once first, which takes 2.1–2.2 s (the test fails past 4 s, a guard against it getting much worse); making it faster is Dev Plan item 17d. "A slow phone" is calibrated: the test times a fixed piece of work and slows the CPU until it takes 115 ms, so it means the same on a fast laptop (4×) and on GitHub's runners, which are about twice as slow (2×) |
| The server under many players | 100 friend games, 20 full lobbies and 1,000 Daily Rush players at once: no errors, moves answered in under 300 ms | Locally (`wrangler dev`): 1,320 players and about 10,400 moves, no errors. Local times aren't Cloudflare's (it runs every Durable Object in one process, and drops connections with all 1,320 at once, so the script keeps 64 requests in flight), so the 300 ms target is for the staging run, which is in the manual checklist: this session's network can't reach staging |

The rate limits count per internet address (30 new guests or games a
minute), so one machine can't start 500 players quickly. The load script
prepares its players slowly, then plays them all at once: playing is never
rate limited.

## 4. Responsive layouts

Every screen: the title screen and each setup step, single player, vs.
computer, Solo Rush, Daily Rush, a lobby, a friend game, the ☰ menu, How to
play, the tutorial, Report an issue, Leaderboards, and the profile hub with
each subpage.

Sizes: small phone 320 × 568, iPhone SE 375 × 667, iPhone 390 × 844,
Android 412 × 915, phone landscape 844 × 390, tablet 768 × 1024 in both
orientations, desktop 1280 × 800. Plus text at 200% and a short screen
standing in for the phone's keyboard being open (390 × 450).

What's checked automatically at each size: nothing wider than the screen
(no sideways scroll), nothing off screen, covered or cut off, and every
button at least 44 px to tap (since Dev Plan item 17b; a keyboard key or a
guess's letter bubble 44 px tall and at least 24 across, filling its row). Each run also saves a
screenshot of every screen at every size (`e2e-gallery/`, open its
`index.html`), for looking through by eye; CI keeps it as `screens-gallery`
only when a test fails.

**Built:** `e2e/screens.spec.ts`, 26 screens at the 10 sizes, in Chromium and
WebKit. "Text at 200%" is a desktop browser zoomed to 200% (640 × 400),
since the app sizes its text in pixels: what WCAG's resize-text rule asks.
A friend game and a lobby need other players, so `modes.spec.ts` checks
them with axe at the phone size.

**Changed from the plan:** 44 px for every button turned out to mean
restyling most screens: the difficulty switch, the letter bubbles in the
history, Back and Close, and the smaller secondary buttons are 25–38 px.
So the test fails under 24 px, and the gallery lists every button still
under 44 for Dev Plan item 17b, which brings them up to it with the
owner's eye on the look. Nothing was under 24 px but the stats page's
links (fixed), and every screen passed at every size otherwise. Item 17b
then raised the test to 44 px.

## 5. Accessibility

- **Automatic:** axe (the standard accessibility checker, installed with
  the tests, nothing online) on every screen above, in light and dark mode:
  labels for buttons and inputs, contrast to WCAG AA, headings and
  landmarks. No serious or critical findings allowed. It found five, all
  fixed (below).
- **Keyboard:** `keyboard.spec.ts` plays a whole single player game and a
  Solo Rush with the keyboard alone (Tab, Enter, Escape closes the menu),
  checking every control it stops on shows its focus.
- **Screen reader:** letter bubbles and marks read out as words ("E, in"),
  scores and "your turn" announced. Checked automatically for labels, and
  by hand with VoiceOver and TalkBack (manual list).

## 6. Tools to add

- **Playwright** (`@playwright/test`) with **axe** (`@axe-core/playwright`):
  tests in `e2e/`, `npm run e2e` locally, run in CI in Chromium (Chrome,
  Android) on every ready PR, and in WebKit (Safari's engine) too on
  `main`, at the sizes above.
- **A size check** and **Lighthouse** in CI. The plain `lighthouse` package,
  not Lighthouse CI (`@lhci/cli`), whose wrapper brings in packages with
  known vulnerabilities.
- **The saved-games folder** (`src/app/fixtures/1.0/`, beside the app's
  parsers it tests) and its replay test.
- **The load script** (`scripts/load-test.ts`), run by hand.
- All free and run on GitHub or this machine; nothing loads from a third
  party in the app.

## 7. Manual checklist (before launch, on staging)

Written out step by step in [`docs/manual-checklist.md`](manual-checklist.md),
to tick on real devices: no double-tap zoom on iOS Safari (issue #39), turn
notifications, Google sign-in, the phone's largest text and its keyboard,
VoiceOver and TalkBack, real friend games and lobbies, Report an issue,
sharing, installing, and the load test against staging. Item 18 runs it
before the launch.

## Found and fixed

- **Locked modes** were faded below a readable contrast; grey text now.
- **"Your turn" and the waiting messages** pulsed by fading the words to
  30%; now only the dot pulses.
- **Green text** (your turn, a win's score, "Yours", new badges) was just
  under WCAG AA on the page (4.48:1) and well under in dark mode (3.6:1); it
  has its own shade in each theme.
- **The letters marked in and the tutorial's step dots** had labels screen
  readers could skip; they read out now ("Letters marked in: none yet").
- **The stats page's best and fastest links** were 17 px tall; 24 now, as
  are the toggles.
- **Single player in two tabs** lost a guess when the other tab saved; the
  other tab follows now.
- **The profile's name hint** still said names would show "once online play
  arrives"; it says where they show.

## Left for later

New Dev Plan items, in the post-launch backlog unless the owner moves them:

- **17b. Tap targets of 44 px** (done): every button restyled to 44 px,
  and the test's minimum raised to match.
- **17c. Two player and Solo Rush in two tabs**: the same lost-move problem
  single player had, harder there since the computer's moves and the Rush
  clock's pauses run in each tab.
- **17d. Faster first load of a long history**: 2 s with 5,000 games on a
  slow phone, by keeping each game's summary rather than replaying every
  game when the app opens.

## Questions for the owner

1. **Screenshots: layout checks plus a gallery, or picture comparisons?**
   Picture-by-picture comparison fails on every intended design change and
   on font rendering differences, and someone has to approve new pictures
   each time. **Recommend** the automatic layout checks above plus a
   gallery of screenshots on each CI run to look through.
2. **Browsers in CI: Chromium and WebKit.** Firefox adds little for a
   phone game; real iOS Safari can't run in CI, so it stays in the manual
   list. **Recommend** Chromium and WebKit.
3. **Browser tests on every PR.** They add about 5 to 8 minutes to each
   PR's checks. If the repository is private, that counts against GitHub's
   2,000 free minutes a month (around 150 PRs). **Recommend** every PR.
   **Changed 2 October:** each review fix re-ran them, so they now run once
   a PR is marked ready (after its review) and on `main`, not on drafts or
   docs-only changes.
4. **Load test by hand, not in CI,** and once against staging before the
   launch. The staging run is small (a few minutes) and well inside the
   usage Cloudflare's paid Workers plan already includes. **Recommend**
   yes.
5. **The targets** in Performance (size, Lighthouse 90, 1 second with
   5,000 games, 300 ms moves with 500 players). **Recommend** as written;
   anything the first run misses badly becomes a fix in this PR or a new
   Dev Plan item.
6. **What the tests find:** small problems (a missing label, a button too
   small, a layout overflow) fixed in this PR; anything bigger becomes a
   new Dev Plan item before the launch. **Recommend** yes.
7. **No test-only code in the app.** Tests set up history and settings by
   writing to the browser's storage, and move time with Playwright's
   clock, so nothing extra ships to players. **Recommend** yes.
