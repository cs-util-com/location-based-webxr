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
`timed-stage.mjs`, `run-gate.mjs` (all parameterized by project). Workspace-only
additions with no upstream yet: `stall-watch.mjs` (the stage watchdog),
`wait-gate.mjs` (the one background wait on a detached gate) and
`fast-check-time-limit.mjs` (every vitest run's fast-check time limit).

What it does (same as upstream): wraps each test-gate stage, measures
wall-clock, extracts exact test counts from injected JSON reporters, and
maintains one generated `docs/test-timings.md` **per package** (plus one at
the workspace root for the whole cascade). Recording never fails a gate,
skips CI and filtered runs, and only compares same-machine history.

These modules' own tests run in the root repo-config gate
(`pnpm run test:repo-config`), wired via the root `vitest.config.js` include.

To run a gate detached, launch it so its log ends in a whole `GATE-RC=<n>`
line carrying its exit code, then wait on that log with `wait-gate.mjs`
([wait-gate.mjs.md](wait-gate.mjs.md)). The gate does not write that line
itself; the launch command does. Braces rather than a subshell, so the
redirect covers the `echo` too:

```bash
{ pnpm test; echo "GATE-RC=$?"; } > gate.log 2>&1 &
node scripts/test-timing/wait-gate.mjs gate.log
```
