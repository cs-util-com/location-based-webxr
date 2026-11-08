# related-unit.mjs - the related-only unit stage (CLI shell)

- Purpose: in the per-commit fast gate, the unit stage of a CHANGED package
  runs only the tests related to what changed; everywhere else the suite
  runs whole. This shell gathers git's view of the package and runs the plan
  of [related-tests.mjs](related-tests.mjs.md).
- Public API (CLI, from a package dir):
  `node ../scripts/test-changed/related-unit.mjs vitest run [args...]`, with
  `GATE_UNIT_RELATED_REF` (`UNIT_RELATED_ENV`) set to the diff base. Exit
  code = vitest's. `gateBaseCommand` in
  [projects.mjs](../test-timing/projects.mjs.md) builds this command, only
  for a vitest `test:unit` stage, only with `GATE_SKIP_BROWSER_STAGES` and
  the ref set, never on the GitHub runner; `gateCommands` in
  [select.mjs](select.mjs.md) sets the ref for the changed packages of the
  fast gate and for the dependents the graph chose.
- Invariants & assumptions:
  - When any change lies outside the package (an upstream package, a file
    one of its tests reads), the plan adds this package's tests that the
    cross-package graph reaches (`mergeImpact` over `impactOf`,
    [impact-graph.mjs](impact-graph.mjs.md)), or runs the full suite when a
    graph fallback names this package. The same stage runs in a dependent
    the graph chose, so a dependent runs only the tests the change reaches.
  - Prints ONE line saying what it runs: `related-unit: only the tests
    related to N changed or reading file(s) ...`, `related-unit: no unit test
    can read this change, so none runs ...`, or `related-unit: full suite -
    <reason>`. The full suite runs when the ref is missing, git fails, the
    plan says so, or the command is not a plain `vitest run`.
  - Changed files: `git diff --name-only --no-renames <ref>` (staged and unstaged; a rename
    lists both names) plus
    `git ls-files --others --exclude-standard` (untracked FILES, not the
    collapsed directory `git status` shows for a new folder), limited to the
    package.
  - Test files: the tracked and untracked unit tests of the package
    (`isUnitTest`: `*.test.*`, or `*.spec.*` under `src/`), read for the
    reader and scanner rules.
  - The cross-package reached set comes from the gate run's impact cache
    (`GATE_IMPACT_FILE`, written once by test-changed.mjs, see
    [graph-dependents.mjs](graph-dependents.mjs.md)) when it was written for
    the same ref and root; only without one is the graph built here (about
    3.4k file reads, once per package before r1139).
  - vitest is spawned through node from the package's own resolution, not a
    shell, so a long file list never meets cmd.exe's command-line limit.
  - A related run is not recorded as a timing row: its command differs from
    the stage's canonical one (`run-stage.mjs` records only that).
  - Coverage is dropped in the related run (a slice's coverage and its
    thresholds mean nothing); the Recorder's thresholds still gate in its
    own `pnpm test`, the milestone run and CI.
- Example: a Tour Viewer commit that edits `src/editor3d/empty-tour-view.ts`
  and its test runs 3 test files (the module's two tests and the 3D globe
  test that imports it) plus the directory scanners, instead of about 440.
- Tests: the rules in `related-tests.test.mjs` and
  `related-tests.property.test.mjs`; the wiring in `projects.test.mjs`
  ("related unit tests in the fast gate only") and `select.test.mjs`
  ("related unit tests in the fast gate"); the shell itself by real fast-gate
  runs (no unit test spawns git and vitest).
