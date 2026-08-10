# budget.mjs — wall-clock ceiling for stages that have regrown before

- Purpose: turns a finished stage's wall-clock duration into a gate failure when it exceeds a fixed per-stage ceiling. This is a **regrowth alarm**, not a performance target — it exists because a stage can grow +10 % per day for a week and never look abnormal against its own median.
  - Local to this repo. Unlike most of this directory it has no counterpart in the `GpsPlusSlamJs` pilot, so there is nothing upstream to sync with.
- Public API:
  - `budgetBreach(stage, durationMs, env?)` → breach message `string`, or `null` when there is nothing to report.
    - `stage`: `{ name, budgetSeconds? }` — a stage entry from [projects.mjs](projects.mjs). No `budgetSeconds` ⇒ never fires, which is every stage but one.
    - `durationMs`: the stage's measured wall clock.
    - `env`: `process.env` or a stub. Truthy `env.CI` ⇒ never fires. **Omitted means "not CI"** — a caller that forgets the argument keeps the guard rather than silently losing it.
- Invariants & assumptions:
  - **Pure and total.** No I/O, no clock, no `process.env` read of its own. Every malformed input returns `null` rather than failing a gate: an absent, non-numeric, non-finite or non-positive `budgetSeconds` (a typo in `projects.mjs` must not turn every gate red), and a `NaN` or negative duration (an unmeasured stage must not read as infinitely slow).
  - Exactly the budget is **inside** it (`<=`), so a stage landing on the number does not flap.
  - **The ceiling is only enforced off CI**, because it is derived from the same-machine median that [stage-args.mjs](stage-args.mjs) deliberately refuses to record on CI. Enforcing a local number on a runner that contributes no data point measured the runner, not the suite — it failed two PRs on runs where all 51 e2e tests passed. The CI truthiness check must stay identical to `decideRecording`'s, or a run could skip the budget while still recording a row.
    - The cost, stated plainly: the alarm now lives only on the machine that runs the full local gate. If that habit lapses, the guard lapses with it.
  - Currently exactly one stage is guarded: `GpsPlusSlamJs_OsmDemo`'s `test:e2e` at 740 s ([projects.mjs](projects.mjs)). Changing that number is a deliberate act with its own commit and the new median quoted — the module docstring carries the rule for deriving one.
- Example:
  ```js
  budgetBreach({ name: 'lint' }, 9_999_000, {}); // → null (unguarded stage)
  budgetBreach({ name: 'test:e2e', budgetSeconds: 740 }, 587_000, {}); // → null
  budgetBreach({ name: 'test:e2e', budgetSeconds: 740 }, 771_000, {}); // → 'stage "test:e2e" took 771.0 s …'
  budgetBreach({ name: 'test:e2e', budgetSeconds: 740 }, 771_000, { CI: '1' }); // → null
  ```
- Caller: [run-gate.mjs](run-gate.mjs) checks each stage **after** its own pass/fail, so a red stage reports its own failure rather than a budget message about work that never finished.
- Tests: [budget.test.mjs](budget.test.mjs) (examples: boundaries, the "raising it is the wrong first move" wording, malformed inputs, CI skip), [budget.property.test.mjs](budget.property.test.mjs) (never breaches on CI for any stage/budget/duration; off CI breaches ⟺ duration exceeds budget).
- Background: [2026-08-07-simplify-loop-findings.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-07-simplify-loop-findings.md) (why the levers for shrinking this suite are spent) and [2026-08-10-0507-e2e-budget-ci-false-positive-findings.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-10-0507-e2e-budget-ci-false-positive-findings.md) (why CI is skipped, with the measurements and the rejected alternatives).
