# select.mjs — test:changed selection logic (pure)

- Purpose: maps the set of changed repo paths to the commit-gate
  decision: run the full cascade, or run a specific set of packages (whose
  dependents the shell then adds via pnpm's workspace graph).
- Public API: `selectPackages({ trackedChanges, untracked, packageDirs }) →
  { mode: 'all', reason } | { mode: 'packages', packages, rootChecks?,
  rootFiles?, docsOnly? }` — `packages` is sorted and deduped; `reason` is
  the first path that forces the cascade; the three optional lists appear
  only when non-empty (see "Narrowed changes" below). `docOnlyDirs(docsOnly)`
  maps doc-only files to their package dirs; `describeRun(selection, ref)` is
  the one line the shell prints.
- Invariants & assumptions (speedup plan Phase B.2 guard rails — load-bearing):
  - Any path outside a known package dir ⇒ `mode: 'all'` (root configs are
    outside pnpm's dependency graph), except the narrowed root classes in
    the table below.
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

## `gateCommands(names, { skipBrowserEnv, rootChecks, docOnlyNames })`

The command SPLIT, kept pure so DEC-G2 is testable. Emits, in order:

1. `FRAMEWORK_BUILD_IF_STALE`, whenever any package gate or root check
   runs: the framework's `dist` is built unless it is already newer than
   every input (`scripts/build-workspace-package-if-stale.mjs`). The demo
   apps resolve the framework through `dist` and their own
   `build:framework` stage comes after `typecheck` and `test:unit`, so
   without it a dependent checked itself against a stale `dist` on a
   framework change (stale-dist follow-up 2026-09-28-1910, option 1;
   gate-speed plan G2). Not narrowed to selections containing a framework
   consumer: a fresh dist costs one mtime walk, and the selections it could
   skip are rare. FIRST, before the repo-config tests, because one of them
   (`framework-dts-portability.test.js`) reads `dist` when present;
2. `pnpm run test:repo-config` — always; cheap, and it guards the config
   this logic itself reads;
   - then each doc-only package's `format` stage and each root check
     (`check:deadcode`), see "Narrowed changes" below;
3. the changed packages’ **full** gates (`--filter <name>`), e2e included,
   first so a break in what was actually edited fails fast;
4. their dependents **minus themselves**
   (`--filter "...<name>" --filter "!<name>"`) with `skipBrowserEnv` set.

`selectPackages` cannot compute the dependent set — it maps paths to
top-level directories and nothing more — so the closure comes from pnpm’s
workspace graph at execution time. What is asserted here is therefore the
emitted commands and their environment, which is where the guarantee either
holds or silently does not.

An empty dependent set is a safe no-op: pnpm prints "No projects matched the
filters" and exits 0 (verified), which is what a package with no dependents
gets.

## `cascadeCommands()`

The full-cascade fallback (`--all`, or a change outside the package dirs):
the same framework build first, then `pnpm test`. The cascade runs
`check:deadcode` (knip resolves workspace packages through their `dist`)
before any package stage builds the framework.

## The served-by edge (globe plan 2026-09-26-0539 §8, W7 M0)

The design system SERVES the globe package through its routes but does not
depend on it, so pnpm's graph never selects it. A change in
`GpsPlusSlamJs_Globe` therefore also selects `GpsPlusSlamJs_DesignSystem`,
in full: its globe lab smoke is the globe's only browser check. The
framework and OsmDemo are served too but are deliberately NOT listed: that
would put the design system's ~11 min e2e on every framework commit, an
owner decision filed with the W7 M0 record. Tested in `select.test.mjs`
("the served-by edge").

## Narrowed changes: what a change can skip

A path whose every reader is known needs those readers, not the whole
cascade. Replayed over the 1,771 non-merge commits from 2026-08-21 to
2026-10-21 (each commit's own file list, today's package list), the
full cascade falls from 154 commits to 64, and 51 commits drop a package
gate for doc-only markdown. Most of what remains is the lockfile (25),
the gate tooling (19) and `package.json` (9).

- `tests/repo-config/**`
  - runs: build, repo-config, `check:deadcode`;
  - read by: the root vitest run, and knip's root workspace.
- `knip.json`
  - runs: build, repo-config, `check:deadcode`;
  - read by: knip.
- any root `*.md` (README, `docs/`, script sidecars)
  - runs: repo-config;
  - read by: the repo-config guards (sidecars, doc comments, CLA, ports doc).
- `.github/**`, `.vscode/**`
  - runs: repo-config;
  - read by: CI and the editor; locally only the `cla-config` guard.
- package doc markdown: a sidecar `name.ext.md`, a `README.md` or
  `CHANGELOG.md`, or any `.md` under a `docs/` dir, never under `assets/`
  or `public/`
  - runs: repo-config and that package's `format` stage;
  - read by: its `format` stage and the repo-config guards.
- anything else outside a package
  - runs: the full cascade (unknown readers, or the gate tooling itself).

- "build" is `FRAMEWORK_BUILD_IF_STALE`, which runs FIRST whenever anything
  beyond repo-config and a format stage runs: the repo-config guard
  `framework-dts-portability.test.js` reads the framework's `dist` when
  present, so it must not read a stale one.
- A doc file in a package whose code also changed is formatted by that
  package's full gate and is not listed as doc-only. A doc-only package
  pulls in no dependents and no served-by edge.
- Untracked (new) files count exactly like tracked ones, here too.
- **The markdown that IS input keeps its package gate**, by not matching
  the doc pattern (each pinned in `select.test.mjs`):
  - `GpsPlusSlamJs_DesignSystem/hud-design-brief.md`, read by
    `check-tokens.mjs`;
  - `GpsPlusSlamJs_DesignSystem/labs/terrain/fixtures/PROVENANCE.md`, read
    by `terrain-fixtures.test.mjs`;
  - `GpsPlusSlamJs_Globe/assets/*.md`, summed by the 13 MB asset budget in
    `globe-sources.test.ts`;
  - `GpsPlusSlamJs_DesignSystem/assets/README.md`, listed by
    `build-lookdev.test.mjs`;
  - and anything under a `public/` dir, which is shipped as it is.
- **Stays on the full cascade:** `pnpm-lock.yaml`, `package.json`,
  `pnpm-workspace.yaml`, `patches/**`, `.nvmrc` (shared inputs);
  `scripts/test-timing/**` and `scripts/test-changed/**` (they RUN every
  gate, so a change can break a package gate in a way only running it
  shows); `scripts/e2e/**` (imported by the Playwright configs);
  `vitest.config.js`, `scripts/build-*.mjs`, `wrangler.toml`,
  `.gitattributes`, `.gitignore`; and any unknown path.
- **What it gives up.** The table rests on a search for readers, which is a
  snapshot: a future stage that reads a sidecar or a root markdown file as
  input would be skipped silently, so whoever adds one updates this table.
  The full cascade also used to run knip incidentally on every root-file
  commit; knip's view of a PACKAGE change stays with the session-end
  `check:deadcode`, as for any package commit. And a random-seed property in
  a package the change cannot reach no longer runs on that commit: its
  discovery runs are the package's own commits, the milestone browser run
  and CI's full cascade on every PR.
- `gateCommands(names, { skipBrowserEnv, rootChecks, docOnlyNames })` emits,
  in order: the build (as above), `pnpm run test:repo-config`, the doc-only
  packages' `run --if-present format`, each root check, the changed
  packages' full gates, their dependents without browser stages.
- `describeRun` prints ONE line naming what was seen and everything that
  runs, e.g. `test-changed: vs HEAD - changed GpsPlusSlamJs_TourViewer; root
  files (1): tests/repo-config/x.test.js => runs: the framework build if
  stale, test:repo-config, check:deadcode, the full gate of
  GpsPlusSlamJs_TourViewer, then its dependents without browser stages`.
