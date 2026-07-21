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
- Invariants & assumptions: a leading literal `--` (pnpm forwarding style)
  is stripped by `decideRecording`, so `pnpm run test:unit -- <file>` and
  `pnpm run test:unit <file>` behave identically.
- Examples: `pnpm run lint` (recorded full run) ·
  `pnpm run test:unit src/utils/foo.test.ts` (filtered, unrecorded).
- Tests: argument handling is covered by `stage-args.test.mjs`; project
  resolution by `projects.test.mjs`.
