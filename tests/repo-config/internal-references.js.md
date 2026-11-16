# internal-references.js

## Purpose

The line matcher and the diff reader behind the repo-config guard `internal-references.test.js`: it fails when a branch ADDS a line that points into the project's private working material, which a reader of this public repository cannot follow.

## What it checks

Five patterns, each a small reviewed regex in `PATTERNS` with a why-comment:

- **owner reference** - the definite article before the word for whoever owns the project, or its possessive, as a reference to a person who decides. Case-insensitive, word-bounded.
- **decision code** - the code form private plans number their decisions with (`DE` + `C-`, an upper-case part, an optional number). Case-sensitive. The older ceiling guard `no-decision-codes.test.js` counts these over the whole tree; this guard stops them on any added line.
- **work-branch number** - an `r` followed by a branch number, as a word.
- **pull-request number** - the words for a pull request followed by `#` and a number, or a number in parentheses after `#`.
- **review reference** - "review" followed by a branch number.

## Why only added lines

The existing lines (about 1,400 files on main on 2026-11-16) stay as they are, by decision: rewording them all would be several large comment-only batches with a high review cost and a low risk. The guard stops the count from growing, so the backlog only shrinks as files are rewritten for their own reasons.

## How the base is found

`resolveBase` picks the commit the added lines are counted against, in this order:

- `E2E_TIER_BASE`, which CI's "Fetch the tier's base" step fills in and fetches (`.github/workflows/ci.yml`): on a pull request the base commit (the checkout is the merge commit, so the diff is exactly the pull request's change); on a dispatch, every tier, the merge base with main from the API. A local `test:changed --ref` sets it too.
- Locally, the merge base of `HEAD` with the first of `origin2/main`, `origin/main`, `main` that has one (`MAIN_LINES` and `firstMergeBase` from `scripts/test-changed/select.mjs`).
- Otherwise there is no base, and the guard is a **named skip**, never a pass: it writes `internal-references: SKIPPED - <reason>` to stderr and the skipped test's name carries the reason. In CI that is a push to main, whose lines were checked on their pull request.

When it runs, it writes one evidence line to stderr: `internal-references: diffing against <commit> (<source>): <n> added lines, <m> hits`.

`addedLines` diffs the WORKING TREE against the base (`git diff --unified=0 --find-renames`), so an uncommitted edit is seen before its commit, and a moved file adds nothing; every line of an untracked, not-ignored file counts as added, because `git diff` never lists those.

## Exclusions, and the measurement behind them

Paths no pattern reads: licence and notice texts (`LICENSE`, `NOTICE`, `COPYING`, `THIRD_PARTY*`), `third-party-licenses/`, lockfiles, `vendor/` folders, binary files, untracked files over 2 MiB.

Measured over every line of every tracked text file of main (1b1103375, 2026-11-16), lines matched before and after the exclusions, and the false positives among them (a hit that is not an internal reference, found by reading the hits):

- **owner reference:** 1,445 lines before, 12 false positives (10 in the two machine-lock files, which say it of a lock's process; 2 "...of a/its..." uses in code). After: 1,435 lines, 2 false positives. The two lock files are skipped for this pattern only; the 2 left are kept on purpose, since a phrase exclusion would also hide a real reference to the person.
- **decision code:** 2,778 lines, 0 false positives; no exclusion.
- **work-branch number:** 903 lines before, 40 false positives (three.js release names in the 180s, and preview host names in test data). After: 863 lines, 0. Numbers start at 300, and a number followed by the preview site's name is not matched.
- **pull-request number:** 1,071 lines before, 31 false positives (single-digit items of a numbered list, such as `(#1)`). After: 1,040 lines, 0. The parenthesised form needs two digits or more.
- **review reference:** 250 lines, 0 false positives; no exclusion.

CSS colours, identifiers with an `r` and digits inside them, H3 resolution words and the licence files had no hits.

## How to fix a hit

The failure names the file, the line number and the pattern, never the line itself. Say what the rule means in plain words, or point at a public file (a sidecar, a test, a doc in this repository). For example, instead of a decision code write the rule ("a deliberate copy, kept because the package cannot depend on the framework"); instead of a branch or review number write what was found or measured and, where it matters, the date. A word used in another sense (a lock's owning process) is reworded: "holder", "the process that holds it".

## Public API

- `PATTERNS` (module-private) - the list, each `{ name, regex, skipPath? }`.
- `matchLine(text, file?)` - the names of the patterns a line matches; empty for a skipped path.
- `isSkippedPath(file)` - true for the paths no pattern reads.
- `parseAddedLines(diff)` - `{ file, line, text }` for every added line of a unified diff; hunk lengths decide what is content.
- `resolveBase({ env, mergeBaseWith })` - `{ base, source }`, or `{ base: null, reason }`.
- `gitMergeBase(root)` - the `mergeBaseWith` for a real checkout.
- `addedLines(root, base)` - the working tree's added lines against `base`, untracked files included; throws when git cannot diff.
- `findHits(lines)`, `formatHits(hits)` - the hits and the failure message.

## Tests

- `internal-references.test.js` - positive and negative examples per pattern (the measured false positives among the negatives), the path rules, the diff parser, the base order, an end-to-end run on a throwaway repository with an injected base, and the guard itself over the branch.
- `internal-references.property.test.js` - a line without any pattern token never matches; a token set off by spaces in token-free text always does.
