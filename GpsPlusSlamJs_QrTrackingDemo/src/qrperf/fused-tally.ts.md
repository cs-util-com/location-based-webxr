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

- `createFusedTally()` -> `{ add(result: QrFusedPose, atMs, size?), summary() }`
  (`size`: the code's size state then, for the motion switch log).
  - `summary()`: `{ locks, reReads, stable, joint, averaged, frameChanges, fitP50Px,
fitP95Px, deltaP50Deg, deltaP95Deg, jumpDeg, positionJumpCm, wallElevationDeg,
motion }`; the percentiles are nearest-rank over the FINITE values only
    (`null` when there are none). Fit and joint-vs-averaged count only
    windows of at least 5 views - the ones the gate can open on; a
    motion-cut 1-view window or an early small one fits trivially and would
    pull them down (b5 review #5).
  - `reReads`: locks whose result hands back the SAME newest detection
    as the last tallied one (same epoch, equal timestamp - a clock step back
    is not a re-read, plan §57 #6) - since plan §54 a native frame of a code whose order is known,
    which the fused window does not read. Counted apart and NOTHING else
    (plan §55 #3: they would add 0 deg jumps, duplicate motion readings and
    stable locks from an unchanged window); `locks` excludes them. The
    phone's proof that the rule fired on a native NEWEST entry.
  - `nativeIgnoredLocks`: locks (re-reads excluded) whose run had native
    entries ignored (`nativeIgnored` > 0, plan §57 #2) - the rule at work
    inside a window, which `reReads` cannot see.
  - `frameChanges`: how often the fused results' frame epoch moved on - did
    the demo see a tracking restart (field test C, plan §25).
  - `jumpDeg` and `positionJumpCm` `{ n, p50, p95, max }` (the same pairs'
    rotation and position jumps; position added for plan §30) and
    `wallElevationDeg` `{ n, p50Abs,
p95Abs, meanSigned }`: the STABLE fused pose's own quality (what the
    overlay shows) - jumps between consecutive stable results within 1 s and
    in one epoch, and the code normal's elevation (0 for a wall code, 90 for
    a code flat on a table).
  - `motion`: the motion detector's readings - modes, switches, the still
    signals (also per code-size band), candidate runs, the switch log, and
    the readings during motion (`motion-tally.ts`).
  - `notStable` `{ views, fit, fallback, motion, order }`: how many locks were not
    stable for each `QrFusedPose.notStableReason` (plan §34 R1/R2).
  - `fitByEdgePx` (the fit over the same >= 5-view windows) and
    `stableByEdgePx` `{ locks, stable }` per code-size band (the window's
    median edge length; `edge-bands.ts`).
- `fusedLines(summary)` - the report lines: the tally, `fused pose
(stable): jump ... position jump ... | wall elevation ...`, and three
  `motion` lines (modes and switches; still signals p50/p95/p99/max;
  candidate runs from still, 1/2/3/4+), plus `fused not stable: ...`,
  `fused by code size ...` and the motion lines by code size and during
  motion.

## Invariants & assumptions

- One `add` per LOCK (the demo calls it from `resolveStablePose`), not per
  HUD render.
- `joint + averaged <= locks`: an `unknown` result has neither method.
- Percentiles use `pipeline-timings.ts`'s `nearestRankPercentile`, like the
  rest of `?qrperf`.

## Tests

`fused-tally.test.ts`: the not-stable reasons; the fit and the stable
share per code-size band; the stable fused pose's wall elevation; jumps between
consecutive stable results within 1 s (a measuring result is left out, a
gap breaks the pair), and their position jumps; fit and delta over windows
of at least 5 views; frame changes counted and never paired across; the
motion modes, switches (none across an epoch) and signal percentiles, and
the motion report line. Also
`qrperf-instrument.test.ts` ("tallies the fused results per lock into the
report and the JSON").
