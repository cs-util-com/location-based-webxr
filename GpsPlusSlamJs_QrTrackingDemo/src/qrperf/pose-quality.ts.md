# pose-quality

## Purpose

The pose section of the `?qrperf` report: how much the solved code orientation
jumps between consecutive detections, how much the corners jitter while the
phone is still, the reprojection error, and the code normal's elevation
against gravity. It is the phone-side before/after for the near-frontal pose
fix (QR near-frontal pose plan 2026-09-23-2314, M1). Pure.

## Public API

- Also exported for `fused-tally.ts` (one definition in the package):
  `quatAngleDeg(a, b)`, `normalElevationDeg(q)` and `MAX_PAIR_GAP_MS` (1000).
- `createPoseQuality({ window? })` - `window` is the number of values kept per
  series (default 240, ~30 s at 8 Hz). Returns:
  - `add(sample: PoseQualitySample)` - one solved detection: `text`,
    `qrRotationWorld` (xyzw; +z is the printed face's normal), `corners`,
    `cameraPosition`, `cameraRotation`, `reprojectionErrorPx`, `atMs`.
  - `summary(): PoseQualitySummary`:
    - `pairs`, `jumpDeg { p50, p95, max }`,
      `jumpShare { over3, over5, over10 }` (fractions), `jumpsOver60`;
    - `stillJitterPx { strict, loose }`, each `{ n, p50, p95 }`;
    - `reprojectionPx { n, p50, p95 }`;
    - `reprojectionByEdgePx`: the same error per code-size band (the
      corners' `meanEdgePx`; `edge-bands.ts`, same 240-value window per
      band) - the single-frame 4 px gate is absolute too (plan §34 R2);
    - `wallElevationDeg { n, p50Abs, p95Abs, meanSigned }`.
    - Empty series give `n` 0, shares 0 and `NaN` percentiles.

## Invariants & assumptions

- **Pairs are consecutive samples of the SAME code** (`text`) at most 1 s
  apart (`atMs`); another code in between, or a longer gap (the code was
  lost), breaks the pair.
- **A jump over 60 deg is a corner-order change,** so that pair is kept out
  of the jitter series (its corners were relabelled, not moved). A jump is the rotation angle between the two world
  orientations.
- **Jumps show smoothness, not accuracy:** they drop under any filter. The
  elevation is the absolute check: for a code on a vertical wall the truth is 0
  (WebXR's world is y-up), so it measures one tilt axis against gravity.
- **Jumps over 60 deg are counted apart** from pose noise: a corner-order snap
  (Cause A) is a 90 deg jump.
- **Still gates** on the camera motion between the two frames: strict 2 mm /
  0.1 deg, loose 5 mm / 0.3 deg (two values, so no single gate carries the
  reading). The jitter is the largest corner displacement, in pixels. It is a
  LOWER bound on the per-frame corner error: a static quantisation bias does
  not move between frames.
- Percentiles are nearest-rank (`pipeline-timings.ts`); the quaternion angle is
  a local one-liner (the framework's `geodesicAngleRad` is not a built entry).
- Inputs are trusted here; the instrument's `wrapSolve` validates their shape
  before calling `add`.

## Examples

```ts
const q = createPoseQuality();
q.add({
  text: "code",
  qrRotationWorld: [0, 0, 0, 1],
  corners,
  cameraPosition: [0, 0, 0],
  cameraRotation: [0, 0, 0, 1],
  reprojectionErrorPx: 0.4,
});
q.summary().wallElevationDeg.meanSigned; // 0 for an upright wall code
```

## Tests

`pose-quality.test.ts`: jumps between consecutive same-code poses, no pairing
across codes, the over-60 bin, both still gates (translation and rotation),
reprojection percentiles (also per code-size band), signed and absolute elevation, empty summaries, and
a deterministic grid of invariants (p50 <= p95 <= max, ordered shares, counts
bounded by the window).
