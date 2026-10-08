# scripts/sampled-mutants.mjs

## Purpose

A sampled mutation pass: apply hand-made text mutants one at a time, run
the given unit tests, and report which survive, per region (code book
refactor plan
`GpsPlusSlamJs_Docs/docs/2026-10-06-1601-tour-viewer-code-book-refactor-plan.md`,
M1 and its review #6). It exists because a full Stryker run over the
3,600-line `creator-setup.ts` would take many hours, and because the split
(M2) needs the SAME mutants re-applied afterwards: a mutant is a text
replacement, so it still applies when the text moved into another module
(only `file` changes).

## Usage

```bash
node scripts/sampled-mutants.mjs scripts/fixtures/creator-setup.mutants.json
```

The list (under `scripts/fixtures/`: the repo guards against data loose in
`scripts/`): `{ tests: string[], mutants: { name, region, file, from, to }[] }`

- `file` relative to the package, `from` must occur exactly once in it.
- `expected` (optional): `"equivalent"` (the mutant cannot change
  behaviour) or `"known-gap"` (no test can see it yet), with `why`; such a
  mutant is reported separately when it survives and does not fail the run.

## Invariants

- Each mutant's file is restored from the text read before the run, after
  every mutant and in a `finally` - never through git (a git restore also
  drops uncommitted work in the file).
- The unmutated tests run first; a red baseline exits 2 before any mutant
  (a mutant is "killed" when the tests fail, so a red baseline would read
  as every mutant killed; M2 review #5).
- A `from` that is missing or not unique is reported, not applied.
- Exit code 1 when any mutant survived or could not be applied.
- The tests run through `pnpm run test:unit` (the package rule), with the
  machine slot off; the timed stage rewrites `docs/test-timings.md`.

## Tests

None of its own: it is a measuring tool, and its outcome is checked by the
mutants it lists (each was confirmed killed or surviving by hand when it
was written).
