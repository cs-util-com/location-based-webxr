# run-gate.mjs — full-gate orchestrator

> **Adapted from the GpsPlusSlamJs pilot's `run-gate.mjs`** — see
> `README.md` in this directory. Difference from upstream: the project is
> resolved from the invoking cwd, and the chain-drift check uses the
> project's configured `chainNames`.

- Purpose: a package's `pnpm test` entry point. Runs every stage of the
  cwd-resolved project sequentially with fail-fast semantics, records the
  synthetic `total` row when every stage recorded, and prints the
  consolidated delta table from the freshly written `docs/test-timings.md`.
- Public API (CLI): no arguments. Exit code = first failing stage's exit
  code, else 0. Warns (never fails) on chain drift between `projects.mjs`
  and the package.json chain scripts (`test:core`, `check:all` where
  configured).
- Invariants & assumptions:
  - Fail-fast: a red stage stops the gate exactly like the old `&&` chain.
  - The `total` row is only written when EVERY stage recorded (never on CI
    or partially filtered runs); its test count sums the count-bearing
    stages.
  - Timing/recording failures are warnings; they never change the exit code.
- Examples: `pnpm test` inside `GpsPlusSlamJs_AppFramework/` → runs format →
  lint → typecheck → typecheck:tests → test:unit, then prints the table.
- Tests: `chain-guard.test.mjs` covers the drift warnings;
  `projects.test.mjs` enforces that each project's `test` script points
  here. The orchestration shell itself is pilot-verified by consecutive gate
  runs (see plan Phase A acceptance).
