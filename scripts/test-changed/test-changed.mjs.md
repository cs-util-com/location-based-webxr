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

  Scope is `location-based-webxr` only — the primary repo’s projects have
  no equivalent and keep their own full gate.
- Public API (CLI): `pnpm run test:changed [--all] [--ref <git-ref>]
  [--dry-run]`. `--all` = full-cascade escape hatch (mandatory after
  changing the link-overridden sibling library, which this repo's git cannot
  see). `--ref` = diff base (default `HEAD`). `--dry-run` prints the
  decision only. Exit code = the underlying gate's exit code. A 124 is a
  stage the watchdog killed for silence, and is named as one beside its
  STALLED banner ([stall-watch.mjs](../test-timing/stall-watch.mjs.md)); a
  75 is a queue timeout. Neither is a red test.
- Invariants & assumptions:
  - Selection logic is pure and lives in `select.mjs` (see its sidecar for
    the guard rails); this shell only gathers `git diff --name-only <ref>` +
    `git status --porcelain` untracked entries and executes the decision.
  - Selected packages run as `pnpm --filter "...<name>" test` — the `...`
    prefix adds all dependents (the safety closure) from pnpm's workspace
    graph — with `--workspace-concurrency=1` (parallel gates would race e2e
    ports; parallelization is a separate, measured plan item B.3).
  - The machine slot ([machine-slot.mjs](../test-timing/machine-slot.mjs.md))
    is taken once for the WHOLE run (not on `--dry-run`); every gate it
    spawns inherits the token and re-enters, so no other session slips in
    between the repo-config tests and the last dependent.
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
  the watch line in `test-changed.test.mjs`;
  the thin shell is verified by `--dry-run` runs against the live tree (see
  the speedup plan's Phase B acceptance).
