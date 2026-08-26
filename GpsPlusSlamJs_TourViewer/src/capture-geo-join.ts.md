# capture-geo-join.ts

## Purpose

The capture-time geo join's pure core (plan
`2026-08-26-1130-capture-time-geo-join`, Rev 2): decide whether a REPLAYED
recording supports trustworthy photo placement, and compute a world pose
for every captured photo — so the AR view places photos where they were
taken instead of ringing them around the QR code.

## Public API

- `assessReplayForJoin(actionTypes, state): JoinAssessment` — every
  `ok: false` carries a plain-words reason and means "keep the ring".
  Declines: a segmenting action present (`odometryTrackingRestarted` /
  `arLoopClosureDetected` — a restart WIPES and a loop closure DEFORMS the
  alignment's odometry history while `odometryPath.points` keeps every
  capture, so the final alignment is only valid for the last segment; V1
  declines whole recordings, per-segment joins are the filed follow-up),
  null `gpsData`, missing zero, pairs < `MIN_ALIGNMENT_SAMPLES`, the
  IDENTITY alignment (the degenerate solve's default), zero captures.
  `ok: true` carries `{ pairCount, gpsAccuracyMedianM }` — the honest
  quality the viewer surfaces ("placed from N fixes, ±X m").
- `computeCaptureGeoJoin(state): CaptureWorldPose[]` — per capture:
  `fusedGpsFromOdom(alignmentMatrix, odomPos, zero)` → geo with ABSOLUTE
  altitude (the library's documented contract — NOT zero-relative), plus
  `rotationNue = alignmentRotation ∘ captureRotation` (D3: photos face as
  captured). Throws if called without a passing assessment.
- `ReplayedJoinState` — structural slice of the replayed
  `CombinedRootState`, deliberately narrow so tests need no full store.

## Invariants & assumptions

- **Inputs are REPLAYED STATE (NUE)**, never raw action payloads (those
  are raw WebXR; the reducer converts on dispatch). The caller must use
  `replayRecording` — which this feature widened to accept the streaming
  `ZipSource` — not hand-parsed zip entries.
- **Accuracy model (owner-corrected, plan Rev 2):** the captures are a
  rigid constellation in SLAM space; the whole set shares the final
  alignment's error. Quality is reported, not guessed.
- Era gating (`session.json` `odomCoordVersion`) is the CALLER's job —
  this module never sees the zip.

## Examples

```ts
const state = await replayRecording(new ByteSourceReader(archive.source));
const verdict = assessReplayForJoin(actionTypes, state);
if (verdict.ok) {
  const poses = computeCaptureGeoJoin(state);
  // place each pose via calcRelativeCoordsInMeters(viewerZero, pose.geo, …)
}
```

## Tests

`capture-geo-join.test.ts` — every decline reason non-vacuously, the
hand-checkable translation transform (absolute altitude, magnitude guard
against a degrees/metres confusion), the rotation composition, the
assess-first throw. `capture-geo-join.property.test.ts` — the round-trip
property: geo re-projected into the zero's NUE equals the aligned odom
position for arbitrary translations and capture positions (mm-level
geodesy tolerance).
