<!-- The owner reviews from a phone and doesn't read diffs. Write every section in plain words, with no code. -->

## What changed

<!-- Two or three sentences a player would understand. Name the Dev Plan item if there is one. -->

## Scope

<!-- The issues or the one feature this PR covers, one line each. More than about five is too big: split it (CLAUDE.md "Keep PRs small").
Then one "Closes #N" line per issue this PR fully fixes, so GitHub closes it on merge ("Closes #1, #2" closes only #1). An issue only partly fixed gets "Part of #N" instead. A PR that only plans issues closes none (CLAUDE.md "Close the issues a PR fixes"). -->

- 

Closes #

## Release note

<!-- A change players can see bumps the version in src/app/releases.ts (1.1.0 for a feature, 1.0.1 for a fix): give the new version and its one-line notes exactly as players will read them. Otherwise write "None (nothing players see)". -->

## Decisions needed before review

<!-- Questions about how the game behaves for players (game rules, scoring, what a tap does, what others can see), asked and answered BEFORE the review starts. Write "None" if there are none. -->

## Try it on the preview

<!-- A tap-by-tap checklist for the Cloudflare preview link, ending in what you should see. -->

- [ ] 

## Choices made

<!-- Every design question you settled with a default, so the owner can accept or change it. Write "None" if there were none. -->

## Risk

<!-- Low (UI or docs only), Medium (game rules, saved data, the app's storage) or High (worker, database changes, sign-in, sync, secrets), and why. -->

## Reviews

<!-- For Medium and High risk: at most two rounds (CLAUDE.md "Review gate"). Keep this table up to date; round 2 starts from it. Write "Not needed (Low risk)" otherwise.
Outcome is one of: fixed (commit), accepted as is (why), owner decision (see Choices made), issue #N. -->

| Round | Commits | Finding | Severity | Outcome |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |

<!-- CI: the quick checks run on every push; the browser tests and Lighthouse run once the PR is marked ready. -->
CI: 
