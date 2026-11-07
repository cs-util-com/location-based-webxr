# test-changed.mjs — dependency-aware COMMIT gate (CLI shell)

- Purpose: `pnpm run test:changed` — runs the gates of changed packages PLUS
  every package that depends on them, instead of the full 8-package cascade.
  **This IS the commit gate since 2026-08-15 (DEC-G1).** It was
  iteration-only before that, and this line used to read "the full
  `pnpm test` cascade remains the commit gate". The cascade now runs once
  per session before the PR (DEC-G3) and on every PR in CI.

  What it gives up, stated so a weaker gate cannot pass for a stronger
  one: a change that breaks only a **dependent's** rendering is not caught
  here. Dependents run with `GATE_SKIP_BROWSER_STAGES` set, so they pay
  for their builds, static checks and unit tests but not for a browser.

  **The browser stages run a tier** ([`tier.mjs`](../e2e/tier.mjs.md)):
  by default (`E2E_TIER` unset or `pr`) the tests tagged `@pr` plus
  every spec file changed against `--ref`, whole; `E2E_TIER=full` runs
  every test. This holds for the milestone browser run
  (`test:changed --ref <milestone base>`) and for a package's own
  `pnpm test`; CI runs the same tier on every PR and the full set nightly
  (on the newest rNNN branch), on dispatch and on a `full-ci` label. A
  green browser run therefore says nothing about an untagged test of an
  unchanged spec. Tier runs record no timing row.

  Scope is `location-based-webxr` only — the primary repo’s projects have
  no equivalent and keep their own full gate.
- Public API (CLI): `pnpm run test:changed [--all] [--ref <git-ref>]
  [--dry-run]`. `--all` = full-cascade escape hatch (mandatory after
  changing the link-overridden sibling library, which this repo's git cannot
  see). `--ref` = diff base (default `HEAD`). `--dry-run` prints the
  decision only. Exit code = the underlying gate's exit code, or 2 for a
  refused run (a committed merge with nothing left to diff, or the library
  link with no webxr change). A 124 is a
  stage the watchdog killed for silence, and is named as one beside its
  STALLED banner ([stall-watch.mjs](../test-timing/stall-watch.mjs.md)); a
  75 is a queue timeout. Neither is a red test.
- Invariants & assumptions:
  - Selection logic is pure and lives in `select.mjs` (see its sidecar for
    the guard rails); this shell only gathers `git diff --name-only <ref>` +
    `git status --porcelain` untracked entries (`changed-paths.mjs`, shared
    with the Tour Viewer's e2e area selection so both see the same set) and
    executes the decision.
  - The changed packages' full gates get the ref as `GATE_CHANGED_REF`, which
    the Tour Viewer's e2e stage (`scripts/e2e/run-projects.mjs`) reads to
    skip the specs of an area the change cannot reach, and the browser tier
    reads to run every changed spec file whole. The full cascade and CI set
    no such ref, so no package is cut to the changed area; the cascade gives
    the tier its base as `E2E_TIER_BASE` instead (`cascadeTierBase` in
    select.mjs: the `--ref`, else the merge-base with the first of `origin2/main`, `origin/main`, `main` that has one), as CI
    does with the pull request's base, so a changed spec runs whole there
    too.
  - In the per-commit fast gate (`GATE_SKIP_BROWSER_STAGES` set by the
    caller) the changed packages' unit stages run only the tests related to
    the change (`relatedUnitEnv`, [related-unit.mjs](related-unit.mjs.md)),
    each saying so in one `related-unit:` line, and the dependents skip
    the checks that read only their own files (`dependentTrimEnv`, named in
    each dependent's skip line); the green banner says so too.
    Dependents still run every unit test; the milestone run (no skip
    switch), a package's own `pnpm test` and CI run every stage.
  - Selected packages run as `pnpm --filter "...<name>" test` — the `...`
    prefix adds all dependents (the safety closure) from pnpm's workspace
    graph — with `--workspace-concurrency=1` (parallel gates would race e2e
    ports; parallelization is a separate, measured plan item B.3).
  - The machine slot ([machine-slot.mjs](../test-timing/machine-slot.mjs.md))
    is taken once for the WHOLE run (not on `--dry-run`); every gate it
    spawns inherits the token and re-enters, so no other session slips in
    between the repo-config tests and the last dependent. With
    `GATE_SKIP_BROWSER_STAGES=1` (the per-commit gate) it queues as `fast`,
    ahead of browser runs that queued after it or less than an hour before.
  - Whenever a package gate or a root check runs (and before the full
    cascade too), the framework's `dist` is built if stale FIRST
    (`FRAMEWORK_BUILD_IF_STALE` in `select.mjs`), so neither a repo-config
    guard nor a dependent reads a stale `dist` (gate-speed plan G2).
  - Root repo-config tests run in every package-mode run (seconds-cheap,
    guard the root config the selection itself depends on), then the
    doc-only `format` stages, then the root checks (`check:deadcode`),
    then the package gates. The order is pure and tested in
    `select.test.mjs`; this shell runs the commands fail-fast in order.
  - **A narrowed change runs only what can read it** (`select.mjs.md`,
    "Narrowed changes"): a root guard or `knip.json` adds
    `check:deadcode`, root markdown and `.github`/`.vscode` add nothing
    beyond repo-config, and a package whose only change is doc markdown runs
    its `format` stage. The run prints ONE line (`describeRun`) naming what
    it saw and everything it runs, so a run that covers less than the full
    gate says so.
  - It writes its watchdog limit (`watchLine`, e.g. `stage watchdog: 20
    min (...)`) right after taking the slot, dry run included, for the waiter
    on its log ([wait-gate.mjs](../test-timing/wait-gate.mjs.md)); pinned by
    `test-changed.test.mjs`. With stdout a terminal no stage is watched, and
    the line says the watch is off. After a stalled package gate it prints a
    one-line STALLED verdict whose reason (`STALL_SUMMARY`) names the limit
    by its source, never as a number of minutes.
  - **A committed merge is refused, not passed.** The default base is HEAD,
    so a merge that is already a commit leaves nothing to diff: the run would
    be `test:repo-config` alone, exit 0, and no package checked. With no
    `--ref`, nothing selected, HEAD a merge commit and HEAD not on main, it
    exits 2 before taking the slot (`cleanMergeRefusal` in `select.mjs`) and
    names the ways out: `--ref` with this clone's main line for what the
    branch changes on top of main, `--ref HEAD~1` for what the merge brought
    in, `--all` for the whole cascade. The two bases select different sets
    and neither contains the other, so the choice stays with the caller. Not
    refused, and not checked either: a merge followed by further edits, where
    the run sees only those edits. A `--dry-run` prints the same refusal and
    exits 0, so it says what the gate would do; pinned in
    `test-changed.test.mjs`. The head is read only from a `git` that
    succeeded; a failed read counts as no merge.
  - Warns when `pnpm-workspace.yaml` contains a `gps-plus-slam-js: link:`
    override — library changes are invisible to selection then.
  - Package dirs are parsed from `pnpm-workspace.yaml` (plain `- Name` list,
    no globs) and filtered to dirs actually containing a `package.json`.
- Examples: edit only recorder files → runs repo-config + the recorder gate
  (~3.5 min instead of ~11 min); edit a framework file → framework + all six
  consumer gates; edit root `package.json` → full cascade; edit a
  repo-config guard and a Tour Viewer file → the build, repo-config,
  `check:deadcode` and the Tour Viewer gate with its dependents; edit only
  a Globe sidecar → repo-config and the Globe's `format`.
- Tests: decision logic in `select.test.mjs` / `select.property.test.mjs`;
  the merge refusal's decision in `select.test.mjs`. `test-changed.test.mjs`
  pins the watch line, and runs a copy of the script in a throwaway
  repository for the shell around the decision: the refusal's exit codes, a
  named base, `--all`, an ordinary commit, a merge on main, no slot on a dry
  run, and that a dry run runs nothing. Not covered: a failing `git` read, the
  library-link refusal, and the real run's command order (`select.test.mjs`
  holds the order).
