# fused-tally.ts

## Purpose

The `?qrperf` tally of the QR demo's fused pose (QR near-frontal pose plan
2026-09-23-2314, M3b b5): so the owner's pasted phone-run JSON says whether
the fused pose helped - how often it was stable, how often the views
disagreed (the averaging fallback), how well the views fit, and how far the
joint rotation sat from today's averaged one.

## Public API

- `createFusedTally()` -> `{ add(result: QrFusedPose, atMs), summary() }`.
  - `summary()`: `{ locks, stable, joint, averaged, frameChanges, fitP50Px,
fitP95Px, deltaP50Deg, deltaP95Deg, jumpDeg, wallElevationDeg }`; the
    percentiles are nearest-rank over the FINITE values only (`null` when
    there are none).
  - `frameChanges`: how often the fused results' frame epoch moved on - did
    the demo see a tracking restart (field test C, plan §25).
  - `jumpDeg` `{ n, p50, p95, max }` and `wallElevationDeg` `{ n, p50Abs,
p95Abs, meanSigned }`: the STABLE fused pose's own quality (what the
    overlay shows) - jumps between consecutive stable results within 1 s and
    in one epoch, and the code normal's elevation (0 for a wall code, 90 for
    a code flat on a table).
- `fusedLines(summary)` - the two report lines: the tally, then `fused pose
(stable): jump ... | wall elevation ...`.

## Invariants & assumptions

- One `add` per LOCK (the demo calls it from `resolveStablePose`), not per
  HUD render.
- `joint + averaged <= locks`: an `unknown` result has neither method.
- Percentiles use `pipeline-timings.ts`'s `nearestRankPercentile`, like the
  rest of `?qrperf`.

## Tests

`fused-tally.test.ts`: the stable fused pose's wall elevation; jumps between
consecutive stable results within 1 s (a measuring result is left out, a
gap breaks the pair); frame changes counted and never paired across. Also
`qrperf-instrument.test.ts` ("tallies the fused results per lock into the
report and the JSON").
