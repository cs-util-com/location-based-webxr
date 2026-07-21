# test-timing — MIRROR of the GpsPlusSlamJs pilot (unify later)

This directory is a **copy of the library pilot** at
`gps-plus-slam/GpsPlusSlamJs/scripts/test-timing/`, adapted for this
workspace's multi-package layout (owner decision 2026-07-21, see
`GpsPlusSlamJs_Docs/docs/2026-07-21-0526-test-gate-speedup-plan.md` §6 in the
sibling repo). The planned npm extraction ("Phase 2" of the library's
`docs/2026-07-02-0208-test-timing-history-plan.md`) supersedes this copy —
when that package exists, both repos consume it and this directory disappears.

Until then, treat the **library pilot as upstream**: fix pure-module bugs
there first, then re-copy. Files intentionally byte-identical to upstream:
`timing-store.mjs`, `delta.mjs`, `machine.mjs`, `reporter-parse.mjs`,
`stage-args.mjs` (+ their tests and fixtures). Files adapted for the
multi-package layout: `chain-guard.mjs` (wrapper path accepts `../scripts/…`),
`projects.mjs` (replaces the single-project `stages.mjs`), `run-stage.mjs`,
`timed-stage.mjs`, `run-gate.mjs` (all parameterized by project).

What it does (same as upstream): wraps each test-gate stage, measures
wall-clock, extracts exact test counts from injected JSON reporters, and
maintains one generated `docs/test-timings.md` **per package** (plus one at
the workspace root for the whole cascade). Recording never fails a gate,
skips CI and filtered runs, and only compares same-machine history.

These modules' own tests run in the root repo-config gate
(`pnpm run test:repo-config`), wired via the root `vitest.config.js` include.
