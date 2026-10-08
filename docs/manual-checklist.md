# 1.0 manual checklist (Dev Plan item 17)

What the automated tests can't do (docs/test-plan.md section 7): real
phones, real notifications, a real Google account. Do it on the **staging
preview** (the branch preview link of the PR to be launched, or `main`'s
preview), which uses the staging server, never production's.

Tick each box, and write what went wrong under any that fails (or use
Report an issue from the app, which files it with the screen and device).

## Devices

- [ ] iPhone, Safari
- [ ] iPhone, the app added to the home screen (Share → Add to Home Screen)
- [ ] Android phone, Chrome
- [ ] iPad, Safari
- [ ] A computer: Chrome, Firefox and Safari

Run the sections below on each phone; on the iPad and computer, the
**Every device** section only.

## Every device

- [ ] The title screen, a single player game, the ☰ menu, the profile and
  a Solo Rush look right, upright and turned sideways
- [ ] Each mode starts and plays (vs. computer, Daily Rush, a friend game,
  a lobby)
- [ ] Report an issue with a screenshot: the issue appears on GitHub with
  the screenshot

## Phones

- [ ] **Double-tap on the board doesn't zoom** (iOS Safari, issue #39):
  tap the same letter quickly several times on Medium; the page must not
  zoom in. Pinching to zoom still works.
- [ ] **The phone's own keyboard** (the profile's name field, Rush with
  Friends' join code) doesn't hide what you're typing, and the page comes
  back when it closes
- [ ] **Largest text**: set the phone's text size to its largest (iPhone:
  Settings → Display & Brightness → Text Size; Android: Settings → Display
  → Font size), then every screen above still reads, nothing cut off
- [ ] **Screen reader**: with VoiceOver (iPhone) or TalkBack (Android) on,
  play a single player game to the end: each guess and its score is read,
  as are "Your turn" and the result
- [ ] **Share buttons** (a friend invite, a lobby, a result) open the
  phone's share sheet
- [ ] **Install**: Chrome offers to install the app (Android); once
  installed, or added to the home screen (iPhone), it opens full screen
  with its icon

## Turn notifications

On the iPhone (added to the home screen; Safari tabs can't get them), the
Android phone and a computer. On the preview, staging needs its own
notification key pair first (worker/README.md "Staging"): Profile →
Settings → Turn alerts must offer to turn them on, not say the server isn't
set up for them.

- [ ] Turn them on from a friend game; the browser asks once
- [ ] With the page closed, the friend guesses: a notification arrives
  within a minute
- [ ] Tapping it opens that game
- [ ] Turning them off stops them

## Signing in

- [ ] **Sign in with Google** on a phone and on a computer: you come back
  signed in, on the screen you left
- [ ] Your games and profile appear on the other device after signing in
  there
- [ ] Sign out: the profile goes back to a guest

## Friends playing on real phones

- [ ] A **live** friend game (5 minutes) between two phones: moves arrive
  within a second or two, both clocks run, the result shows on both
- [ ] A **correspondence** game (1 day): close the page between moves; the
  notification brings you back
- [ ] A **lobby** with friends on three or more phones, one on a weak
  connection (a lift, or the phone's network set to 3G): it keeps up, and
  catches up when the connection returns

## Server load on staging

Run by someone with the repository on a computer (any Claude Code session
whose network access reaches the staging server can do it):

```sh
npm run load-test -- --api https://word-mastermind-api-staging.paul-m-langdon.workers.dev --scale 0.1 --setup-rate 25 --concurrency 500
```

- [ ] It ends with "✓ No errors, and every kind of move within the target"
  (it takes about 10 minutes, most of it setting players up slowly enough
  for the server's rate limits)
- [ ] Wipe staging afterwards (`npm run wipe -- staging`, worker/README.md "Wiping game
  history"), so its leaderboards don't keep the test players
