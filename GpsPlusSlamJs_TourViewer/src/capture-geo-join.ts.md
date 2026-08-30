# capture-geo-join.ts

## Purpose

The capture-time geo join's pure core (plan
`2026-08-26-1130-capture-time-geo-join`, Rev 2): decide whether a REPLAYED
recording supports trustworthy photo placement, and compute a world pose
for every captured photo — so the AR view places photos where they were
taken instead of ringing them around the QR code.

## Public API

- `preflightCaptureJoin(meta, actionTypes)` — the BEFORE-replay half (the era
  gate and the segmenting-action scan) so a declined zip never pays the
  seconds-long replay.
  - The era gate is `odomCoordVersion >= MIN_SUPPORTED_ODOM_COORD_VERSION`
    (**4**), and the value must also be a **number** and an **integer** — a
    hand-edited `session.json` carrying `null` or `"9"` would otherwise slip
    past a bare comparison into a raw replay of an unknown era. This sidecar
    said `=== 5` until the PR #368 review caught it, which had it declining
    era-4 zips on paper while the code accepted them.
- `assessReplayedJoin(state): JoinAssessment` — the AFTER-replay half; every
  `ok: false` carries a plain-words reason and means "keep the ring".
  - Preflight declines: wrong/unknown era, or a segmenting action present
    (`odometryTrackingRestarted` / `arLoopClosureDetected` — a restart
    WIPES and a loop closure DEFORMS the alignment's odometry history
    while `odometryPath.points` keeps every capture, so the final
    alignment is only valid for the last segment; V1 declines whole
    recordings, per-segment joins are the filed follow-up).
  - State declines: null `gpsData`, missing zero, pairs <
    `MIN_ALIGNMENT_SAMPLES`, malformed or IDENTITY alignment (the
    degenerate solve's default), zero captures.
    - "Malformed alignment" covers the ROTATION beside the matrix, not
      only the matrix (PR #376/#378 review). `alignmentRotation` must be
      length-4, finite, AND a UNIT quaternion - checked with the
      framework's own `renormalizeUnitQuaternion`, the same contract
      `parseQrLevel` and `mintQrGeoPose` use. Length + finiteness alone
      admits `[0,0,0,0]`, which `Matrix4.compose` turns into the
      IDENTITY, so every photo would face East while the status line
      still reported success.
  - `ok: true` carries `{ pairCount, gpsAccuracyMedianM }` — the honest
    quality the viewer surfaces ("placed from N fixes, ±X m").
- `computeCaptureGeoJoin(state): CaptureWorldPose[]` — per capture:
  `fusedGpsFromOdom(alignmentMatrix, odomPos, zero)` → geo with ABSOLUTE
  altitude (the library's documented contract — NOT zero-relative), plus
  `rotationNue = alignmentRotation ∘ captureRotation ∘ WEBXR_TO_NUE` —
  the trailing basis factor is LOAD-BEARING because the state stores
  CONJUGATED quaternions (milestone review, finding 1; the directional
  tests pin it). D3: photos face as captured. Throws if called without a passing assessment.
  - **Returns FEWER poses than captures when a capture cannot be placed**
    (PR #370 review). A capture whose fused geo has a missing or non-finite
    lat/lon/altitude is DROPPED. It used to default the altitude to 0, and
    since the caller converts back with a zero altitude of 0 — so NUE y IS
    absolute altitude — that put the photo at sea level, hundreds of metres
    under an inland visitor, while the status line still claimed
    "N photos at capture spots". Zero is a VALID altitude, so the drop keys
    on missing-or-non-finite, never on falsy. When nothing survives, the
    caller falls back to the photo ring.
  - **A capture's own `rotation` is dropped on the same terms** (PR #378
    review): length-4, finite, and unit-norm, via the same
    `renormalizeUnitQuaternion`. A non-unit quaternion survives
    `image-planes.ts`'s own check, reaches `mesh.quaternion.copy(...)`,
    and the plane silently never renders - while `viewerPlanesInfo` still
    counts it, because `count` is `meshes.length`.
    - The finiteness check runs FIRST and is load-bearing:
      `renormalizeUnitQuaternion` does NOT reject non-finite input -
      `Math.hypot` yields `NaN` and `Math.abs(NaN - 1) > 1e-3` is false, so
      a `NaN` quaternion comes back as a `NaN` quaternion rather than
      `undefined`.
    - Both COMPOSED rotations use the RETURNED value, not the call as a
      predicate, so `rotationNue` is exactly unit rather than unit only to
      within the 1e-3 tolerance: the per-capture rotation since PR #379, and
      the ALIGNMENT rotation since PR #380 - which matters more, because
      `alignmentQuat` multiplies into every plane at once, `image-planes.ts`
      copies it with no normalise, and Three composes the matrix as
      `R * |q|^2`. An off-unit alignment therefore scaled the whole photo
      constellation by up to ~0.2 %. Fixing one and not the other is the
      same asymmetry this file has now been corrected for three times.
    - The ASSESSMENT path at `assessReplayedJoin` still uses it as a
      predicate, correctly: it returns a verdict, not a rotation.
    - `computeCaptureGeoJoin` re-derives `toAlignmentMatrix` itself and
      throws on a bad alignment rotation, so a caller that skips
      `assessReplayedJoin` fails loudly instead of feeding NaN quaternions
      into `ThreeQuaternion`.
- `ReplayedJoinState` — structural slice of the replayed
  `CombinedRootState`, deliberately narrow so tests need no full store.

## Invariants & assumptions

- **Inputs are REPLAYED STATE (NUE)**, never raw action payloads (those
  are raw WebXR; the reducer converts on dispatch). The caller loads the
  stream ONCE (`loadRecordingActions`), gates, then replays the SAME
  array via `replayActions` - never `replayRecording` over the source,
  which would re-read the zip and replay before the era gate (milestone
  review, finding 8).
- **Accuracy model (owner-corrected, plan Rev 2):** the captures are a
  rigid constellation in SLAM space; the whole set shares the final
  alignment's error. Quality is reported, not guessed.
- This module never touches the zip: the caller feeds it `loadSessionMeta()`,
  the action-type list, and the replayed state.

## Examples

```ts
const actions = await session.loadRecordingActions();
const pre = preflightCaptureJoin(
  await session.loadSessionMeta(),
  actions?.map((a) => a.type) ?? [],
);
if (actions === null || !pre.ok) return placeRing(pre);
const state = await replayActions(actions, { onChunk: showProgress });
const verdict = assessReplayedJoin(state);
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
