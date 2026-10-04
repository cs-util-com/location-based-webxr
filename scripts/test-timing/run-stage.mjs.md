# run-stage.mjs — impure stage engine (spawn, time, record)

> **Adapted from the GpsPlusSlamJs pilot's `run-stage.mjs`** — see
> `README.md` in this directory. Differences from upstream: every entry point
> takes the `ProjectConfig` resolved by the calling shell (instead of a
> module-level single-project constant), and `recordStage` creates the
> project's `docs/` directory on first write.

- Purpose: runs one configured stage of one project — spawns the canonical
  command through a shell, measures wall-clock, injects/parses JSON test
  reporters, and atomically rewrites that project's `docs/test-timings.md`.
- Public API:
  - `runStage(project, stageName, forwardedArgs) → Promise<StageResult>`
    (`{ exitCode, durationMs, tests, recorded }`). Unknown stage → exit 1.
  - `recordStage(project, stageName, durationMs, tests) → string` (delta
    summary line). Throws only on unwritable timings file; callers catch.
  - `WORKSPACE_ROOT`, `projectRoot(project)`, `timingsPath(project)`.
- Invariants & assumptions:
  - Recording NEVER fails the gate: all timing errors are warnings; the
    spawned command's exit code is returned untouched.
  - Records only full-suite non-CI runs (`decideRecording`): any forwarded
    arg or `CI` env ⇒ run executes but is not recorded.
  - Counts capture: vitest `--reporter=default --reporter=json
    --outputFile.json=<scratch>`; playwright `--reporter=list,json` +
    `PLAYWRIGHT_JSON_OUTPUT_NAME`. Parse failure ⇒ duration-only row.
  - Atomic write: temp file + rename, last-writer-wins; concurrent recorded
    runs in one project are unsupported (single-dev workflow).
  - Browser stages run at BELOW_NORMAL priority on Windows (2026-09-30):
    `execShell` spawns through `spawnAtPriority` with the priority
    `stageSpawnPriority` picks, so the shell, Playwright and Chromium
    inherit it and short gates beside a 3D suite get the CPU first. The
    parent process is restored after the spawn (run-gate runs every stage
    in-process) and never raised. Only when the stage really runs lowered
    does the stage's env get `GATE_BROWSER_STAGE_LOWERED=1` (otherwise the
    variable is cleared); the Playwright configs key `--in-process-gpu` on
    it (`scripts/e2e/browser-launch.mjs`), which moves Chromium's GPU work
    out of a process that raises itself. Opt in with
    `GATE_BROWSER_PRIORITY=below` (off by default). See `stage-priority.mjs.md`.
- Examples: `await runStage(project, 'test:unit', ['src/foo.test.ts'])` runs
  a filtered, unrecorded unit run scoped to one file.
- Tests: the pure modules it composes (`timing-store`, `delta`,
  `stage-args`, `reporter-parse`, `machine`) carry the regression protection;
  the shell itself is verified by running a package gate twice and
  inspecting the generated md (pilot-verified approach).
