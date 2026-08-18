# select.mjs — test:changed selection logic (pure)

- Purpose: maps the set of changed repo paths to the commit-gate
  decision: run the full cascade, or run a specific set of packages (whose
  dependents the shell then adds via pnpm's workspace graph).
- Public API: `selectPackages({ trackedChanges, untracked, packageDirs }) →
  { mode: 'all', reason } | { mode: 'packages', packages }` — `packages` is
  sorted and deduped; `reason` is the first out-of-package path.
- Invariants & assumptions (speedup plan Phase B.2 guard rails — load-bearing):
  - Any path outside a known package dir ⇒ `mode: 'all'` (root configs are
    outside pnpm's dependency graph).
  - Untracked paths are supplied separately by the shell (`git diff` never
    lists them) and count exactly like tracked changes.
  - Generated `docs/test-timings.md` (root or one package level deep) is
    ignored — every full gate rewrites those files, so they would otherwise
    pin their package as permanently "changed".
  - Paths are slash-normalized; empty strings are ignored; never invents a
    package name not present in `packageDirs`.
- Examples: `selectPackages({ trackedChanges: ['GpsPlusSlamJs_RecorderApp/src/a.ts'],
  untracked: [], packageDirs })` → `{ mode: 'packages', packages:
  ['GpsPlusSlamJs_RecorderApp'] }`.
- Tests: `select.test.mjs` (one case per guard rail),
  `select.property.test.mjs` (never invents packages; any non-package path
  forces 'all'; order-insensitive). Run in the root repo-config gate.

## `gateCommands(names, { skipBrowserEnv })`

The command SPLIT, kept pure so DEC-G2 is testable. Emits, in order:

1. `pnpm run test:repo-config` — always; cheap, and it guards the config
   this logic itself reads.
2. the changed packages’ **full** gates (`--filter <name>`), e2e included,
   first so a break in what was actually edited fails fast;
3. their dependents **minus themselves**
   (`--filter "...<name>" --filter "!<name>"`) with `skipBrowserEnv` set.

`selectPackages` cannot compute the dependent set — it maps paths to
top-level directories and nothing more — so the closure comes from pnpm’s
workspace graph at execution time. What is asserted here is therefore the
emitted commands and their environment, which is where the guarantee either
holds or silently does not.

An empty dependent set is a safe no-op: pnpm prints "No projects matched the
filters" and exits 0 (verified), which is what a package with no dependents
gets.
