---
name: triage-issues
description: Triage the open GitHub issues with the owner, then plan them. Asks the owner's questions in batches, labels each issue with a severity, records the decisions as a comment, groups the issues into right-sized PRs and adds them to docs/dev-plan.md in build order, in one docs-only PR. Use when asked to review, triage or plan the open issues, or to add issues to the dev plan.
---

# Triage the open issues

The owner reviews from a phone and doesn't read code. Questions, issue
comments and the PR are all in plain words (CLAUDE.md "Working rules").

## 1. Gather

- List every open issue in `plangdon84/word-mastermind` (`list_issues`,
  state OPEN), with bodies, labels and comments.
- An open issue that a merged PR fixed (its **Done** item cites it) is
  closed now as completed, with a comment naming the PR, not triaged
  again (CLAUDE.md "Close the issues a PR fixes").
- Read `docs/dev-plan.md`, its **To build** section especially. Note which issues an item
  already cites ("from issue #61"): those are **already planned**, and only
  need their open questions settled.
- For each new issue, look at the code it touches (a quick grep is enough)
  so that each question names what is really there. Examples: which button
  exists today, whether a word is on the secret list and why, which host
  the old site is on, and what the platform allows (a web app can't read an
  iPhone's contacts or set a dark home-screen icon).
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

## 3. Label and comment on each issue

- Set a severity label, keeping the existing labels. `issue_write` replaces
  the whole list, so pass the old labels too:
  - `severity: high`: players are losing something now, or it's urgent
    (data, access, a move of address)
  - `severity: medium`: a bug or a misleading control, or a feature many
    players would use
  - `severity: low`: polish, word-list tweaks, tooling, testing aids
- Post one comment per issue: `**Triage (date): severity X.**`, the Dev
  Plan item it's in, and the decisions as short bullets. A split issue says
  which part goes where. End with the attribution footer. Never repeat a
  guest ID, friend game ID, join code or invite key from an issue body.

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

## 5. Update `docs/dev-plan.md`

- New items take the next free letter after the last item (18f, 18g, …).
  Never renumber.
- Each item reads: `- [ ] **18x. Title** (issues #N, #M; app only / worker,
  review gate)`, then one bullet per commit, in plain words, with each
  decision written in.
- Put the items under **To build**'s **Next, in this order**, in build
  order, since "the next PR" is the first unchecked item. Rewrite already-planned
  items with their decisions, and move items between **Next** and
  **Later** as the order needs.
- If a decision changes a game rule, the item says the README section it
  updates. Don't edit the README rules in this PR.

## 6. Open the PR

- Branch from the latest `main` (`claude/issue-triage-<date>`). Change only
  Markdown (`docs/dev-plan.md`, and the README or CLAUDE.md if needed), so
  CI skips the browser tests. A `.ts` file, even a comment, starts them.
- Commit, push, and open the PR as ready (docs only, no review gate). Fill
  in `.github/pull_request_template.md`: the scope lists each new or
  changed item; **Choices made** has the severities, the grouping and any
  design defaults; risk is Low; Reviews: "Not needed (Low risk)".
  Cite issues as `#N` only, never `Closes #N` or `Fixes #N`: planning an
  issue doesn't fix it, and those words would close it on merge.
- Subscribe to the PR. Give one-line status updates until it merges.

## 7. Report back

Reply with a table of the items in order (item, issues, review gate or
not), the severities, and the choices the owner can change on the PR.
