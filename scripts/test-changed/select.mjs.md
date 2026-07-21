# select.mjs — test:changed selection logic (pure)

- Purpose: maps the set of changed repo paths to the iteration-gate
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
