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
  fast gate only and clears it for their dependents.
- Invariants & assumptions:
  - A change in a workspace package this one depends on (directly or
    transitively, any dependency field) runs the full suite
    (`upstreamChange`): a test can import that package's source through an
    alias or a src export, which a package-local related run cannot see.
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
  - Test files: tracked and untracked `*.test.*` files of the package outside
    `playwright-tests/`, read for the reader and scanner rules.
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
