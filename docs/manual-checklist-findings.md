# Manual checklist findings

Collected during the 1.0 manual checklist on 1 October 2026 (`docs/manual-checklist.md`).
The review is closed: 17 findings, with the owner's decisions below, all
built in PR 89 (status table below).
Still open: Android (no tester yet) and re-running Turn notifications
once the owner has set staging's private key (finding 12).

## Status (PR 89)

| # | Fix |
|---|-----|
| 1 | Content screens (title, profile, Leaderboards, a lobby, a Rush's result, a Daily Rush board) scroll as a whole page, so the side margins and header scroll them; game screens unchanged. Browser test: a wheel on the margin and the header scrolls, at 844×390 and 1280×500 |
| 2 | The winning row has no dash or "Win"; a screen reader hears "Found it" |
| 3 | Backspace is a drawn icon (26 px) on its own `backspace` key class |
| 4 | An open pop-up locks the page behind (`overflow: hidden` on the page; a one-finger swipe is stopped outside the pop-up's body, and inside it when the body has nothing left to scroll that way); pinch-zoom and panning a zoomed view still work. Browser test: a wheel beside How to play doesn't move the page |
| 5 | After the share sheet closes, the page is nudged a pixel and back, and the screen given a layer for a frame, to make Safari redraw it (`src/app/share.ts`, used by all three share buttons). Re-check on the iPhone: finding 1's change may have fixed it already |
| 6 | The lobby card grows to its full height and the whole screen scrolls (with finding 1) |
| 7 | Close lobby asks in a pop-up (`ConfirmDialog`), focus on Keep it open; Escape, ✕ or a tap outside cancel. The other "are you sure" questions stay: on game screens they take the keyboard's place, so they're always in view. Added to the browser tests' screens (`lobby-close`) |
| 8 | "Medium difficulty" in the game header and the history rows |
| 9 | Keys and bubbles read "Letter T", with the mark where it's shown ("Letter E, marked in") |
| 10 | Each definition line is one sentence: "Definition of limes, a form of lime.", "limes, noun: …" |
| 11 | "Guess 7", "Score 3" ("Found it" on the winning row); Extreme's score list reads "Guess 7, score 3" |
| 12 | Staging's own public key is in `worker/wrangler.toml`; **owner:** store the private key as the staging worker's `VAPID_PRIVATE_KEY` secret (the main session's message says where it is), then re-run Turn notifications. The checklist now says so |
| 13 | Fixed by finding 1 (the scrollbar is the window's), plus `overflow-x: clip` on the page; the browser tests now fail any sideways scroll inside the page and check a 1366×625 laptop window. Short windows get a smaller logo and less space above the title |
| 14 | Letters you type in a friend game go to your secret word while choosing it and to guesses once it's under way, never in between; a draft is only kept while the game is under way. Browser test: refused secrets on both sides, letters typed while waiting, then empty slots, after a reload too |
| 15 | Light mode keyboard: plain keys white with a thin edge, out keys `#8E8E8E`; a unit test checks the 3:1 |
| 16 | Last tutorial step: Back, Play now, **Done** (filled, where Next was) |
| 17 | Double tap: 500 ms and 60 px between taps, and a resting finger or palm no longer turns the guard off; unit tests for each |

**For the main session:** these are owner-reported findings from real
devices. Read them all before changing anything, group fixes that touch the
same files, follow the CLAUDE.md working rules, and build/deploy once.
Findings 11 and 12 reverse two choices in PR 89's description ("The guess
number is hidden from screen readers"; "test turn notifications on production
after launch"): the owner's decisions here replace them.

## Owner's decisions (settled; build these, don't re-ask)

| Finding | Decision |
|---------|----------|
| 2 | Remove the visible "Win" on the winning row (VoiceOver reads "Found it") |
| 4 | Lock the page behind any open pop-up; swipes outside it do nothing |
| 6 | Keep the lobby card, let it grow to full height; the whole screen scrolls (also Rush result, Daily board) |
| 7 | Close lobby's "are you sure" moves into a pop-up; Keep it open cancels |
| 8 | VoiceOver reads "Medium difficulty" |
| 9 | VoiceOver reads keys and bubbles as "Letter T" (plus the mark where shown) |
| 10 | Heading "Definition of limes, a form of lime."; each meaning "limes, noun: …" |
| 11 | "Guess 7" … "Score 3" (winning row "Found it") |
| 12 | Give staging its own notification key pair; owner adds the private key in Cloudflare |
| 13 | Include the optional polish: on short windows, shrink the title's top space and logo so it fits at 100% |
| 15 | Keyboard only: white plain keys with a thin border, out keys `#8E8E8E` with black letters; bubbles unchanged |
| 16 | Last tutorial page: Back, Play now, **Done** (Done filled, where Next was) |

## Summary

| # | Area | Severity | Summary |
|---|------|----------|---------|
| 1 | Layout / scrolling | Medium | Scrolling only works with a finger on the centre column; the side margins and the top bar don't scroll (sideways phone, and any wide screen) |
| 2 | Game screen / history | Low | The winning guess's "– Win" is cut off at the right edge on a phone held upright; owner recommends removing it |
| 3 | Keyboard | Low | The backspace symbol is tiny on its wide key; make it bigger |
| 4 | Pop-ups (Report an issue, How to play, Tutorial) | Low | With a pop-up open, swiping outside it scrolls the page behind; lock the page behind while a pop-up is open |
| 5 | Share sheet / rotation | Low | Rotating the phone while the iOS share sheet is open, then cancelling, leaves a blank page until you scroll |
| 6 | Layout / lobby card | Medium | The lobby (and other card screens) scroll inside a small bordered box; sideways you see ~5 lines at a time. Let the card grow and the whole screen scroll |
| 7 | Lobby / Close lobby | Medium | "Close the lobby for everyone?" appears below the fold, so Close lobby looks broken; move the question into a pop-up |
| 8 | VoiceOver / header | Low | The difficulty label at the top right is read as just "Medium"; read "Medium difficulty" |
| 9 | VoiceOver / keyboard and letter bubbles | Low | Keyboard keys and guess-letter bubbles are read as "cap T"; read "Letter T" |
| 10 | VoiceOver / definitions | Low | An opened definition is read in bits ("limes", "form of", "lime", "noun", the text) with no context; read it as a few whole sentences |
| 11 | VoiceOver / guess list | Low | Guess numbers aren't read at all, and a score is read as just "3"; read "Guess 7" and "Score 3" |
| 12 | Turn notifications / staging setup | High (blocks a checklist section) | Staging has no notification keys, so the "Turn notifications" checklist can't be done on the preview; owner needs to set staging's key pair |


## Coverage so far

| Device | Status |
|--------|--------|
| iPhone, Safari | Done (findings 1–11) |
| iPhone, added to the home screen | Done for turn notifications (finding 12: blocked on staging keys, re-run after) |
| Android phone, Chrome | Not tested: no Android tester available yet. Still open before launch |
| iPad, Safari | Done (finding 17; nothing else new) |
| Computer: Chrome, Firefox, Safari | Windows laptop Chrome done (findings 13–14); MacBook Air Safari done (finding 15, plus a note under 13); Firefox (Mac) done: nothing new beyond a no-change note |
| 13 | Layout / scrollbars (Windows) | Medium | Title screen shows a horizontal scrollbar (signed out) and a scrollbar in the middle of the page; likely the vertical scrollbar squeezing the column |
| 14 | Friend game / typed word | Low (seen once) | A rejected secret word (NORSE) reappeared later as an unsent guess on your turn; couldn't reproduce |
| 15 | Keyboard colours (light mode) | Medium | In light mode, "out" keys (grey) and plain keys (light grey) look almost the same: contrast 1.4:1 |
| 16 | Tutorial, last page | Low | Tapping Next quickly lands on Play now, which starts a game; swap so Done sits where Next was |
| 17 | Double-tap zoom (iPad and iPhone) | Medium | Double-tap still zooms the page sometimes (reproducible-ish on iPad, sporadic on iPhone): issue #39 not fully fixed |

---

<!-- Findings below. Each: what was seen, where, device, expected,
     likely cause (file pointers), recommended fix. -->

## Finding 1: Side margins and top bar don't scroll

- **Checklist item:** Every device, item 1 (title screen etc., upright and sideways)
- **Device:** iPhone, Safari, turned sideways (landscape)
- **Seen on:** title screen (screen recording `ScreenRecording_10-01-2026_09-50-43_1.mp4`)
- **What happened:** Sideways, the content is a centred column with empty
  space either side. A swipe starting on the content scrolls; a swipe starting
  in the empty space on either side does nothing. A swipe near the top, around
  the logo and the profile button at the right edge, also failed to scroll.
- **Expected:** A swipe anywhere on the screen scrolls the page, as on any
  normal website.
- **Likely cause:** `src/app/styles.css`. `html`, `body` and `#root` are
  `height: 100%` and the page itself never scrolls. `.app` is the
  `max-width: 520px` centred column, and each screen scrolls *inside* it
  (`.title-screen { overflow-y: auto }`, likewise `.profile-screen`, `.lobby`,
  `.rush-result`, `.daily-board`). The side gutters are plain `body`, which has
  nothing to scroll, so a touch there doesn't go to any scroll container. The
  top bar (logo / profile button header) is outside the screen's scroll
  container too, so a swipe starting on it also does nothing.
- **Scope:** Not just iPhone landscape. Any window wider than 520px is
  affected: iPad, an Android phone sideways, and a computer (the mouse wheel
  over the side margins won't scroll). It probably affects the other screens
  that scroll inside the column the same way (profile, lobby, Rush result,
  Daily board), so check each one.
- **Confirmed also on (owner, iPhone sideways):** the Rush with Friends
  lobby: swiping in the margins doesn't scroll it. See finding 6, which
  should be fixed together with this one.
- **Not affected (owner checked on iPhone):** the Solo Rush game screen scrolls
  fine from the side margins. Use it as the working example when fixing the
  others, and keep its behaviour unchanged.
- **Recommended fix:** Make each scrolling screen's scroll container the full
  width of the viewport, and centre its content inside with padding, not with
  the narrow column. For example, take the 520px width off the scroll
  container and give it
  `padding-inline: max(16px, (100% - 520px) / 2)` (or wrap its content in an
  inner 520px column), so the gutters belong to the thing that scrolls. For
  screens with a header above the scroll area, either put the header inside
  the scroll container on scroll-only screens (title, profile, lobby), or let
  the document scroll on those screens and keep fixed-height inner scrolling
  only for game screens, which need the keyboard pinned. Keep game screens'
  layout (history list scrolling above a fixed keyboard) unchanged.
- **Test:** Add an e2e check at a landscape phone size (for example
  844×390) and a desktop width: a wheel or touch scroll whose start point is
  in the side gutter and on the header moves the title screen's scroll position.
  Re-check on the iPhone sideways and upright.

## Finding 2: "– Win" on the winning guess is cut off

- **Checklist item:** Every device, item 1 (a single player game)
- **Device:** iPhone, Safari, upright (portrait)
- **Seen on:** single player, Easy, won in 12 (screenshot from 10:04)
- **What happened:** The last line of the guess list reads
  `B R O W N – Win`, and "Win" runs past the right edge of the guess box
  and is cut off ("Wi").
- **Owner's decision:** remove the "Win" label from the winning line. The
  result panel below ("You found it in 12 guesses." with the word and its
  definition) already says it, so the label adds nothing.
- **Landscape:** fine. Sideways on the same iPhone, "– Win" shows in full,
  so this only happens on a narrow (portrait) phone.
- **Why it shows up now:** the guess numbers added to each line (the
  `.row-no` column on branch `claude/dev-plan-18`, Dev Plan item 18, not yet
  on `main`) took up the horizontal space that "Win" used to fit in. So it's
  a regression from item 18, and the fix belongs with or after it, built on
  that branch, not `main`.
- **Likely cause:** `src/app/components.tsx` (the shared guess list, around
  line 120) prints `–` and then `Win` in place of the score on the winning
  row. `.row` in `src/app/styles.css` is `grid-template-columns: auto auto
  auto auto 1fr` on item 18's branch, with the guess number, the ⓘ button, five bubbles, the dash and the score. "Win" is
  3 characters wide where a score is 1, so on a narrow phone the row is
  wider than the box, and the box hides what overflows.
- **Recommended fix:** In the shared guess list, render the winning row
  without the dash and without the visible "Win". Keep a visually hidden
  "found it" (or "correct") in its place so screen readers still announce
  the win, since the manual checklist's VoiceOver item expects the result to
  be read. Drop the then-unused `.score.win` style. This is one component, so
  it changes every mode that uses the shared guess list (single player, two
  player, friend games, every Rush and reviews of past games). That's
  consistent, and in Rush the "Found WORD in N guesses" message and the
  move to the next word already show the win.
- **Check afterwards:** the Tutorial's mock-ups and any e2e or unit test that
  looks for "Win" in the guess list (`grep` e2e/ and `src/app/`). The
  layout checks in `e2e/` at the smallest phone width should cover a winning
  row; add one if they don't, so a row that's too wide fails the test.
  Also check a 3-digit guess number (100+ guesses, which `.row-no` makes room
  for) on the smallest phone. Ordinary scores are 1 digit, so with "Win"
  gone every row should be the width of a 1-digit score.

## Finding 3: Backspace symbol too small for its key

- **Checklist item:** Every device, item 1 (a Solo Rush)
- **Device:** iPhone, Safari, upright and sideways (screenshots from 10:11)
- **Seen on:** the on-screen keyboard (any mode, as every game shares it)
- **What happened:** The backspace key (bottom right, ⌫) is one of the
  widest keys, but its symbol is a small mark in the middle, much smaller
  than the letters and the shuffle icon. It looks lost and is hard to read.
- **Expected:** The backspace symbol fills its key about as well as the
  letters and the shuffle icon fill theirs.
- **Likely cause:** On item 18's branch (`claude/dev-plan-18`),
  `src/app/components.tsx` `Keyboard` draws backspace as the text character
  `⌫` inside `class="key wide"`. `.key.wide` in `src/app/styles.css` sets
  `font-size: 0.78rem`, which is sized for the word "ENTER", so the ⌫ symbol
  is drawn at a small text size (and that symbol is small in most fonts
  anyway). The shuffle key, by contrast, has an SVG icon at 20×20px
  (`.key.shuffle svg`).
- **Recommended fix:** Replace the `⌫` character with an inline SVG
  backspace icon (stroke `currentColor`, like `ShuffleIcon`), sized about
  24×24px (a bit bigger than shuffle, since the key is wider), and give the
  key its own class (e.g. `key wide backspace`) so ENTER's font size doesn't
  apply. Keep `aria-label="Backspace"`. The icon must keep working on the
  left as well as the right, since the ENTER/backspace side can be swapped.
- **Check afterwards:** Tutorial mock-ups use the real `Keyboard`, so they
  update by themselves. Check the smallest phone width (the `@media` rule
  that sets `.key { height: 44px }`), and light and dark themes.

## Finding 4: Page behind a pop-up scrolls

- **Checklist item:** Every device, item 3 (Report an issue)
- **Device:** iPhone, Safari, sideways (screen recording
  `ScreenRecording_10-01-2026_10-51-35_1.mp4`), over a friend game
- **What happened:** With Report an issue open, a swipe inside the pop-up
  scrolls the pop-up (correct). A swipe in the dimmed area beside it
  scrolls the game page *behind* the pop-up.
- **Expected:** While a pop-up is open, the page behind it stays still.
- **Owner's view:** any of these is acceptable: leave it, block scrolling
  in the margins while a pop-up is open, or have margin swipes scroll the
  pop-up. Asked for a recommendation.
- **Owner's decision: block it (lock the page behind while any pop-up is
  open).** This is how most apps and websites behave. Having a swipe in the
  margin scroll the pop-up is unusual and needs custom touch handling,
  which tends to break on iOS. Leaving it as is costs little, but it can
  move the page so you lose your place, and it looks unfinished.
- **Likely cause:** `.modal-backdrop` in `src/app/styles.css` is a
  `position: fixed` overlay that doesn't scroll, so iOS Safari passes a swipe
  on it through to the scrolling area behind it. Nothing stops the page or
  the screen's scroll container from scrolling while a pop-up is open.
- **Recommended fix:** In the shared pop-up (`Modal` in
  `src/app/components.tsx`, `.modal-backdrop`, which Report an issue, How to
  play and the Tutorial use; check `ReportIssue.tsx` uses it too):
  1. Give `.modal-backdrop` `overscroll-behavior: contain` and
     `touch-action: none`, and `.modal-body` `overscroll-behavior: contain`
     with `touch-action: pan-y`. The pop-up's own content must keep
     scrolling, and reaching its end must not scroll the page behind.
  2. If iOS still scrolls behind (older iOS ignores `overscroll-behavior` on
     a non-scrolling overlay), also add a `touchmove` listener on the backdrop
     (`{ passive: false }`) that calls `preventDefault()` unless the touch is
     inside `.modal-body`.
  Don't lock with `body { overflow: hidden }` alone, since the screens scroll
  inside their own containers, not the body (see finding 1).
- **Relation to finding 1:** do this alongside finding 1's scrolling change
  and re-check both together, since moving which element scrolls changes
  what a pop-up has to lock.
- **Check afterwards:** on iPhone (upright and sideways), with each pop-up
  over a long screen: a swipe outside the pop-up moves nothing; a swipe
  inside scrolls the pop-up; the Report form's text box and the screenshot
  picker still work. Also the ☰ menu (`data-menu-open`) isn't affected.

## Finding 5: Blank page after rotating with the share sheet open

- **Checklist item:** Phones, "Share buttons" (and Every device, item 2: a lobby)
- **Device:** iPhone, Safari (screen recording
  `ScreenRecording_10-01-2026_11-00-04_1.mp4`; **don't attach it to a GitHub
  issue**: it shows the lobby's join link and the owner's contacts)
- **Steps:**
  1. In a Rush with Friends lobby, hold the phone sideways.
  2. Tap **Share**; the iOS share sheet opens.
  3. With the sheet open, turn the phone upright.
  4. Cancel the share sheet.
- **What happened:** The app shows a blank page. Scrolling brings the
  lobby back.
- **Expected:** The lobby shows straight away, laid out for upright.
- **Likely cause:** iOS Safari changes the page's size while the share
  sheet covers it, and doesn't repaint the screen's own scroll container
  (`.lobby { overflow-y: auto }` inside the fixed-height `.app`; see
  finding 1). Its scroll position stays where it was for the sideways
  layout, past the end of the now-taller content, or isn't redrawn, until
  a scroll forces it. It's a Safari quirk, but the app can work around it.
- **Recommended fix:**
  1. Do finding 1 first and re-test. If the scrolling moves to the page
     itself or to a full-width container, this may go away.
  2. If not, add a small shared helper (e.g. `refreshScroll()` in
     `src/app/`) that re-clamps the current screen's scroll container
     (`el.scrollTop = Math.min(el.scrollTop, el.scrollHeight - el.clientHeight)`,
     which also forces a repaint). Call it when `navigator.share` settles
     (resolved or rejected) and on `resize` / `visibilitychange`.
     Use it at all three share buttons: `LobbyScreen.tsx`,
     `FriendScreen.tsx` (friend invite) and `FriendsSection.tsx` (friend code).
- **Check afterwards:** the same steps on the iPhone for the lobby, a friend
  invite and the friend code share, rotating both ways (sideways → upright
  and upright → sideways) and both cancelling and sharing.
- **Severity:** Low. It needs a rotation mid-share and scrolling recovers it.

## Finding 6: Lobby content trapped in a small scrolling box

- **Checklist item:** Every device, items 1–2 (a lobby, sideways)
- **Device:** iPhone, Safari, sideways and upright (screenshots from 11:05)
- **Seen on:** Rush with Friends lobby (host view before starting)
- **What happened:** The lobby's content (join code, players, difficulty,
  duration, computer players, Start) sits in a bordered card that has its
  own scroll area, with the title and "Rush with Friends" row fixed above
  it. Sideways, the card is only as tall as what's left of the screen
  (about 5 lines), so you scroll a small window to read the lobby, and the
  rest of the screen (header above, margins either side) doesn't scroll
  (finding 1). Upright it mostly fits, so it's less noticeable.
- **Owner's view:** unclear why the lobby is in a bordered card at all.
  Either drop the card, or keep it and let it run past the bottom of the
  screen, so the whole screen scrolls. iPhone sideways is rare, but the
  card shouldn't make the lobby hard to read.
- **Owner's decision: keep the card, let it grow to its full height and
  scroll the whole screen.** The card matches
  the other screens' style and groups the lobby's settings, so dropping it
  would make the lobby look different from everything else for no gain.
  What makes it hard to read is that the card *itself* scrolls in a
  fixed-height space, not the card.
- **Likely cause:** On item 18's branch, the lobby is `<section class="panel
  lobby">` in `src/app/LobbyScreen.tsx` (3 places: lines ~603, 642, 757),
  and `src/app/styles.css` gives `.lobby { overflow-y: auto }` inside the
  fixed-height `.app` column. So the card fills what's left below the
  header and scrolls inside. `.panel.rush-result` and `.panel.daily-board`
  work the same way, so the Rush result and Daily Rush board likely have the
  same problem sideways.
- **Recommended fix (with finding 1):** on screens that are just content to
  read (lobby, Rush result, Daily board, and the title and profile screens
  from finding 1), let the screen scroll as a whole: header, card and all,
  in one full-width scroll area. Remove the card's own `overflow-y: auto`
  so it grows to its content. Game screens (guess list above a fixed
  keyboard) keep their current layout. Once a lobby game starts, check the
  in-game Rush screen is unchanged (owner found Solo Rush fine).
- **Check afterwards:** iPhone sideways and upright: the lobby (host and
  guest, before start, and the waiting/finished views), Rush result, Daily
  Rush board. Swiping anywhere scrolls the whole screen, and the header
  scrolls away with it. The e2e layout checks in `e2e/` at a landscape phone
  size (e.g. 844×390) should still pass, as should axe.

## Finding 7: Close lobby's "are you sure" is out of sight

- **Checklist item:** Every device, item 2 (a lobby)
- **Device:** iPhone, Safari (screen recording
  `ScreenRecording_10-01-2026_11-11-45_1.mp4`; don't attach it to an issue,
  it may show the join code)
- **Steps:** open a Rush with Friends lobby with nobody else in it; tap
  **Close lobby**.
- **What happened:** The question "Close the lobby for everyone?" with
  **Close it** / **Keep it open** appears at the bottom of the lobby card,
  below the turn alerts prompt, off the bottom of the screen. Nothing on
  screen changes, so it looks like the button didn't work until you scroll
  down.
- **Owner's decision:** move the question into a pop-up, so no scrolling is
  needed. Cancel (Keep it open) closes the pop-up. The new pop-up must follow
  findings 1, 4 and 6: the page behind it doesn't scroll, and the pop-up
  itself scrolls if it's ever taller than the screen.
- **Likely cause:** On item 18's branch, `src/app/LobbyScreen.tsx` (~line
  727) renders `confirming === 'close'` as an inline
  `<div class="lobby-confirm">` at the end of the lobby panel, after the
  notes and `TurnAlertsPrompt`, far from the Close lobby button (~line 710).
- **Recommended fix:**
  1. Add a small shared confirm pop-up built on the existing `Modal`
     (`src/app/components.tsx`, ~line 538), e.g.
     `ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel })`:
     focus starts on the safe choice (Keep it open), Escape and tapping the
     backdrop cancel, focus goes back to the Close lobby button when it
     closes. Because it uses `Modal`, finding 4's lock on the page behind
     applies to it automatically.
  2. Use it for Close lobby: title "Close the lobby?", body "It closes for
     everyone in it.", buttons **Close it** (primary) and **Keep it open**.
     Remove the inline `.lobby-confirm` block (and its CSS if nothing else
     uses it).
  3. Check the app's other inline "are you sure" prompts (`setConfirming`
     in `LobbyScreen.tsx` ~lines 496–519 and 814–838, `FriendScreen.tsx`,
     `DailyScreen.tsx`, `RushScreen.tsx`, e.g. giving up or cancelling an
     invite) for the same problem: does the question appear in view when the
     button is tapped? Any that can appear off-screen should move to the same
     pop-up; ones that already appear in place can stay. List which were
     changed in the PR.
- **Check afterwards:** iPhone upright and sideways: Close lobby opens the
  pop-up in view; Keep it open closes it and leaves the lobby as it was;
  Close it closes the lobby and goes back to the main menu. Keyboard alone
  (the e2e keyboard test): Tab reaches both buttons and Escape cancels. Add
  the pop-up to `e2e/screens.ts` so the layout and axe checks cover it.

## Finding 8: VoiceOver reads the difficulty label as just "Medium"

- **Checklist item:** Phones, "Screen reader"
- **Device:** iPhone, VoiceOver
- **What happened:** Selecting the difficulty label in the game screen's
  top right reads "Medium", with no hint of what it means.
- **Owner's proposal:** read "Medium difficulty".
- **Likely cause:** On item 18's branch, `src/app/components.tsx` (game
  header, ~line 490) renders `<span class="matchup-diff">{DIFFICULTY_LABEL[difficulty]}</span>`
  with nothing else for screen readers. It's a label, not a button, so
  tapping it does nothing. (Difficulty changes are in the ☰ menu.)
- **Recommended fix:** add hidden text so it reads "Medium difficulty":
  `{DIFFICULTY_LABEL[difficulty]}<span class="visually-hidden"> difficulty</span>`
  (the app already has `.visually-hidden`). Avoid `aria-label` on a plain
  `span`, since VoiceOver doesn't reliably read it there. Same treatment for
  the Rush and review headers if they print the difficulty on their own
  (`.history-side .matchup-diff`).
- **Check afterwards:** VoiceOver reads "Medium difficulty" (and Easy, Hard,
  Extreme); on screen it still shows only the word. The e2e axe check still passes.

## Finding 9: VoiceOver reads keyboard keys as "cap T"

- **Checklist item:** Phones, "Screen reader"
- **Device:** iPhone, VoiceOver
- **What happened:** Tapping a letter key reads "cap T, button" (for T).
  "Cap" means a capital letter, which doesn't matter in this game.
- **Owner's proposal:** read "Letter T, button".
- **Likely cause:** On item 18's branch, `Keyboard` in
  `src/app/components.tsx` (~line 190) renders each key as a button whose
  only text is the letter, shown in capitals. VoiceOver says "cap" before a
  single capital letter.
- **Recommended fix:** give each letter key `aria-label={`Letter ${ch.toUpperCase()}`}`.
  VoiceOver then reads "Letter T, button" (a label with more than one word
  isn't read as "cap"). On Easy and Medium, where keys are coloured by your
  marks, also add the mark so a VoiceOver player gets what sighted
  players see: "Letter E, in" / "Letter A, out" (use `MARK_LABEL`, as the
  tappable `Bubble` already does). Leave Enter, Backspace and Shuffle as
  they are.
- **Confirmed (owner, VoiceOver):** letter bubbles in the guess list are
  read as "cap B" too. Apply the same fix to every bubble, tappable or not:
  - Tappable (Medium): `Bubble`'s `aria-label` becomes
    `Letter B, in. Tap to change.`
  - Not tappable (Easy, Hard, Extreme, the result word, the "IN" row of
    marked letters): `Bubble` renders a plain `<span>{letter}</span>`
    (~line 29). Show the letter `aria-hidden` and add a `.visually-hidden`
    "Letter B" (plus its mark on Easy, e.g. "Letter B, in").
- **Was "Also check":** the tappable letter bubbles in the guess list (Medium)
  have `aria-label={`${letter.toUpperCase()}, ${MARK_LABEL[mark]}. Tap to change.`}`
  (`Bubble`, ~line 32), which may also be read as "cap T". If so, change to
  `Letter T, in. Tap to change.` to match. Same for the typed-letter slots
  above the keyboard, if VoiceOver reads them letter by letter.
- **Check afterwards:** VoiceOver on the iPhone: a key reads "Letter T,
  button"; on Medium, a marked key includes its mark; the e2e keyboard and
  axe tests still pass (update any test that finds a key by its name, e.g.
  `getByRole('button', { name: 'T' })`).

## Finding 10: VoiceOver reads an opened definition in fragments

- **Checklist item:** Phones, "Screen reader"
- **Device:** iPhone, VoiceOver
- **What happened:** With a guess's definition opened (ⓘ), VoiceOver
  stops on each piece separately, with no context. For "limes" there are 5
  stops: "limes", "form of", "lime", "noun", then the definition text. The
  word on its own doesn't say it's a definition; "noun" / "verb" on their
  own are unclear (owner: "probably fine").
- **Owner's proposals:**
  1. The word: read it as the word *in the opened definition*, not just the word.
  2. Each meaning: "[word]'s [noun] definition: [definition]".
  3. Merge "form of" / "part of" with its base word into one stop.
- **Likely cause:** On item 18's branch, `DefinitionBox` in
  `src/app/components.tsx` (~lines 47–84) builds each line from separate
  `<span>`s (`.word`, the text "· form of", another `.word`, `.pos`, the
  text). VoiceOver on iOS stops on each separate element.
- **Recommended fix:** for each line, show the same thing on screen as now,
  but give VoiceOver one whole sentence in its place: wrap the visible parts
  in `aria-hidden="true"` and add a `.visually-hidden` sentence next to them.
  That makes each line one stop, which also covers proposal 3.
  - Heading line: "Definition of limes, a form of lime." (without "form
    of", just "Definition of brown.")
  - Each meaning: "limes, noun: the green fruit of …". Owner's wording
    "[word]'s noun definition" reads oddly for words ending in s
    ("limes's"), so suggest "Noun, limes: …" or "limes, noun: …"
    (**owner chose "limes, noun: …"**). Where a line names its own base word (mixed
    entries such as "dying": die, dying), include it: "dying, verb, a form
    of die: …".
  - **Owner accepted** "Definition of limes" for the heading (the box is an
    opened panel under the guess, not a pop-up).
  - Keep the "Loading definition…", "Couldn't load definitions." and "No
    definition available for X." lines as they are (already one sentence).
- **Same component everywhere:** `DefinitionBox` is also used on the result
  panel ("You found it", e.g. brown's definition in finding 2), so the fix
  covers both.
- **Check afterwards:** VoiceOver on the iPhone: "limes" opens to 1 heading
  stop + 1 stop per meaning; "brown" reads "Definition of brown." then
  "brown, verb: fry in a pan until it changes color" and "brown, adjective:
  …". The text on screen is unchanged and still selectable (it has
  `user-select: text`). e2e axe and any test that reads the definition
  text (search `e2e/` and `src/app/` for `.definition`) still pass.

## Finding 11: VoiceOver skips guess numbers and reads a bare score

- **Checklist item:** Phones, "Screen reader"
- **Device:** iPhone, VoiceOver
- **What happened:**
  - The new guess numbers (7, 8, 9 … before each guess) aren't read at all.
  - A guess's score is read as just the number ("3"), with no hint that
    it's the score.
- **Owner's proposals:** read the number as "Guess 1", "Guess 2"…; read the
  score as "[guess] score 3" (e.g. "Score 3").
- **Likely cause:** On item 18's branch, the shared guess list
  (`src/app/components.tsx`, ~line 112) renders
  `<span class="row-no" aria-hidden="true">{i + 1}</span>`, hidden from
  screen readers on purpose (probably because an `<ol>` already numbers its
  items, but VoiceOver on iOS doesn't announce list positions). The score
  already has `<span class="visually-hidden">score </span>` before the
  number, but as a separate element; VoiceOver on iOS stops on the number
  alone, so "score" is skipped or read as its own stop.
- **Recommended fix:**
  1. Guess number: remove `aria-hidden`, show the number `aria-hidden`
     with a `.visually-hidden` "Guess 7" next to it, so it's one stop that
     reads "Guess 7".
  2. Score: one stop reading "Score 3": the visible number `aria-hidden`
     and a single `.visually-hidden` "Score 3" in its place (not split across
     two elements). The dash before it stays `aria-hidden`.
  3. **Owner chose** "Guess 7" … "Score 3", which reads
     well in order (Guess 7, ⓘ Definition of north, Letter N, …, Score 3).
     The owner's "[guess] score 3" could also mean "north scored 3"; with
     the letters read just before it, "Score 3" is shorter.
  4. On a winning row the score is replaced by finding 2's hidden "found
     it"; read it as "Found it" in the same place.
  5. Rows in the Extreme scores-only history (scores without words) and in
     a Rush's per-word list (`.score-list`) should read the same way: check
     each, and use "Guess 7, score 3" where the row has no letters.
- **Check afterwards:** VoiceOver on the iPhone through a whole single
  player game: each row reads "Guess N", the definition button, five
  letters, "Score S", and the winning row ends "Found it". Also check
  the e2e keyboard and axe tests, and that the numbers still don't show twice
  for a sighted player.

## Finding 12: Turn notifications can't be tested on the preview (staging has no keys)

- **Checklist item:** Turn notifications (whole section)
- **Device:** iPhone, the preview added to the home screen, signed in;
  friend game against a private tab playing as the friend
- **What happened:** With the app closed, the friend guessed and no
  notification arrived. Profile → Settings → Turn alerts says "The game
  server isn't set up to send turn alerts." (screenshot from 1:02).
- **This is a setup gap, not an app bug.** The app is correctly reporting
  that the server it talks to has no notification keys.
- **Cause:** `worker/wrangler.toml` on item 18's branch: `[env.staging.vars]`
  has `VAPID_PUBLIC_KEY = ""` ("Empty, notifications are off"). Production
  (`[env.production.vars]`) has a public key set. Pages previews use the
  staging server (CLAUDE.md "CI and staging"), and the manual checklist says
  to run everything on the staging preview, so this section can't pass as
  things stand.
- **Owner's decision: give staging its own key pair.** Steps (the secret needs the owner):
  1. Main session: run `npm run vapid-keys` to make a **new** key pair for
     staging (never reuse production's). Put the public key in
     `[env.staging.vars] VAPID_PUBLIC_KEY` in `worker/wrangler.toml` and
     commit it (the public key isn't a secret). Give the owner the private
     key **out of band**, without pasting it into a PR, issue, commit or
     comment, or have the owner run the command themselves.
  2. Owner: store the private key as a secret on the staging worker, either
     `npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml --env staging`
     or Cloudflare dashboard → the `word-mastermind-api-staging` worker →
     Settings → Variables and Secrets → add `VAPID_PRIVATE_KEY`, type
     Secret. (worker/README.md, the turn notifications setup step.)
  3. Redeploy staging (the next branch push does it), then check
     `GET /api/push/key` on the staging server returns a key instead of 404
     `push-off`, and that Settings → Turn alerts offers to turn them on.
  - Costs nothing (Web Push is free).
  - Also confirm production's `VAPID_PRIVATE_KEY` secret is actually set
    (the public key is in `wrangler.toml`, but the secret is only in the
    dashboard). Otherwise notifications would be off at launch too.
- **Also update `docs/manual-checklist.md`:** add a line to Turn
  notifications saying staging must have its own key pair first.
- **Then re-run** the Turn notifications section on the iPhone (home-screen
  app), Android and a computer.

## Finding 13: Horizontal scrollbar on the title screen (Windows Chrome)

- **Checklist item:** Every device, item 1 (title screen), on a computer
- **Device:** Windows laptop, Chrome (photo of the screen)
- **What happened:**
  - **Signed out:** a horizontal scrollbar shows along the bottom of the
    title screen at Chrome zoom 100%, 90%, 80% and 75%. It goes away at 67%.
  - **Signed in (Google):** a vertical scrollbar shows on the page's column
    at 100% and 90%. At 80% the whole title screen fits and it's gone.
- **Expected:** no horizontal scrollbar ever; a vertical one only when the
  content is taller than the window, and at the window's edge, not halfway
  across the page.
- **Likely cause:** Windows draws real scrollbars that take up width (iPhone
  and Mac draw overlay scrollbars that don't, which is why this only shows on
  the laptop). The title screen scrolls inside the 520px column
  (`.title-screen { overflow-y: auto }`, finding 1). When it needs to scroll
  vertically, its scrollbar takes ~15px from inside the column, and
  anything sized to the column's full width is now ~15px too wide, so a
  horizontal scrollbar appears too. (`overflow-y: auto` also makes
  `overflow-x` auto.) Zooming out until the content fits removes the
  vertical scrollbar, and with it the horizontal one. The signed-out screen
  is taller (the sign-in card) so it needs zooming further out.
- **Recommended fix:**
  1. Finding 1's change fixes most of it: with the scroll area full width,
     the scrollbar sits at the window's right edge and the content column
     isn't squeezed.
  2. Also, on every scrolling container, set `overflow-x: hidden` (or
     `clip`), so a vertical scrollbar can never cause a horizontal one, and
     find the element that's too wide (in Chrome DevTools, the one whose
     width exceeds the scroll area's `clientWidth`) and give it
     `max-width: 100%` / `min-width: 0`.
  3. Optionally `scrollbar-gutter: stable` on scroll areas, so content
     doesn't shift sideways when a scrollbar appears or goes away.
- **Test:** the e2e layout checks (`e2e/`) should fail on any horizontal
  overflow (`scrollWidth > clientWidth`) for every scroll container, not
  just the page. Run them at a height short enough to make the title screen
  scroll (e.g. 1280×600), with classic scrollbars. Chromium on Linux in
  headless mode may use overlay scrollbars and hide this, so check the
  test reproduces it before the fix.
- **Re-check after:** Windows Chrome at 100/90/80%, signed in and out, and
  Firefox and Edge on Windows (same scrollbar behaviour).
- **Mac comparison (owner, MacBook Air, Safari):** at 100% the title screen
  needs a scroll to see it all; at 90% it fits. No horizontal scrollbar
  (Mac scrollbars float over the content), so no bug there. Optional
  polish, **owner says include it**: on short windows (e.g. `@media (max-height: 800px)`)
  shrink the title's top space (`.title-hero` padding, now
  `clamp(24px, 10vh, 72px)`) and the logo a little, so the whole title screen
  fits a typical laptop at 100% without scrolling, signed out included.

## Finding 14: Rejected secret word reappeared as a typed guess (seen once)

- **Checklist item:** Every device, item 2 (a friend game), on a computer
- **Device:** Windows laptop, Chrome, typing on the laptop's keyboard; the
  friend played in a private window
- **What happened:** Setting up a two player friend game, the owner typed
  NORSE as their secret word. It was refused (not on the secret list). They
  entered a different word and the friend joined. When it was the owner's
  turn, NORSE was already in the five typed-letter slots above the keyboard,
  ready to submit with Enter, though they hadn't typed it again. It wasn't
  submitted. **Tried several more times, couldn't reproduce.**
- **Expected:** the slots are empty when the game starts; a refused secret
  word is never carried into the game.
- **What the code does (item 18's branch, `src/app/FriendScreen.tsx`):**
  - One `draft` (the typed letters) serves both the secret-word step and
    the guesses. A refused secret leaves `draft` as it was, on purpose, so
    you can correct it; it's cleared only when a secret is accepted
    (`createInvite`, `acceptInvite`) or a guess is sent.
  - The draft is also **saved per game** (`updateFriendGame(gameId, { marks, draft, … })`,
    ~line 347, in `friendGames.ts`) and restored when the game is opened
    (`saved?.draft`, ~line 257), so an unsent guess survives a reload. That
    effect saves whenever `gameId && game.seat` is set, which includes
    moments when `draft` still holds the secret-step letters.
  - Typing is allowed whenever the game isn't over (`typing()` doesn't check
    whose turn it is), so letters typed on the laptop's keyboard while waiting
    for the friend go into the draft too.
- **Likely causes, for the main session to confirm with a test:**
  1. A path where the draft-saving effect runs with `gameId` and
     `game.seat` set while `draft` is still a secret-step word (e.g.
     accepting an invite, a challenge from the friends list, a refresh or the
     live socket updating the game between the refusal and the accept), then
     the saved draft is restored when the screen remounts (`FriendScreen` is
     keyed by game ID in `App.tsx`, so it remounts when the game gets its ID).
  2. A keypress on the physical keyboard landing in the draft while the game
     screen was open but not your turn, which then looked like the old word.
     (Less likely to spell NORSE exactly.)
- **Recommended fix (defensive, whichever the cause):**
  - Keep the secret-step letters separate from the guess draft (or clear
    `draft` the moment the secret step ends, refused or accepted), and
    never save `draft` to the game's entry until the game is under way
    (`game.state === 'playing'`).
  - When a game is opened with no guesses of yours yet, ignore any saved
    draft that equals a word refused or used as a secret in that game (or
    simply any saved draft before your first guess).
  - Add a unit or e2e test: refuse a secret, type a new one, accept, have
    the friend join, and check the slots are empty on your first turn, for
    both the host (link and friends-list challenge) and the joining side.
- **Unsent guesses are kept on purpose** (per game, across reloads). Keep
  that behaviour; only stop secret-step letters leaking into it.

## Finding 15: Light mode: "out" keys hard to tell from plain keys

- **Checklist item:** Every device, item 1, on a computer
- **Device:** MacBook Air, light mode (photo; Chrome per the photo's tab
  bar, though the owner mentioned Safari: the colours are the same in both)
- **Seen on:** two player vs. computer, Easy: the on-screen keyboard
- **What happened:** In light mode, keys marked out (A, E, C, B, H, Y, O, L)
  are hard to tell apart from plain keys (S, D, F, G, R, T …). The owner
  plays in dark mode normally, where it's fine.
- **Measured:** `src/app/styles.css` light theme: plain key `--key-bg:
  #DCE1E7`, out key `--out-bg: #BDBDBD`. Contrast between them **1.43:1**.
  In dark mode the plain key is `#2A3038` against the same grey: **7.1:1**,
  which is why dark mode is fine. WCAG asks for 3:1 between states that
  matter, like these.
- **Recommended fix (light mode only, keyboard only):** keep the rule "out
  = black on grey" (README "User Interface"), but make the two key states
  further apart:
  - plain keys: white (`#FFFFFF`) with a thin `--line` border, so they still
    read as keys on the light background;
  - out keys: a darker grey, about `#8E8E8E`, black letter (letter contrast
    6.4:1; against a white key 3.3:1, passing 3:1).
  Put it in a keyboard-only token (e.g. `--key-out-bg`, set to `#8E8E8E` in
  light and to `--out-bg` in dark) so the guess-list bubbles, which sit on
  white and next to black unmarked bubbles, keep their current grey.
  - In keys: green `#2E7D32` with white letters stays (5.1:1 against white).
- **Owner's decision:** keyboard only, `#8E8E8E`; guess-list bubbles keep
  their current grey.
- **Check afterwards:** light and dark mode, Easy and Medium, on a phone
  and a computer: out keys are clearly different from plain keys. Add the
  key-state colours to whatever e2e/axe colour checks exist (axe doesn't
  check this kind of contrast by itself, so a small unit test on the tokens
  could guard the 3:1).

## Finding 16: Tutorial's last page: Play now sits where Next was

- **Checklist item:** none (owner's feedback while testing; any device)
- **What happened:** Tapping through the tutorial quickly with your finger
  in one place, the last tap lands on **Play now** (it's where **Next** was
  on every earlier step), so you're dropped into a game unexpectedly.
- **Owner's decision:** swap **Play now** and **Done**, so **Done** is
  where Next was and a fast tap goes back to the home page.
- **Where:** On item 18's branch, `src/app/Tutorial.tsx` (~lines 286–293),
  in `.tut-nav .row-btns`: earlier steps show `Back` `Next`; the last shows
  `Back` `Done` `Play now`, with Play now at the right, where Next was.
- **Recommended fix:** on the last step render `Back` `Play now` `Done`.
  **Owner's decision:** make **Done** the primary (filled) button there, like Next, so the
  filled button in the same spot always means "carry on safely", and Play
  now the plain one. Keep `onClose(hide)` / `onPlay(hide)` as they are.
  Check the buttons' right edge doesn't move between the second-to-last
  and last steps (the step dots hide on the last step, `hidden={last}`;
  make sure that doesn't shift the buttons).
- **Check afterwards:** tap Next repeatedly in one spot on a phone: the
  final tap closes the tutorial to the home page. Update any e2e test that
  clicks the last step's buttons by position (they should find them by
  name, `Play now` / `Done`).

## Finding 17: Double-tap zoom still happens sometimes (iPad and iPhone)

- **Checklist item:** Phones, "Double-tap on the board doesn't zoom" (issue
  #39): **fails** on the iPhone (sporadically) and the iPad
- **Device:** iPad, Safari, single player game; iPhone, Safari (sporadic)
- **What happened:** Quick double taps can still zoom the page. It happens
  inconsistently, not every time. **Also happens on the iPhone** (owner):
  very occasionally, and never when trying to repeat it, so issue #39 isn't
  fully fixed on either device.
- **What the app does now:** `touch-action: manipulation` on every element
  (`src/app/styles.css` ~line 64), plus `preventDoubleTapZoom(document)`
  (`src/app/doubleTap.ts`, set up in `src/main.tsx`), which cancels the
  second tap's `touchend` when it comes within `DOUBLE_TAP_MS = 350` ms and
  `SLOP_PX = 30` px of the first, and replays its click.
- **Likely gaps (the main session should check each):**
  1. **Timing:** a double tap slower than 350 ms but still inside iOS's own
     double-tap window isn't caught. iPadOS may allow a longer gap than the
     iPhone. Try ~500 ms (the guard replays the click, so a longer window
     costs nothing for ordinary taps).
  2. **Distance:** the iPad's bigger screen and bigger targets mean two taps
     of a "double tap" can land more than 30 px apart (or the finger moves
     ≥30 px during a tap, which resets the guard). iOS's own tolerance is
     larger; try ~45–60 px.
  3. **A resting second finger or palm** (common holding an iPad): the guard
     treats any touch with another finger down as "moved" and resets, so the
     next double tap isn't caught.
  4. **Taps outside the board,** in the side margins (on an iPad the page is
     much wider than the 520 px column, finding 1) or on the gaps between
     keys. These are covered by `document`, but worth confirming in the test.
- **Recommended fix:** loosen `DOUBLE_TAP_MS` and `SLOP_PX` (gaps 1–2), and
  don't reset `last` because of a second resting touch (gap 3); extend
  `doubleTap.test.ts` for each case. Keep pinch-to-zoom working (an
  accessibility requirement: never use `user-scalable=no` /
  `maximum-scale=1`).
- **Owner's recording (`IMG_1727.mov`, 4.6 s, filmed from above):** iPad
  upright, single player vs. computer, **Easy**. One finger taps
  repeatedly on the **guess list's letter bubbles** (top left, around
  the PUPPY / BEACH / POACH rows), the hand held over the screen. After a
  few taps the page zooms in on the guess list.
  - On Easy those bubbles are **not buttons** (plain `<span>`s; only
    Medium makes them tappable), inside the scrolling `.history-wrap`. So the
    guard's replayed `click()` has nothing to click, and the
    `touchend` cancel is all that stops the zoom. That case (repeated taps
    on non-interactive content inside a scroll container) is the one to
    reproduce first.
  - Fingers held over the iPad like this can brush the glass, which would
    trigger gap 3 (a second touch resets the guard).
- **To narrow it down further, owner (next time it happens):** note where the taps
  landed (letter key, bubble, margins, the history) and whether the iPad was
  upright or sideways. A screen recording would show the timing.
- **Check afterwards:** on the iPad and iPhone, Medium: tap one letter
  bubble and one key rapidly 10+ times, then the margins: no zoom; pinch
  still zooms.

## Noted, no change (owner's decision)

- **Firefox asks to "store data in persistent storage"** (MacBook Air,
  Firefox, after finishing a game). Firefox is the only browser that asks;
  Chrome and Safari decide silently. The app asks on purpose when it first
  saves a game (`navigator.storage.persist()` in `src/app/historyDb.ts`,
  ~line 190), so the browser won't clear your game history to free space.
  **Owner: leave as is.** Saying Block is harmless: history still saves, it's
  just not protected from the browser's clean-ups.
