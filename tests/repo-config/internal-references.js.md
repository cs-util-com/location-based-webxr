# internal-references.js

## Purpose

The line matcher and the diff reader behind the repo-config guard `internal-references.test.js`: it fails when a branch ADDS a line that points into the project's private working material, which a reader of this public repository cannot follow.

## What it checks

Five patterns, each a small reviewed regex in `PATTERNS` with a why-comment:

- **owner reference** - the word for whoever owns the project as a reference to a person who decides: with the definite article; as a possessive, unless another word stands right before it; as a possessive after any word when a decision noun follows; or followed by a decision noun or verb. The decision nouns (`DECISION_NOUNS`): `decision`, `decisions`, `feedback`, `pick`, `verdict`, `answer`, `choice`, `call`, `question`, `request`, `approval`, `interview`, `report`, `rule`, `taste`, `default`, `bug`. The verbs (`DECISION_VERBS`): `chose`, `asked`, `said`, `decided`, `wants`, `approved`, `reported`. And the German word with an article, in any of its endings (`-in`, `-innen`, `-n`, `-s`) and in the spelling without the umlaut. Case-insensitive, word-bounded. A role named with another word before it does not match, possessive included, unless a decision noun follows: the contributor agreement's project role, a copyright holder's licence and a lock's process pass, while a repository's or a project's role followed by its decision or its call is a hit. The cost: a possessive after a plain preposition, followed by any other word, passes too; main has none.
- **decision code** - the code form private plans number their decisions with (`DE` + `C-`, an upper-case part, an optional number). Case-sensitive. The older ceiling guard `no-decision-codes.test.js` counts these over the whole tree; this guard stops them on any added line.
- **work-branch number** - an `r` followed by a branch number, as a word.
- **pull-request number** - case-insensitive: the abbreviation or its plural followed by `#` and a number, with or without a space, and the words spelled out (`pull request #`, `pull requests #`); a number after `#` in parentheses, alone, first in a list, first of a pair joined by `and`, or after `see` (two to five digits, and not exactly three repeated digits, which is how the short decimal-only CSS grey reads, also as the first of a pair of greys); a four-digit CSS colour with alpha written in decimal digits only is matched, an accepted false positive, because it is the length of a pull-request number (main has none); `#` and three or more digits followed by `review`, with the possessive (either apostrophe), `cold` or `re-` forms; `review on #`, `reviewed on #` or `bot on #` and two or more digits; a `pull/` path with a number, as a bare word or in a link to this repository or to its private sibling repository. A link to another project's pull request passes: it is documentation.
- **review reference** - "review" followed by a branch number.

## Why only added lines

The existing lines (about 1,400 files on main on 2026-11-16) stay as they are, by decision: rewording them all would be several large comment-only batches with a high review cost and a low risk. The guard stops the count from growing, so the backlog only shrinks as files are rewritten for their own reasons.

## How the base is found

`resolveBase` picks the commit the added lines are counted against, in this order:

- `E2E_TIER_BASE`, which CI's "Fetch the tier's base" step fills in and fetches (`.github/workflows/ci.yml`): on a pull request the base commit (the checkout is the merge commit, so the diff is exactly the pull request's change); on a dispatch, every tier, the merge base with main from the API. A local `test:changed --ref` sets it too.
- Locally, the merge base of `HEAD` with the first of `origin2/main`, `origin/main`, `main` that has one (`MAIN_LINES` and `firstMergeBase` from `scripts/test-changed/select.mjs`).
- Otherwise there is no base, and the guard is a **named skip**, never a pass: it writes `internal-references: SKIPPED - <reason>` to stderr and the skipped test's name carries the reason.
- In CI (`GITHUB_ACTIONS`) a base that is HEAD itself is a named skip too. That is a run on main's own commit, a push to main or a dispatch on it: `ci.yml` runs on a push only for main, the push has no `E2E_TIER_BASE`, and actions/checkout makes the checkout's `origin/main` ref equal HEAD, so the merge base is HEAD and the diff would be empty; a dispatch on main resolves its base to main's own commit the same way. Those lines were checked on their pull request. Outside CI a base equal to HEAD is kept, because the working tree's uncommitted and untracked lines are still read.
- In CI a HEAD that `gitHead` could not read (null) is a named skip as well, since the case above could then not be told apart from a real base. Outside CI it does not matter and the base is kept.

When it runs, it writes one evidence line to stderr: `internal-references: diffing against <commit> (<source>): <n> added lines, <m> hits`.

`addedLines` diffs the WORKING TREE against the base (`git diff --unified=0 --find-renames`), so an uncommitted edit is seen before its commit, and a moved file adds nothing; every line of an untracked, not-ignored file counts as added, because `git diff` never lists those.

## Exclusions, and the measurement behind them

Paths no pattern reads: licence and notice texts by their exact upper-case names with no extension (`LICENSE`, `LICENCE`, `NOTICE`, `COPYING`, `THIRD_PARTY*`), so a source file such as `src/ui/notice.ts` is still read; `third-party-licenses/`; lockfiles; binary files; untracked files over 2 MiB. There is no `vendor/` rule: the one folder of that name (`GpsPlusSlamJs_Globe/src/vendor/`) holds a project-written module, its sidecar and its test, not a third-party copy.

Measured over every line of every tracked text file of main (1b1103375, 2026-11-16), lines matched before and after the exclusions, and the false positives among them (a hit that is not an internal reference, found by reading the hits):

- **owner reference:** with the article and the possessive only: 1,445 lines before, 12 false positives (10 in the two machine-lock files, which say it of a lock's process; 2 "...of a/its..." uses in code). After: 1,435 lines, 2 false positives. The two lock files are skipped for this pattern only; the 2 left are kept on purpose, since a phrase exclusion would also hide a real reference to the person. With the word-plus-action forms and the German form added: 1,852 lines before, 1,842 after the exclusions (407 more), no new false positive found (every form below `decision` read in full, the `decision`, `asked` and `chose` hits by a sample and a search for code senses such as a lock's or a file's owner). The German form has no hit on main; the bare German word has 2, both an inscription in OSM test data, which is why it needs an article.
- **decision code:** 2,778 lines, 0 false positives; no exclusion.
- **work-branch number:** 903 lines before, 40 false positives (three.js release names in the 180s, and preview host names in test data). After: 863 lines, 0. Numbers start at 300, and a number followed by the preview site's name is not matched.
- **pull-request number:** 1,071 lines before, 31 false positives (single-digit items of a numbered list, such as `(#1)`). After: 1,040 lines, 0. The parenthesised form needs two digits or more. With the further forms: 1,081 lines, 0 false positives; the 41 new lines are 36 `#<n> review` forms and 5 parenthesised lists, every one read. No lower-case, no-space or `pull/` form is on main yet. The colours in parentheses on main all carry a hex letter (`(#171b26)`); the repeated-digit and five-digit limits cover the decimal-only greys a later line might write.
- **review reference:** 250 lines, 0 false positives; no exclusion.

Re-measured with the widened forms over every tracked text file of main on 2026-11-16 (65d7ee36a), after the exclusions, old forms against new, each new hit read in full:

- **owner reference:** 1,833 lines before, 1,860 after. 28 new lines (the question, request, approval, interview, wants forms), all references to the person; 1 line dropped, the possessive after another word, which was a false positive (a storage layout's process). The German endings and the spelling without the umlaut have no hit on main. Left unmatched: about 600 lines with the bare word, most of them the word at a line's end or before punctuation (about 320), then the plural `decisions` (31), `report` (24), `rule` (18), `reference` (18) and `taste` (17); the code senses (`of`, `is`, `has`) sit among them, which is why the list of following words stays explicit rather than open.
- **pull-request number:** 1,081 lines before, 1,168 after. 87 new lines, all references to this repository's pull requests: 3 of the plural abbreviation, 84 of the `review on #` and `bot on #` forms. The spelled-out words, the `and` and `see` pairs, the `cold` and `re-` forms, the typographic apostrophe and the private sibling's link have no hit on main. The `#<digits>` lines still unmatched that were read are CSS colours, HTML entities, page anchors and upstream issue numbers.
- **decision code**, **work-branch number** and **review reference** are unchanged (2,767, 863 and 250 lines).

Re-measured again on 2026-11-17 (bad7bca43), after the exclusions, with the decision nouns added and the gated possessive, every new hit read in full and the old and new matcher compared line by line:

- **owner reference:** 1,860 lines before, 1,970 after: 110 new hits, 0 lost. 109 are references to the person: the plural `decisions` (31), `report` (24), `rule` (18), `taste` (17), `default` (8), `bug` (7) and `reported` (4). The 110th is a former pass case in `internal-references.test.js` that this round changed. The possessive gated on a decision noun has no hit on main: the 5 possessives after another word on main are the legal role, the copyright holder and the lines about a dead lock's holder, which still pass. Keeping the ungated possessive at a line's start matters: without it 43 real hits on main would pass (the line-start possessive followed by a phone, an eye, a look and so on). `reference` is not a decision noun: its 17 lines on main are this guard's own pattern name. Lines with the bare word that still pass: 603 before, 493 after; the largest groups are the word at a line's end or before punctuation (299), then `of` (17), the pattern name (17), `is` (15) and the word inside a document's file name (23 or more).
- **pull-request number:** unchanged at 1,168. The grey pair joined by `and` had no hit on main.
- **decision code**, **work-branch number** and **review reference** are unchanged (2,767, 863 and 250 lines).

CSS colours, identifiers with an `r` and digits inside them, H3 resolution words and the licence files had no hits.

## How to fix a hit

The failure names the file, the line number and the pattern, never the line itself. Say what the rule means in plain words, or point at a public file (a sidecar, a test, a doc in this repository). For example, instead of a decision code write the rule ("a deliberate copy, kept because the package cannot depend on the framework"); instead of a branch or review number write what was found or measured and, where it matters, the date. A word used in another sense (a lock's owning process) is reworded: "holder", "the process that holds it". A textual reference to an upstream project's pull request, such as three.js's pull request `#` and its number in words, is flagged like one of ours; write the upstream link instead (the full URL to that project's pull request), which passes and lets the reader follow it.

## Public API

- `PATTERNS` (module-private) - the list, each `{ name, regex, skipPath? }`.
- `matchLine(text, file?)` - the names of the patterns a line matches; empty for a skipped path.
- `isSkippedPath(file)` - true for the paths no pattern reads.
- `parseAddedLines(diff)` - `{ file, line, text }` for every added line of a unified diff; hunk lengths decide what is content.
- `resolveBase({ env, mergeBaseWith, head? })` - `{ base, source }`, or `{ base: null, reason }`. `head` is HEAD's full commit id, or null (the default) when it could not be read; in CI a null `head`, or a base equal to it, is a named skip.
- `gitHead(root)` - HEAD's full commit id in `root`, or null when git cannot read it.
- `gitMergeBase(root)` - the `mergeBaseWith` for a real checkout.
- `addedLines(root, base)` - the working tree's added lines against `base`, untracked files included; throws when git cannot diff.
- `findHits(lines)`, `formatHits(hits)` - the hits and the failure message.

## Tests

- `internal-references.test.js` - positive and negative examples per pattern (the measured false positives among the negatives), the path rules, the diff parser, the base order, an end-to-end run on a throwaway repository with an injected base, and the guard itself over the branch.
- `internal-references.property.test.js` - a line without any pattern token never matches; a token set off by spaces in token-free text always does.
