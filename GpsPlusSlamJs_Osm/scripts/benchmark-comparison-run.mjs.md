# Bounded comparison runner

`runComparison(cells, options)` executes an explicit plan serially and checkpoints the full document after each completed or skipped row. Used by `benchmark-endpoints.mjs --compare-map3d`.

The existing matrix policy supplies 60-second operator cooldown and two-failure threshold. This focused run conservatively stops the whole operator after two failures of any kind; there is no automatic retry or readmission. Numeric and date Retry-After values extend the cooldown. Each request's timeout and byte cap are bounded by the remaining run budget. This is a benchmark policy, not the production retry policy.

Results distinguish planned/sent/skipped/valid/failed. `complete` means every planned cell has a recorded disposition, including skips; inspect totals before treating a run as a complete measured matrix. Bytes mean decoded response-body bytes. Node/device metadata is recorded, not browser latency. Runtime bounds cover network waiting; synchronous JSON analysis and checkpoint serialization can extend final wall time slightly.

Clock, sleep, measurement, logging and persistence are injectable. `benchmark-comparison-run.test.mjs` checks cooldown, deadline, per-operator stop, Retry-After and total byte accounting without network requests.

## Slot gating

`readStatus` is optional and defaults to undefined, so every pre-2026-09-20
invocation and artifact stays reproducible. When supplied (the CLI passes
`fetchStatus` unless `--no-status` is given) the runner, after the operator
cooldown and before each request:

- reads `/api/status` for the cell's endpoint;
- if no slot is free, **skips** when the reported wait exceeds the remaining
  budget, otherwise sleeps it and **re-reads** rather than trusting the first
  snapshot's estimate;
- records the reading as `statusBefore` on the result row;
- after a **failed** request only, reads again as `statusAfter`.

The asymmetry is deliberate. Reading after every success would double the
request count against the operator for no diagnostic gain, whereas a reading at
a refusal is the entire point: a 504 arriving in ~10 s with slots still free is
a query killed on arrival, not queueing. The 2026-09-19 run could not tell those
apart about its own three 504s, and reported server load for what its own
recovery artifact showed was something else.

A failed status read never blocks the run - the request proceeds on the blind
cooldown as before - and is never recorded as a free slot.
