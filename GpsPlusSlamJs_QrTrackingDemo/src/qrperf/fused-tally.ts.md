# fused-tally.ts

## Purpose

The `?qrperf` tally of the QR demo's fused pose (QR near-frontal pose plan
2026-09-23-2314, M3b b5): so the owner's pasted phone-run JSON says whether
the fused pose helped - how often it was stable, how often the views
disagreed (the averaging fallback), how well the views fit, and how far the
joint rotation sat from today's averaged one.

## Public API

- `createFusedTally()` -> `{ add(result: QrFusedPose), summary() }`.
  - `summary()`: `{ locks, stable, joint, averaged, fitP50Px, fitP95Px,
deltaP50Deg, deltaP95Deg }`; the percentiles are nearest-rank over the
    FINITE values only (`null` when there are none).
- `fusedLine(summary)` - the report line, e.g. `fused: 40 locks | stable 30 |
joint 38 / averaged 2 | fit p50/p95 0.6/1.1 px | vs averaged p50/p95
2.1/6.0 deg`.

## Invariants & assumptions

- One `add` per LOCK (the demo calls it from `resolveStablePose`), not per
  HUD render.
- `joint + averaged <= locks`: an `unknown` result has neither method.
- Percentiles use `pipeline-timings.ts`'s `nearestRankPercentile`, like the
  rest of `?qrperf`.

## Tests

Covered through `qrperf-instrument.test.ts` ("tallies the fused results per
lock into the report and the JSON").
