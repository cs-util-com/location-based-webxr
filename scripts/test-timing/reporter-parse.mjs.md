> **Mirror of the GpsPlusSlamJs pilot** — see `README.md` in this directory; fix pure-module bugs upstream first.

# reporter-parse.mjs — runner JSON → exact test counts

- Purpose: extracts `{ passed, failed, skipped, todo }` from the JSON reporter output of vitest and playwright — machine-readable counts, never stdout scraping (plan §2).
- Public API:
  - `parseVitestCounts(jsonText)` → `TestCounts`. Maps the jest-compatible fields: `numPassedTests`→passed, `numFailedTests`→failed, `numPendingTests`→skipped, `numTodoTests`→todo.
  - `parsePlaywrightCounts(jsonText)` → `TestCounts`. Maps `stats.expected`(+`stats.flaky`)→passed (flaky passed on retry), `stats.unexpected`→failed, `stats.skipped`→skipped; todo is always 0.
  - Both throw `TypeError` on malformed JSON or missing/non-numeric count fields — a runner upgrade that changes the schema must fail loudly so the recording layer can warn and fall back to duration-only, instead of recording wrong counts.
- Invariants & assumptions:
  - Callers (run-stage.mjs) catch the `TypeError` and degrade gracefully; parsers never return `NaN`/`undefined` counts.
  - Fixtures in [\_\_test-fixtures\_\_/](__test-fixtures__/) are REAL captured output from this repo's suites (vitest 4.1 json reporter — `coverageMap` stripped for size only — and playwright 1.60 json reporter).
- Example:
  ```js
  parsePlaywrightCounts(
    '{"stats":{"expected":4,"unexpected":0,"skipped":1,"flaky":2}}'
  );
  // → { passed: 6, failed: 0, skipped: 1, todo: 0 }
  ```
- Tests: [reporter-parse.test.mjs](reporter-parse.test.mjs) (real fixtures + schema-drift guards), [reporter-parse.property.test.mjs](reporter-parse.property.test.mjs) (round-trip for arbitrary well-formed stats; TypeError for non-objects).
