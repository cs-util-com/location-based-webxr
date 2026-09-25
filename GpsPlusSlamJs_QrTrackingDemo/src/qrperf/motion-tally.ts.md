# motion-tally.ts

## Purpose

The `?qrperf` tally of the framework motion detector's readings (QR
near-frontal pose plan 2026-09-23-2314, §26, §30): what the owner's phone
repeat of tests A (still wall code) and E (hand-held) must answer from the
pasted JSON alone - may the demo switch into "moving" after 2 detections
instead of 4, and does the converging size estimate read as motion. Fed by
`fused-tally.ts`, one reading per lock.

## Public API

- `createMotionTally()` -> `{ add(result, atMs, size?), summary() }`.
  - `add`: one fused result (its `motion` reading; results without one are
    ignored), at `atMs` on any monotonic clock; `size` (`SizeState`: the
    size lifecycle and estimate) is remembered and used for later readings
    that come without one.
  - `summary()` -> `MotionTallySummary`:
    - `n`, `still`, `moving`, `turning`, `movingTurning`: readings per mode;
      `switches`: mode switches within a frame epoch;
    - the STILL readings' signals, p50/p95/p99/max: `turnSignal*Px` (the
      newest view's corner error at the others' rotation, against `turnPx`)
      and `moveSignal*Cm` (its position offset, against `moveM`). During
      motion the signals measure the motion, so they are left out;
    - `candidateRuns.{moving,turning}` `{ r1, r2, r3, r4plus }`: runs of
      consecutive candidates that BEGAN while the mode was still, by length.
      A run of 2 or 3 would have flipped a 2- or 3-detection rule; 4+ is
      what the current rule confirms. A run is counted when it ends, at a
      frame change, or as it stands at the summary;
    - `switchLog` `{ log, dropped }`: the first 60 confirmed switches, each
      `{ from, to, sinceFirstMs, sinceEpochMs, sizeStatus, sizeCm, offsetCm,
turnSignalPx, speedCmS, turnRateDegS }` (cm values rounded to 0.01),
      and how many more there were;
    - `stillTurnSignalByEdgePx`: the still turn signal per code-size band
      (the newest view's edge length; `edge-bands.ts`, plan §34 R2);
    - `duringMotion` `{ n, noSignal, turnSignalP50Px, turnSignalP95Px,
moveSignalP50Cm, moveSignalP95Cm }`: the readings while the mode was
      moving or turning, how many carried no signal (they neither confirm
      nor end a motion), and their signals - so a mode that holds can be
      told from a stuck detector (test E1 could not).
- Types: `SizeState`, `MotionTallySummary` (exported); `RunLengths` and
  `MotionSwitch` are the shapes inside the summary.

## Invariants & assumptions

- **One code.** The tally is not keyed per payload (the fused tally is
  not either, b5 review #6); field tests A and E use one code.
- A switch across a frame epoch is not a switch (the detector restarts).
- A `sizeCm` / `sizeStatus` of null means the demo had no size state yet.

## Tests

`fused-tally.test.ts` ("createFusedTally motion", "for the phone repeat"):
modes and switches (none across an epoch), still-only signal percentiles
with p99 and max, candidate runs by length (candidates during a confirmed
motion start no run; open runs close at a frame change and count at the
summary), the switch log with its timing and size state, the log cap and
its dropped count, the report lines, the still turn signal per size band,
and the readings during motion with their no-signal count. Also `qrperf-instrument.test.ts`
("hands the size state to the motion tally").
