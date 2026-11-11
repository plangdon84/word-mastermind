---
name: execute-stack
description: Coordinate a release stack planned in docs/dev-plan.md (a **Stack** block written by /plan-stack). Opens the release PR, starts one cloud session per item PR (in waves, or one at a time), tracks each item PR until it is ready to merge into the release branch, keeps the dev plan and release PR up to date as items merge, then runs the whole-stack review and hands the release PR to the owner. Use when asked to execute, run or coordinate a stack or a stacked release, or when "start the next dev item" lands on an item inside a Stack block.
---

# Execute a stack

This session is the **coordinator**. It never builds an item: each item is
built in its own cloud session (an **item session**) and its own PR into
the release branch. The coordinator owns the release PR, the dev plan and
the release note. The owner merges every PR; the coordinator says when
each is ready.

## 0. Read the stack

- Fresh `main`: `git fetch origin main`. Read `docs/dev-plan.md` and find
  the **Stack <version>** block (the one named, else the first whose items
  are unchecked). Read its bullets by their opening words:
  - **Release PR**: "not opened yet", or the branch (and PR number) of a
    stack already under way. If under way, go to "Resuming" below.
  - **Items, in merge order**
  - **Threads**: `single`, or `waves` with one line per wave and what it
    waits for
  - **Release note**: the lines and the date the owner OK'd them
  - **Migrations**: which item takes which number
  - **Review**: whole stack on the release PR, or none
- Read each item's own entry for its bullets, gate and issues.
- If a field is missing or the release note has no OK date, stop and ask
  the owner (or suggest `/plan-stack`); don't guess. The release note
  needs the owner's OK before the first commit (CLAUDE.md).

## 1. Open the release PR

- The release branch is this session's designated branch if it has one,
  else `claude/release-<version>` from `origin/main`.
- First commit, alone:
  - The release in `src/app/releases.ts`, exactly the OK'd lines.
  - The block's **Release PR** bullet: the branch name ("Release PR:
    branch `<branch>` into `main`. Each item is its own PR into that
    branch, never into `main`").
  - `npx vitest run src/app` and `npm run typecheck` pass.
- Push, open a **draft** PR into `main` titled "Release <version>:
  <summary> (<items>)", filling in `.github/pull_request_template.md`,
  with this tracker at the top of What changed:

  ```markdown
  ### Stack tracker

  Merge order is fixed. An item PR is **ready to merge into <version>**
  when its tests and typecheck pass, its browser tests for what it touched
  pass in Chromium and WebKit, it's marked ready and CI is green, and every
  item before it is merged.

  | Order | Item | Wave | PR | Session | Status |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 19zj. <title> | 1 | — | <session id> | Building |
  ```

  Status is one of: **Waiting** (its wave hasn't started), **Building**,
  **Draft #N**, **Ready to merge**, **Merged**, **Blocked** (and why).
  Choices made records the threads, the reserved migrations, and that the
  item PRs add no release note and don't edit the plan. Reviews: "Starts
  once every item is merged."
- Subscribe to the release PR (`subscribe_pr_activity`). The item PRs are
  watched by their own sessions, not here.

## 2. Start the item sessions

- **Waves**: start every wave 1 item now; a later wave's items when
  everything its wave line waits for is **Merged**.
- **Single**: start the first item; start each next one when the one
  before it is **Merged**.
- One `create_session` per item: `source_url` this repo,
  `source_revision` the release branch, `outcome_branch`
  `claude/<version with dashes>-<item>` (e.g. `claude/2-7-2-19zj`),
  `tags` `["stack:<version>"]`, title "<version> stack: <item> (into
  #<release PR>)", and the prompt below with its blanks filled in. Put
  each session ID in the tracker.

```text
You are building Dev Plan item <ITEM> of the <VERSION> stack in plangdon84/word-mastermind. A coordinator session (<COORDINATOR SESSION ID>) runs the stack and its release PR, #<PR> (branch `<RELEASE BRANCH>`). Your own branch is `<ITEM BRANCH>`.

Read CLAUDE.md, then `docs/dev-plan.md` on the release branch: the **Stack <VERSION>** block and item <ITEM>'s bullets are your spec. Follow CLAUDE.md's working rules, with these stack rules on top:

1. Start from the release branch: `git fetch origin <RELEASE BRANCH>` and branch your own work from `origin/<RELEASE BRANCH>`. Your PR's base is `<RELEASE BRANCH>`, never `main`.
2. Release note: the owner already OK'd the stack's note (<DATE>) and it lives in the release PR. Your PR adds none: never edit `src/app/releases.ts`. Its **Release note** section says: "None here: <VERSION>'s note is in #<PR>." You don't need to wait for the owner's OK before your first commit.
3. Don't edit `docs/dev-plan.md`: the release PR ticks your item. Other docs (CLAUDE.md, README, worker/README.md, the privacy page) you change as the item needs.
4. <MIGRATIONS: "Migrations: your item takes migration `<NNNN>` (the release PR reserved it); add its table to `WIPE_TABLES` or `KEEP_TABLES`." or "Migrations: if you find you need one, ask the coordinator for the number first.">
5. Open a draft PR after your first commit (title "<VERSION> (<ITEM>, into #<PR>): <title>"), fill in every section of `.github/pull_request_template.md` in plain words, and subscribe to it. <REVIEW: "The stack is reviewed as a whole on #<PR>, so your PR skips the review gate: its Reviews section says "On #<PR>, over the whole stack."" or, for a stack with no review, "Reviews: Not needed (Low risk).">
6. Questions about how the game behaves for players, security or money: ask the owner, and also tell the coordinator (send_message to <COORDINATOR SESSION ID>). Design defaults: pick the recommended option and list it under **Choices made**.
7. Done means: `npm test` and `npm run typecheck` pass; the browser tests for what you touched pass in Chromium and WebKit in this session (`npx playwright test e2e/<file>`; install WebKit per docs/test-plan.md); `npm run load-test` if your item says so. Then mark the PR ready (this starts the browser tests in CI) and, once CI is green, send the coordinator one message: "<ITEM> ready to merge into <VERSION>: PR #N, CI green." Don't merge it yourself: the owner merges in the stack's order.
8. Other items are merged into the release branch while you work (<PEERS: "same wave: 19zk, 19zl" or "single thread: the items before yours are merged">). When the coordinator tells you one merged, or before you mark ready, merge `origin/<RELEASE BRANCH>` into your branch (a merge, never a rebase or force-push), resolve any clash keeping both items' behaviour, rerun the tests, and push.
9. After your PR merges into the release branch, stop: unsubscribe from it and reply to the coordinator "<ITEM> merged."
```

- Then set one fallback check-in (`send_later`, about 2 hours) and end
  the turn. Item sessions and PR events wake this session; never poll.

## 3. Track

The coordinator is woken by an item session's message, an event on the
release PR, or its check-in.

- **"<item> ready to merge"**: check it before saying so to the owner:
  the PR's base is the release branch; `get_check_runs` is green on its
  head; it touches neither `src/app/releases.ts` nor `docs/dev-plan.md`;
  every item before it in merge order is **Merged**. Then set **Ready to
  merge** and tell the owner one line: "<item> (PR #N) is ready to merge
  into <version>." If an earlier item isn't merged yet, say it's ready
  but waits for that one, and tell the owner which to merge first.
- **A question or a block** from an item session: if it's the owner's to
  decide (rules, security, money), relay it in plain words, once; add it
  to the release PR's **Decisions needed before review**. A migration
  number request: give the next free one and record it in the block.
- **"<item> merged"** (or a check that finds its PR merged): on the
  release branch, `git pull`, then in one commit:
  - tick the item in `docs/dev-plan.md` and move it to the top of
    **Done**, adding "(PR #N)";
  - nothing else. Push.

  Then update the release PR: the tracker row, a `Closes
  plangdon84/word-mastermind-archive#N` line under Scope for each archive
  issue the item fully fixed (a `Part of` line for one partly fixed), and
  its preview checklist lines. Send every item session still building
  "<item> merged into <version>: merge `origin/<release branch>` into
  your branch." Start any wave (or the next single item) now unblocked.
  Archive the merged item's session once it replies.
- **A check-in with no news**: `get_session` and `list_events` for each
  item still building. A session whose last turn failed, or that's idle
  without its PR ready, gets one nudge (`send_message`); a second
  failure is **Blocked** and goes to the owner. Set the next check-in.
- **The release PR's CI red**: it should only ever hold merged items, so
  find which merge broke it, tell that item's session (or, once archived,
  fix it on the release branch) and say so in one line.
- Status updates to the owner are one line (CLAUDE.md "Keep PR status
  updates to one line").

## 4. Review the whole stack

Once every item is **Merged** (skip this for **Review: none**):

- Merge `origin/main` into the release branch if `main` moved; run
  `npm test` and `npm run typecheck`.
- Round 1 and round 2 exactly as CLAUDE.md "Review gate" and "Chain the
  review back" say, over the release PR's whole diff against `main`, each
  in a fresh session given this session's ID. Fixes are made on the
  release branch by this session (or a fresh session for a big one),
  never in the archived item sessions. Keep the Reviews table.

## 5. Hand over

- Run the browser tests for everything the stack touched, Chromium and
  WebKit, in this session. Fill in the release PR's preview checklist,
  Risk and Reviews, and mark it ready (this starts CI's browser tests and
  Lighthouse).
- When CI is green, tell the owner: "Release <version> (PR #N) is ready to
  merge into main." After it merges: close each archive issue it fixed by
  hand (CLAUDE.md "Close the issues a PR fixes"), unsubscribe, cancel the
  check-in, and archive any item session left.

## Resuming

A new or restarted coordinator rebuilds its state before doing anything:
the **Stack** block (release branch), the release PR (find it with
`list_pull_requests`, head the release branch), its tracker, every PR
into the release branch (`list_pull_requests`, base the release branch,
state all) and the item sessions (`list_sessions`, tag
`stack:<version>`). The PRs and the branch are the truth; fix the tracker
to match, re-subscribe to the release PR, and carry on from step 3.

## Never

- Never build an item in the coordinator, or let an item PR into `main`.
- Never merge a PR: the owner merges.
- Never put a release note in an item PR, or let an item edit the plan.
- Never start an item before what its wave (or the single order) waits
  for is merged.
- Never rebase or force-push the release branch or an item branch.
