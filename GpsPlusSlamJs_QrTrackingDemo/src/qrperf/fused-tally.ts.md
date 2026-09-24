# fused-tally.ts

## Purpose

The `?qrperf` tally of the QR demo's fused pose (QR near-frontal pose plan
2026-09-23-2314, M3b b5): so the owner's pasted phone-run JSON says whether
the fused pose helped - how often it was stable, how often the views
disagreed (the averaging fallback), how well the views fit, and how far the
joint rotation sat from today's averaged one - and, for the motion detector
(plan §26), which modes it showed and what its raw signals measured on the
phone, which is what its provisional thresholds are set against.

## Public API

- `createFusedTally()` -> `{ add(result: QrFusedPose, atMs), summary() }`.
  - `summary()`: `{ locks, stable, joint, averaged, frameChanges, fitP50Px,
fitP95Px, deltaP50Deg, deltaP95Deg, jumpDeg, wallElevationDeg, motion }`; the
    percentiles are nearest-rank over the FINITE values only (`null` when
    there are none).
  - `frameChanges`: how often the fused results' frame epoch moved on - did
    the demo see a tracking restart (field test C, plan §25).
  - `jumpDeg` `{ n, p50, p95, max }` and `wallElevationDeg` `{ n, p50Abs,
p95Abs, meanSigned }`: the STABLE fused pose's own quality (what the
    overlay shows) - jumps between consecutive stable results within 1 s and
    in one epoch, and the code normal's elevation (0 for a wall code, 90 for
    a code flat on a table).
  - `motion` `{ n, still, moving, turning, movingTurning, switches,
turnSignalP50Px, turnSignalP95Px, moveSignalP95Cm }`: over results that
    carry a motion reading - the modes shown, the mode switches within one
    frame epoch, and the raw signals over STILL readings only (the newest
    view's corner error at the others' rotation, which the 3 px turning
    threshold must sit above; its position offset in cm, the 3 cm moving
    threshold). During motion the signals measure the motion, not the
    noise, so a hand-held run would otherwise read as a noisy phone.
- `fusedLines(summary)` - the three report lines: the tally, `fused pose
(stable): jump ... | wall elevation ...`, and `motion: still … | switches …
| still turn signal … | still move signal …`.

## Invariants & assumptions

- One `add` per LOCK (the demo calls it from `resolveStablePose`), not per
  HUD render.
- `joint + averaged <= locks`: an `unknown` result has neither method.
- Percentiles use `pipeline-timings.ts`'s `nearestRankPercentile`, like the
  rest of `?qrperf`.

## Tests

`fused-tally.test.ts`: the stable fused pose's wall elevation; jumps between
consecutive stable results within 1 s (a measuring result is left out, a
gap breaks the pair); frame changes counted and never paired across; the
motion modes, switches (none across an epoch) and signal percentiles, and
the motion report line. Also
`qrperf-instrument.test.ts` ("tallies the fused results per lock into the
report and the JSON").
