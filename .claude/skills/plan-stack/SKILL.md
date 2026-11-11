---
name: plan-stack
description: Group the dev plan's unbuilt items (everything above **Later** in docs/dev-plan.md) into release stacks with the owner, and write each as a **Stack** block holding everything /execute-stack needs - the release version, items in merge order, single thread or waves, the owner's OK'd release note, reserved migration numbers and the review plan. One docs-only PR. Use when asked to plan a stack, plan releases, or group dev items into stacks.
---

# Plan a stack

A **stack** is one release built as several item PRs that each merge into
one release PR, which alone merges into `main` (as 2.4.0 did in #78 and
2.7.2 in #97). This skill plans stacks; `/execute-stack` runs them and
reads only what this skill writes, so every field below must be filled in.

The owner reviews from a phone and doesn't read code: questions and the PR
are in plain words (CLAUDE.md "Working rules").

## 1. Gather

- Fresh `main`: `git fetch origin main` and branch from `origin/main`
  (`claude/plan-stack-<version>`).
- Read `docs/dev-plan.md`. The candidates are the unchecked items under
  **To build** above the **Later** line. Items under **Later** are never
  stacked unless the owner moves them up. Skip items already in a
  **Stack** block.
- For each candidate, find the files it will touch: grep the names in its
  bullets (functions, tables, routes, screens). Note:
  - **Gate**: `worker/`, `worker/migrations/`, sign-in, sync or secrets put
    it under the review gate.
  - **Migration**: whether it adds a D1 table or column.
  - **Needs**: an item that uses another's work (a helper, a check, a
    table) or rewrites the same function needs it merged first.
  - **Overlap**: items that touch the same files but not the same
    functions can run side by side; the later one merges the release
    branch and resolves the clash.

## 2. Group into stacks

- One stack is one release. Keep app-only items apart from worker items
  where the split is clean, so the app-only stack skips the review gate.
- At most about six items in a stack; a bigger release is two stacks.
- **Merge order**: the plan's order, moved only where a **Needs** says so.
- **Threads**, recommend one:
  - **Waves** when at least two items have no **Needs** between them and
    touch mostly separate files. Wave 1 is every item that needs nothing
    else in the stack; each later wave holds the items whose needs are
    all in earlier waves. An item touching almost everything (a router,
    a shared helper every route uses) goes in the last wave alone.
  - **Single** (one item at a time, each starting after the one before
    merges) when the items form a chain, or most of them rewrite the same
    functions, or there are only two. Fewer sessions and no clashes, but
    slower.
- **Migrations**: give each item that adds one the next free number in
  merge order (the last file in `worker/migrations/` plus one, then
  upwards).
- **Review**: a stack with any gated item is reviewed once, as a whole, on
  the release PR after its last item merges (round 1 and round 2 per
  CLAUDE.md "Review gate"); its item PRs skip the gate. A stack with none
  has no review gate.

## 3. Ask the owner

`AskUserQuestion`, up to 4 questions a call, recommended option first,
labelled "(Recommended)". For each stack:

- The version (1.1.0-style for a feature, a patch for fixes only) and the
  items in it, with the merge order.
- **Single or waves**, with your recommendation and why (what overlaps,
  what needs what). Show the waves.
- **The release note**, every line exactly as players will read it. The
  repo is public: a security fix gets a generic line, never a description
  of the hole. Say which items get no line of their own. This is the
  owner's OK that CLAUDE.md requires before the first commit, so record
  the date.
- Any open question an item still has about how the game behaves.

Read each answer for what it actually says; a free-text answer may change
the grouping or add a rule. Record the owner's wording.

## 4. Write the Stack block

Under **To build**, above the stack's first item (and above **Later**),
one block per stack, in exactly this shape. `/execute-stack` parses these
bullets by their opening words, so keep them.

```markdown
**Stack 2.7.2** (planned with the owner on 11 November 2026; run by
`/execute-stack`)

- Release PR: not opened yet. Each item is its own PR into the release
  branch, never into `main`
- Items, in merge order: 19zj, 19zk, 19zl, 19zm, 19zo, 19zp. <why any
  item is moved from the plan's order>
- Threads: waves (owner, 11 November 2026)
  - Wave 1: 19zj, 19zk, 19zl, 19zm
  - Wave 2: 19zo, once 19zj and 19zl are merged into the release branch
  - Wave 3: 19zp, once every other item is merged
- Release note (OK'd by the owner, 11 November 2026), added by the
  release PR, never an item PR: "<line 1>", "<line 2>" ... <which items
  get no line of their own>
- Migrations: 19zk takes `0036`; an item that finds it needs one asks the
  coordinator for the next number
- Review: worker, so the review gate, run once on the release PR over the
  whole stack after the last item merges; item PRs skip it
- The release PR alone edits this plan and `src/app/releases.ts`: it
  ticks each item and moves it to **Done** as its PR merges
```

- **Threads: single** has no wave lines; the items run in merge order.
- A wave line names what it waits for ("once 19zj and 19zl are merged").
- **Migrations: none** when no item adds one.
- **Review: none (app only)** when no item is gated.
- **Release note: none**, with the reason, when nothing players see
  changes.
- Each item in the stack keeps its own entry, its header saying the
  version and its place ("2.7.2, first in its stack" / "stacked on
  19zj"), its bullets unchanged unless an answer changed them.
- The release plan's line for that version points at the block
  ("**2.7.2**: the stack below.").

## 5. Open the PR

Markdown only (`docs/dev-plan.md`, and CLAUDE.md or the README if an
answer changed a rule), so CI skips the browser tests. Commit, push, open
it as ready, filling in `.github/pull_request_template.md`: Scope lists
each stack and its items; Release note "None (planning only): the stack's
note is recorded in its block"; Choices made has the grouping, order and
threads; Risk Low; Reviews "Not needed (Low risk)". No `Closes` lines:
planning fixes nothing. Subscribe and give one-line updates until it
merges.

## 6. Report back

A table per stack: order, item, wave, gate, migration. Then the release
note as OK'd, and "Run `/execute-stack <version>` once this PR merges."
