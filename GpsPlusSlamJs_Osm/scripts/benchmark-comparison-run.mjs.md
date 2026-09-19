# Bounded comparison runner

`runComparison(cells, options)` executes an explicit plan serially and checkpoints the full document after each completed or skipped row. Used by `benchmark-endpoints.mjs --compare-map3d`.

The existing matrix policy supplies 60-second operator cooldown and two-failure threshold. This focused run conservatively stops the whole operator after two failures of any kind; there is no automatic retry or readmission. Numeric and date Retry-After values extend the cooldown. Each request's timeout and byte cap are bounded by the remaining run budget. This is a benchmark policy, not the production retry policy.

Results distinguish planned/sent/skipped/valid/failed. `complete` means every planned cell has a recorded disposition, including skips; inspect totals before treating a run as a complete measured matrix. Bytes mean decoded response-body bytes. Node/device metadata is recorded, not browser latency. Runtime bounds cover network waiting; synchronous JSON analysis and checkpoint serialization can extend final wall time slightly.

Clock, sleep, measurement, logging and persistence are injectable. `benchmark-comparison-run.test.mjs` checks cooldown, deadline, per-operator stop, Retry-After and total byte accounting without network requests.
