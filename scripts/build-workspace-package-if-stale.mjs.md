# build-workspace-package-if-stale.mjs — conditional library build for gates

- Purpose: builds a workspace LIBRARY package's `dist/` unless it is already
  demonstrably fresh (speedup plan Phase C.2). Replaces the unconditional
  `pnpm --filter <pkg> run build` in the consumer packages' build stages; the
  full cascade otherwise builds the identical library up to six times.
- Public API:
  - CLI: `node ../scripts/build-workspace-package-if-stale.mjs <packageName> <dirName>`
    — exits 0 after ensuring a fresh dist (built or verified), else the build's
    exit code. Both arguments default to the framework, so a bare invocation
    keeps its historical meaning.
  - `isBuildRequired(newestInputMs, oldestOutputMs) → boolean` — pure
    decision, exported for tests.
- Invariants & assumptions:
  - **Fail open**: null/unknown mtimes, walker errors, ties ⇒ build. Skip
    only when every dist file is STRICTLY newer than every input file
    (`src/`, `config/`, `package.json`). A wasted build costs ~4 s; a stale
    dist breaks e2e confusingly.
  - Inputs deliberately over-approximate (all of `src/` and `config/`, not
    just what tsdown consumes) — over-approximation only causes extra
    builds, never stale skips.
  - Not used by `dev`/`build` package scripts — only the gate stage commands
    in `scripts/test-timing/projects.mjs` reference it. The wrapped
    `build:framework` package scripts route through the same stage command,
    so `pnpm run build:framework` inherits the skip; `pnpm run dev`
    (chained the same way) does too — acceptable because the skip is
    strictly-newer only.
- **Two libraries use it, and they are staged differently.** Both consumers
  resolve through the package `exports`, i.e. through `dist`:
  - `build:framework` runs AFTER `typecheck`, which is safe only because
    RecorderApp maps the framework to SOURCE via tsconfig `paths` and the
    cascade happens to build it before the apps that do not.
  - `build:osm` runs BEFORE `typecheck`, because nothing maps
    `gps-plus-slam-osm` to source. With the stage missing altogether, `tsc`
    reported "Cannot find module 'gps-plus-slam-osm'" plus a cascade of
    implicit-any errors that read like OsmDemo's own bug, and the Cloudflare
    `/osm/` deployment failed while every local run passed against a stale
    dist left behind by an earlier e2e run.
  - The consumers are deliberately NOT given `paths` mappings to source
    instead: OsmDemo exists to prove the OSM package's public surface works
    from outside it, and a source mapping would typecheck straight past a
    missing or wrong entry in the export map.
- Examples: cascade order recorder → starter: recorder's stage builds
  (inputs newer after a src edit), starter's stage skips (dist now strictly
  newest).
- Tests: `build-workspace-package-if-stale.test.mjs` (fail-open matrix +
  property: a skip implies both mtimes exist and dist is strictly newer).
  Runs in the root repo-config gate.
