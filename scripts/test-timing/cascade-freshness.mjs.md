# `cascade-freshness.mjs`

## Purpose

Answers one question for `push-and-branch`: **has the once-per-session full
cascade (DEC-G3) actually run for what is about to be pushed?**

It exists because DEC-G3 was otherwise the only part of the 2026-08-15 gate
change with no feedback of any kind. Skipping a 23-minute command produces no
error — just a branch published on less evidence than the process claims. The
timing artefact already records the git SHA of every cascade, so the check needs
no new bookkeeping.

## Public API

- `assessCascadeFreshness({ cascadeSha, shaKnown, changedSince })` →
  `{ fresh: boolean, reason: string }` — the pure decision.
- `newestCascadeSha(markdown)` → `string | null` — the SHA of the newest `total`
  row in a `docs/test-timings.md`.
- CLI: `node scripts/test-timing/cascade-freshness.mjs` from the webxr root.
  **Exit 0** = fresh or exempt, **exit 1** = stale (with the reason on stderr).

## Invariants & assumptions

- **Markdown-only changes since the cascade are EXEMPT**, and this is
  load-bearing rather than a convenience. A session ends with doc commits — the
  summary, the decision doc — and `push-and-branch` itself auto-commits the
  `docs/test-timings.md` churn the cascade produced. Without the exemption the
  check would fail every session, and a check that always fails is one that
  always gets bypassed.
  - The exemption is **all-or-nothing**: one non-markdown file among fifty
    markdown ones is stale. "Mostly docs" is how an exemption becomes a hole.
  - Case-insensitive, so `.MD` counts.
- **A recorded cascade whose SHA is not in this branch's history is NOT
  evidence.** It may come from another branch or another machine. Reported
  distinctly from "no cascade at all", because the fixes differ.
- **A cascade run on a DIRTY tree records the parent commit's SHA**, so
  committing afterwards reads as stale. That is correct, not a false positive:
  nothing then proves the committed state was gated as a whole. The natural
  order — commit, then cascade, then push — makes the SHA match, and the
  timings churn that follows is markdown.
- **It never runs a gate itself**, matching `push-and-branch`'s own constraint
  that it must not create commits for un-gated work. It only reads.
- Failure to read the artefact is treated as **stale**, not as fresh: the safe
  direction for a check whose whole job is refusing to publish on missing
  evidence.

## Examples

```bash
cd location-based-webxr
node scripts/test-timing/cascade-freshness.mjs
# cascade-freshness: ✔ only markdown changed since the cascade at 0c7a575e (3 file(s))
```

## Tests

`cascade-freshness.test.mjs` — runs in the root `test:repo-config` gate. Covers
the fresh-on-HEAD case, code-changed staleness, the markdown-only exemption and
its all-or-nothing boundary, the never-recorded and unknown-SHA cases (which
report differently), uppercase `.MD`, and `newestCascadeSha` reading the newest
row rather than any other stage's.
