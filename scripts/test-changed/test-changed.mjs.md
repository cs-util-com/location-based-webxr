# test-changed.mjs — dependency-aware iteration gate (CLI shell)

- Purpose: `pnpm run test:changed` — runs the gates of changed packages PLUS
  every package that depends on them, instead of the full 8-package cascade.
  **Iteration-only: the full `pnpm test` cascade remains the commit gate.**
- Public API (CLI): `pnpm run test:changed [--all] [--ref <git-ref>]
  [--dry-run]`. `--all` = full-cascade escape hatch (mandatory after
  changing the link-overridden sibling library, which this repo's git cannot
  see). `--ref` = diff base (default `HEAD`). `--dry-run` prints the
  decision only. Exit code = the underlying gate's exit code.
- Invariants & assumptions:
  - Selection logic is pure and lives in `select.mjs` (see its sidecar for
    the guard rails); this shell only gathers `git diff --name-only <ref>` +
    `git status --porcelain` untracked entries and executes the decision.
  - Selected packages run as `pnpm --filter "...<name>" test` — the `...`
    prefix adds all dependents (the safety closure) from pnpm's workspace
    graph — with `--workspace-concurrency=1` (parallel gates would race e2e
    ports; parallelization is a separate, measured plan item B.3).
  - Root repo-config tests always run first (seconds-cheap, guard the root
    config the selection itself depends on).
  - Warns when `pnpm-workspace.yaml` contains a `gps-plus-slam-js: link:`
    override — library changes are invisible to selection then.
  - Package dirs are parsed from `pnpm-workspace.yaml` (plain `- Name` list,
    no globs) and filtered to dirs actually containing a `package.json`.
- Examples: edit only recorder files → runs repo-config + the recorder gate
  (~3.5 min instead of ~11 min); edit a framework file → framework + all six
  consumer gates; edit root `package.json` → full cascade.
- Tests: decision logic in `select.test.mjs` / `select.property.test.mjs`;
  the thin shell is verified by `--dry-run` runs against the live tree (see
  the speedup plan's Phase B acceptance).
