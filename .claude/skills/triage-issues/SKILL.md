---
name: triage-issues
description: Triage the open GitHub issues with the owner, then plan them. The issues live in the private archive repo (word-mastermind-archive) and the dev plan in this public one. Closes archive issues that merged PRs fixed, asks the owner's questions in batches, labels each archive issue with a severity, records the decisions as a comment there, groups the issues into right-sized PRs and adds them to docs/dev-plan.md in build order, in one docs-only PR here. Use when asked to review, triage or plan the open issues, or to add issues to the dev plan.
---

# Triage the open issues

The owner reviews from a phone and doesn't read code. Questions, issue
comments and the PR are all in plain words (CLAUDE.md "Working rules").

## Two repos

- **Issues live in the private archive**, `plangdon84/word-mastermind-archive`.
  The server files every report from the app there (`GITHUB_REPO` in
  `worker/wrangler.toml`), and its body can hold game data: a secret word,
  a Daily Rush answer, the player's display name, a screenshot. Issues are
  turned off in this public repo, so no issue is ever opened or copied here.
- **The plan lives here**, in `docs/dev-plan.md` of the public
  `plangdon84/word-mastermind`, and so does every PR.
- The session needs both repos. If the archive isn't in it, add it
  (`add_repo`, owner `plangdon84`, repo `word-mastermind-archive`, access
  push) before starting.
- **Cite archive issues in full** in anything written here (the plan, PRs,
  commits): `plangdon84/word-mastermind-archive#166`. A bare `#166` here
  means this repo's own #166, which is some other PR; where a full link is
  too long (a bullet inside an item), write `Issue 166`, with no `#`. The plan's items
  written before the move (8 October 2026) cite archive issues as bare
  `#N`; leave those as they are.
- **Nothing from an issue's body is copied here.** Write each plan bullet in
  your own words, about the behaviour. Never put in the plan, a PR or a
  commit: a secret word or guess from a report, a Daily Rush theme or its
  words, a player's name, a report or screenshot link, a guest ID, friend
  game ID, join code or invite key (CLAUDE.md "Daily Rush", "Report an
  issue"). The archive's own comments may name what they need to, since the
  archive is private, but still never repeat an ID, code or key.

## 1. Gather

- List every open issue in the archive (`list_issues`, state OPEN), with
  bodies, labels and comments.
- **Close what's already fixed.** Read the **Done** items of
  `docs/dev-plan.md` and every merged PR here since the last triage
  (`list_pull_requests`, state closed, merged). An open archive issue that
  a Done item or a merged PR's **Scope** names as fixed (`Closes
  plangdon84/word-mastermind-archive#N`) is closed now as completed
  (`issue_write`, `state_reason: completed`), with a comment naming the
  public PR in full (`plangdon84/word-mastermind#N`), and isn't triaged
  again. One the PR names as `Part of` stays open. Note any GitHub already
  closed on merge: if none were, the full-form `Closes` line doesn't close
  across repos, and this step is the only thing that does.
- Read `docs/dev-plan.md`, its **To build** section especially. Note which
  issues an item already cites: those are **already planned**, and only
  need their open questions settled.
- For each new issue, look at the code it touches (a quick grep is enough)
  so that each question names what is really there. Examples: which button
  exists today, whether a word is on the secret list and why, which host
  the old site is on, and what the platform allows (a web app can't read an
  iPhone's contacts or set a dark home-screen icon).
- A report's screenshot is linked in its body; open it only if the
  description isn't enough to understand the issue.
- Note what each issue would touch: `worker/`, sign-in, sync or secrets put
  it under the review gate, and anything a player can see of another player
  is a privacy question.

## 2. Ask the owner

Use `AskUserQuestion`, at most 4 questions per call, in as many calls as
needed. Ask the questions for every issue before writing anything.

- Ask only what CLAUDE.md says the owner decides: how the game behaves for
  players (rules, scoring, what a tap does, what others can see, who can do
  what), privacy, money and security. Settle pure design (colours, layout,
  wording) yourself with the recommended option, and record it as a choice
  the owner can change.
- Put the recommended option first, labelled "(Recommended)". Each option's
  description says what the player would see, plus the cost or catch (for
  example "it tells strangers who plays").
- Include the questions an issue itself leaves open (an "Open questions"
  section), and the ones an already-planned item still has.
- Read each answer for what it actually says. A free-text answer often adds
  a new rule, or a follow-up question worth asking in the next batch.
  Record the owner's own wording of a rule, not your option's.

## 3. Label and comment on each archive issue

- Set a severity label, keeping the existing labels. `issue_write` replaces
  the whole list, so pass the old labels too:
  - `severity: high`: players are losing something now, or it's urgent
    (data, access, a move of address)
  - `severity: medium`: a bug or a misleading control, or a feature many
    players would use
  - `severity: low`: polish, word-list tweaks, tooling, testing aids
- Post one comment per issue, in the archive: `**Triage (date):
  severity X.**`, the Dev Plan item it's in, and the decisions as short
  bullets. A split issue says which part goes where. End with the
  attribution footer. Never repeat a guest ID, friend game ID, join code or
  invite key from an issue body.

## 4. Group into PRs

- One feature, or at most about five small issues, per item (CLAUDE.md
  "Keep PRs small"). Bundle small app-only fixes together. Give a feature
  with server work its own item, since it takes the review gate.
- Keep app-only work apart from `worker/` work, so the small items skip the
  review gate.
- Merge issues that are the same feature (for example a rematch button
  asked for twice). Split an issue whose parts differ in timing (for
  example one part waits on a switched-off mode).
- Order: urgent and high first; then anything later items build on (for
  example release notes before the features that need notes); then player
  features by value; then testing aids and tech debt. Anything that costs
  money goes under **Later**.

## 5. Update `docs/dev-plan.md` (public)

- New items take the next free letter after the last item (18f, 18g, …).
  Never renumber.
- Each item reads: `- [ ] **18x. Title** (issues
  plangdon84/word-mastermind-archive#N and
  plangdon84/word-mastermind-archive#M; app only / worker, review gate)`,
  every issue in full, then one bullet per commit, in plain words, with
  each decision written in. A bullet for one issue starts `- Issue N: …`,
  with no `#`, so it doesn't link to this repo's own #N.
- Put the items under **To build**'s **Next, in this order**, in build
  order, since "the next PR" is the first unchecked item. Rewrite already-planned
  items with their decisions, and move items between **Next** and
  **Later** as the order needs.
- If a decision changes a game rule, the item says the README section it
  updates. Don't edit the README rules in this PR.
- Re-read the diff before committing for anything from an issue body that
  doesn't belong in public (see "Two repos").

## 6. Open the PR (public)

- Branch from the latest `main` (`claude/issue-triage-<date>`). Change only
  Markdown (`docs/dev-plan.md`, and the README or CLAUDE.md if needed), so
  CI skips the browser tests. A `.ts` file, even a comment, starts them.
- Commit, push, and open the PR as ready (docs only, no review gate). Fill
  in `.github/pull_request_template.md`: the scope lists each new or
  changed item and its archive issues in full; **Choices made** has the
  severities, the grouping and any design defaults; risk is Low; Reviews:
  "Not needed (Low risk)". Never write `Closes` or `Fixes` before an
  issue: planning an issue doesn't fix it, and those words would close it
  on merge.
- Subscribe to the PR. Give one-line status updates until it merges.

## 7. Report back

Reply with a table of the items in order (item, archive issues, review gate
or not), the severities, the issues closed in step 1 and the choices the
owner can change on the PR.
