# build-framework-if-stale.mjs — conditional framework build for gates

- Purpose: replaces the unconditional `pnpm --filter gps-plus-slam-app-framework
  run build` in the consumer packages' `build:framework` gate stage; skips
  the build when the framework `dist/` is demonstrably fresh (speedup plan
  Phase C.2). The full cascade otherwise builds the identical framework up
  to six times.
- Public API:
  - CLI: `node ../scripts/build-framework-if-stale.mjs` — exits 0 after
    ensuring a fresh dist (built or verified), else the build's exit code.
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
  - Not used by `dev`/`build` package scripts — only the gate stage command
    in `scripts/test-timing/projects.mjs` references it. The wrapped
    `build:framework` package scripts route through the same stage command,
    so `pnpm run build:framework` inherits the skip; `pnpm run dev`
    (chained the same way) does too — acceptable because the skip is
    strictly-newer only.
- Examples: cascade order recorder → starter: recorder's stage builds
  (inputs newer after a src edit), starter's stage skips (dist now strictly
  newest).
- Tests: `build-framework-if-stale.test.mjs` (fail-open matrix + property:
  a skip implies both mtimes exist and dist is strictly newer). Runs in the
  root repo-config gate.
