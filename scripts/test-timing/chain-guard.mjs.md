> **Mirror of the GpsPlusSlamJs pilot** — see `README.md` in this directory; fix pure-module bugs upstream first.

# chain-guard.mjs — stages.mjs ↔ package.json drift detection

- Purpose: after the timing rewiring, the gate is defined in two places — `stages.mjs` (run by `run-gate.mjs`, mirrored by the md rows) and the package.json `&&` chains (`test:core`, `check:all`) developers still run directly. This module detects drift between them; `run-gate.mjs` prints its findings as warnings on every `pnpm test`. Warnings only — the guard never fails the gate (plan §4).
- Public API:
  - `expandChain(scripts, name, visited?)` → `string[]`: splits a chain script on `&&` and flattens nested `pnpm run <x>` references to leaf script names; raw command members are returned verbatim. Each chain script is expanded at most once per call (`visited` recursion guard), so circular chain references are dropped instead of overflowing the stack — a malformed package.json degrades to warnings, never a crash (PR #518 review finding).
  - `checkChainDrift(scripts, stageNames, chainNames = ['test:core', 'check:all'])` → `string[]` warnings:
    - a stage in `stageNames` with no package.json script,
    - a stage script that does not invoke `timed-stage.mjs <stage>` (its runs would silently go unrecorded),
    - a chain member missing from `stageNames` (it would get no timing row),
    - chain order contradicting the `stageNames` order.
- Invariants & assumptions:
  - Pure functions over a scripts map — no fs access; `run-gate.mjs` supplies the parsed package.json.
  - Missing chain scripts are fine (a project without `test:core` simply has nothing to check).
  - Circular `pnpm run` chains terminate: the back-reference contributes no leaves; the rest of the chain still expands (see the cycle test).
- Example:
  ```js
  checkChainDrift({ 'test:core': 'pnpm run lint', lint: 'eslint .' }, ['lint']);
  // → ['script "lint" does not invoke the timed-stage.mjs wrapper — …']
  ```
- Tests: [chain-guard.test.mjs](chain-guard.test.mjs) (real layout, each drift kind), [chain-guard.property.test.mjs](chain-guard.property.test.mjs) (no false positives on canonical layouts; removing any stage script always warns).
