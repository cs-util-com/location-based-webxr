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
  - `forwardSignalsToStages()` - for a process that runs stages (the CLI
    wrappers): forwards SIGINT, SIGTERM and SIGHUP to every live stage's
    process group, then exits 130. `signalLiveStages(signal)` does the
    forwarding alone, for a caller with its own handlers (`run-gate.mjs`).
- Invariants & assumptions:
  - Recording NEVER fails the gate: all timing errors are warnings; the
    spawned command's exit code is returned untouched.
  - Records only full-suite non-CI runs (`decideRecording`): any forwarded
    arg or `CI` env ⇒ run executes but is not recorded. A run on a stage's
    per-commit `fastGateCommand` (`gateBaseCommand` in `projects.mjs`) is
    not recorded either: its duration is not comparable with the canonical
    command's history (gate-speed plan 2026-10-04, G4).
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
  - **The stage watchdog** ([stall-watch.mjs](stall-watch.mjs.md)): an
    unfiltered stage that prints nothing for `GATE_STALL_MIN` minutes
    (default 20) has its whole process tree killed and returns 124 with a
    STALLED banner printed before the exit. A filtered run is watched only
    when `GATE_STALL_MIN` is set to a number; a `nestedGate` row is not
    watched (its leaves are). Watching pipes the stage's stdout and stderr
    through the parent, which is why it is skipped when stdout is a terminal:
    a terminal run keeps its colours and progress bars, and has a person
    watching it. The longest silence is printed after the stage only past a
    quarter of the limit.
  - **The kill reaches grandchildren.** Windows: `taskkill /T /F` on the
    shell's pid. POSIX: the watched stage is spawned `detached`, in a process
    group of its own, and the group gets SIGTERM, then SIGKILL after a 5 s
    grace. Because that group is out of reach of a signal sent to the gate,
    the gate forwards SIGINT, SIGTERM and SIGHUP to it, and an exit hook sends
    SIGTERM to any group still alive when the parent exits. A failed kill is
    named in the banner (its processes may still run) and the stage still
    returns 124.
- Examples: `await runStage(project, 'test:unit', ['src/foo.test.ts'])` runs
  a filtered, unrecorded unit run scoped to one file.
- Tests: the pure modules it composes (`timing-store`, `delta`,
  `stage-args`, `reporter-parse`, `machine`) carry the regression protection;
  the shell itself is verified by running a package gate twice and
  inspecting the generated md (pilot-verified approach). The watchdog's
  spawning half is covered end to end by `stall-watch.integration.test.mjs`
  (a silent fixture stage with a forked grandchild, a stage that keeps
  talking, and on POSIX a SIGTERM forwarded to the stage's group).
