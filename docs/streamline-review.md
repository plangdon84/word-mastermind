# Streamline review (Dev Plan item 14)

Every screen, the ☰ menu and the profile, walked on 30 September 2026 at
phone (390 × 844) and desktop (1280 × 800) widths, on a fresh guest who
unlocked each mode by playing it, with the local server for Daily Rush,
Rush with Friends and friend games. The lens: hierarchy, consistency, fewer
taps and words, one way to do each thing, and clear empty and error states.

Nothing here removes a feature. Each item has a number to answer by, what's
wrong, and what I recommend. Items marked **Your call** change how something
behaves in a way you may care about; the rest are tidying.

**Outcome:** the owner agreed the whole list on 30 September. Items 1, 7, 20,
22 and 26 were built in PR #69 and the rest in PR #70, with the tutorial's
steps and How to play brought in line. Item 16 needed no change (see there),
and 27 was no change by design.

Desktop: every screen is the same centred phone-width column. That reads
well and nothing breaks, so there's no desktop-only change.

## Home screen

1. **Games waiting on you are at the bottom.** "Online games" (with its
   "Your turn" tags) and "Rush invites" sit under the tutorial card and the
   links, below the fold on a phone. Move both up, right under Continue and
   above the modes. **Agreed; built.**
2. **"Continue game" doesn't say which game** when there's only one. Always
   name it: "Continue Daily Rush", "Continue single player".
3. **The last mode you played has a dark outline** on the home screen,
   which looks like a highlight or a focus ring but means nothing there.
   Keep the outline on the setup steps (where it marks the pre-selected
   choice) and drop it from the home screen.
4. **Leaderboards opens a page with one tile** at 1.0 (Daily Rush; the
   rating boards are switched off). While Daily Rush is the only board,
   open it directly: one tap less. The page comes back when a rating board
   is switched on.
5. **Locked modes say two things**: their description and how to unlock.
   Show only how to unlock (the description comes back once it's open), so
   the cards are shorter.

## Setting up a game

6. **Rush with Friends: "Open a lobby" is a one-choice card.** Make it a
   plain button, with "Or join one with its code" under it as now.
7. **Friend game timing: five cards, each with a tagline.** Make it two
   short groups: "Live" (15, 10 or 5 minutes each) and "Take turns over
   days" (1 or 3 days a guess), with the chess-clock note once. Same
   choices, fewer words. **Agreed; built.**

## Playing

8. **The line under the bubbles repeats the last guess's score**
   ("FIGHT shares 0 letters with the word.") right under the row that shows
   it. Keep that line for things you can't see elsewhere (an error, "Found
   GAWKS in 3 guesses", whose turn it is) and keep the score for screen
   readers only.
9. **Bug: Enter on a real keyboard doesn't always submit.** After you tap a
   button such as the You / Computer tabs, Enter presses that button
   again instead of sending your guess. Enter should send the guess.
10. **"New game" is the boldest thing in ☰**, a black button at the top,
    though it throws away the game you're in. Make it a plain button next
    to Give up and Exit.
11. **Two names for one thing**: ☰ says "Exit to main menu" and every end
    panel says "Main menu". Use "Main menu" in both.
12. **The word-list credit is in every ☰ menu** ("Definitions from Open
    English WordNet…"). Move it to How to play, where it's still shown to
    everyone but not on every open of the menu.
13. **Daily Rush ☰ shows the difficulty control greyed out.** Replace it
    with one line: "Medium: chosen for today's Daily Rush."
14. **Two player result says your guesses twice**: "You found its word in 3
    guesses" and then "You: 3 guesses". Drop the second line when it
    repeats the first.
15. **Rush result shows the same number three times** at Medium: Score 1.5,
    Avg guesses 1.5, and "1.5 guesses a word × 1 (Medium) = 1.5". Show Score
    and Your level, then one line: "6 guesses in 0:08 · 1.5 guesses and
    0:02 a word". The × factor line stays at Easy, Hard and Extreme, where
    it changes the number.

## Playing online

16. **Invites and lobbies only offer "Copy link".** On a phone, "Share"
    opens the share sheet (Messages, WhatsApp) in one tap; it falls back to
    copying where there's no share sheet. **Correction: no change.** Share
    (or Text it) is already there on phones; the review's desktop browser
    has no share sheet, so it didn't show.
17. **A lobby shows its join code twice**: the big code and a box with the
    full link. Keep the big code and the Share button; drop the link box.
18. **Closing your own lobby shows "This lobby is closed. You closed it…"**
    and a Main menu button. Go straight to the main menu.
19. **"Cancel invite" is a link but "Close lobby" is a button**, for the
    same kind of action. Make both buttons.
20. **Bug: "Rush with Friends · 1 players"** in the header. Fixed in this
    PR already: "1 player".

## Profile

21. **Page titles repeated as labels**: Account opens with "ACCOUNT", Game
    history with "GAME HISTORY", and Stats and achievements with
    "ANALYTICS". Drop the inner label.
22. **Stats and achievements is one very long page**: the stats, then all
    54 badges. Split it into two rows on the profile, **Stats** and
    **Achievements**; the badge toast opens Achievements. **Agreed; built.**
23. **Stats show a card for every mode, played or not** ("vs. a friend: No
    games yet.", Daily Rush, Rush with Friends). Show only modes you've
    played; with none, one line: "Play a game to see your stats."
24. **Friends, signed out, opens the Account page.** Leave the Friends row
    off until you sign in; Account already says "Sign in to play on any
    device and add friends".
25. **Help says "The tutorial, and reporting an issue"** but only has the
    "Show the tutorial on the home page" box and Report an issue. Add
    **Take the tutorial** and **How to play** buttons there.
26. **Difficulty is set in two places**: Settings' "Default difficulty"
    and the difficulty step before each game are the same setting (each
    changes the other). I recommend keeping both, and renaming the setting
    to "Difficulty for new games" with "Also changes when you pick one
    before a game". **Agreed; built.**
27. **Newest guess first is four checkboxes**, one per difficulty. Keep it
    (it was made per difficulty on purpose), no change unless you'd rather
    have one switch.
28. **Privacy policy and Terms of service** on the Account page are in the
    browser's plain blue, unlike every other link. Use the app's link
    style.

## How to play and the tutorial

29. **How to play leaves out Rush with Friends and playing a friend** (live
    clocks, turns over days), and its order (Solo Rush, Daily Rush, then
    Two player) doesn't follow the home screen. Order it like the home
    screen: the basics, difficulty, single player, two player (the
    computer, a friend), then each Rush.
30. **The tutorial's box changes height from step to step**, so Next jumps
    up and down under your thumb. Give it one height so Next stays put.

Once the changes are made, the tutorial's steps follow them (the ☰ step for
10–12, and any screen whose mock-up changes).
