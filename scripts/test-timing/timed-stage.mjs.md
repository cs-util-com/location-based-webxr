# timed-stage.mjs — per-stage CLI wrapper

> **Adapted from the GpsPlusSlamJs pilot's `timed-stage.mjs`** — see
> `README.md` in this directory. Difference from upstream: the owning
> project is resolved from the invoking cwd (pnpm runs package scripts with
> cwd = the package directory).

- Purpose: the command every wrapped package.json leaf script invokes:
  `node ../scripts/test-timing/timed-stage.mjs <stage> [forwarded args…]`
  (root scripts use `scripts/…`). Runs the stage via `run-stage.mjs` and
  exits with the underlying command's exit code.
- Public API (CLI): first arg = stage name (required; exit 2 when missing or
  when the cwd matches no configured project); remaining args are forwarded
  to the canonical command and mark the run filtered/unrecorded.
- Invariants & assumptions:
  - Every stage run takes the machine slot first (see
    [machine-slot.mjs](machine-slot.mjs.md)); inside a gate it re-enters.
    **Except a filtered unit-test run** (a vitest stage, `test:unit` or
    `test:repo-config`, with file arguments): a 1-5 s TDD step must not queue
    behind a browser run, so it prints
    `machine slot: not taken (filtered unit-test run); set GATE_SLOT=take for a long sweep`
    and runs at once. A long sweep run that way (10-25 min) sets
    `GATE_SLOT=take` and queues like any heavy run. Filtered browser runs
    (`pnpm run test:e2e <spec>`) still take it: they start Chromium. A
    browser suite holds the slot for its whole run; to let other sessions in
    between files, run it file by file. `GATE_SLOT_DIR=off` switches the
    slot off for one run.
  - A leading literal `--` (pnpm forwarding style)
  is stripped by `decideRecording`, so `pnpm run test:unit -- <file>` and
  `pnpm run test:unit <file>` behave identically.
- Examples: `pnpm run lint` (recorded full run) ·
  `pnpm run test:unit src/utils/foo.test.ts` (filtered, unrecorded).
- Tests: argument handling is covered by `stage-args.test.mjs`; project
  resolution by `projects.test.mjs`.
