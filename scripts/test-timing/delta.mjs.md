> **Mirror of the GpsPlusSlamJs pilot** — see `README.md` in this directory; fix pure-module bugs upstream first.

# delta.mjs — timing delta + flag computation

- Purpose: computes the display delta for the newest recording of one stage's timing history, applying the agreed noise rule (flag only when BOTH >20% AND >2s vs. the previous same-machine recording).
- Public API:
  - `computeDelta(history)` → `Delta`
    - `history`: newest-first array of `Recording` (`{ ts, durationMs, tests|null, machine, git|null }`); must be non-empty, else `TypeError`.
    - `Delta.kind`: `'first'` (only recording), `'baseline-reset'` (no previous same-machine entry), `'compared'`.
    - `Delta.flag`: `'slower' | 'faster' | 'same'` when compared, `null` otherwise. Strictly-greater threshold semantics (exactly 20%/2s ⇒ `'same'`).
    - `Delta.deltaMs` / `Delta.pct`: only present when compared.
    - `Delta.deltaTests`: passed-count change; `null` when either entry lacks counts.
- Invariants & assumptions:
  - Deltas/flags are computed only against the previous recording **from the same machine fingerprint** — cross-machine comparisons are meaningless (see plan §5).
  - Malformed entries (non-finite/negative duration, missing machine) throw `TypeError` — recording code catches and warns, never breaking the gate.
  - Thresholds are display-only; callers must never turn a flag into a failing exit code.
- Example:
  ```js
  computeDelta([
    { ts, durationMs: 12000, tests: null, machine: 'M1', git: 'abc' },
    { ts, durationMs: 8600, tests: null, machine: 'M1', git: 'abb' },
  ]);
  // → { kind: 'compared', flag: 'slower', deltaMs: 3400, pct: ~0.395, deltaTests: null }
  ```
- Tests: [delta.test.mjs](delta.test.mjs) (threshold/baseline/count examples), [delta.property.test.mjs](delta.property.test.mjs) (equality with an independent reference model in both directions; kind determined by machine sequence).
