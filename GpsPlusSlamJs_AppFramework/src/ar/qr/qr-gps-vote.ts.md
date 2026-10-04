# qr-gps-vote.ts

**Purpose:** Turn a solved QR pose into synthetic GPS observation(s) for the
existing weighted alignment + outlier-rejection fusion — Phase 5 / §6 of the
[QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md).
A QR does **not** rigidly re-anchor the scene; it votes via the normal
`recordGpsEvent` path, so under the core's default hard outlier trim a bad
detection is still rejectable as an outlier. Each vote weighs about as much as
one GPS fix (see "Invariants"); a code's pull comes from the number, spread and
recency of its votes.

## Public API

- `buildQrGpsVotes(input): RecordGpsEventPayload[]` — the payloads for one
  detection. 4 corner correspondences by default (`multiCorrespondence`), or 1
  center correspondence. Each pairs the corner's odom position (solved pose) with
  its absolute geo position (level file), stamped with `syntheticAccuracyM` and
  `source: GPS_POINT_SOURCE_SYNTHETIC_QR` (the core's provenance field, kept on
  the stored point: without it the core, a recording and every GPS listener
  read a vote as a device fix - the Tour Viewer's keep-alive, which re-votes on
  device fixes, would feed on its own votes).
  Throws `RangeError` on non-positive `sizeM` / `syntheticAccuracyM`.
  - **Wide-baseline mode (Note 2):** `baselineM > 0` switches to `count` (≥3)
    correspondences on a regular polygon of that radius in the QR plane instead
    of the physical corners. Because the full pose + geo + heading are known, the
    virtual points are consistent in both odom and geo space by construction; the
    wide radius is the **north-stiffness lever arm** and `count` the **dominance**
    (vote-count) half of the knob. Physical-corner mode is the `baselineM = 0`
    special case. Throws `RangeError` for `count < 3` (collinear). ⚠️ Adds no new
    information (all points derive from one pose) — a larger `count` makes a bad
    detection harder for the outlier-rejection step to reject, so it is a
    **bounded** tuning knob,
    safe only because the pre-injection gates ensure only good detections vote.
- `localPlaneToEnu(localX, localY, headingDeg): Enu` — QR-plane offset → ENU
  meters (vertical-QR convention: +y = up, +x along `headingDeg` clockwise from
  North → `east = x·sin h`, `north = x·cos h`).
- `offsetGeo(center, enu): {latitude, longitude, altitude}` — apply an ENU meter
  offset to a geo pose. Delegates to the library's `calcGpsCoords` (quality-review
  A-3 — same geodesy as every other conversion in the stack; the former local
  111320-both-axes approximation differed by ≈0.17 % in latitude, <2 mm at QR
  scale) and keeps the cos(lat)→0 pole guard the library helper lacks. Altitude
  is composed locally (`center.alt + enu.up`).
- `QrGeoPose`, `QrGpsVoteInput`, `Enu`. (The former `METERS_PER_DEG_LAT` export
  was removed with the delegation — no consumer existed in either workspace root.)

## 6-DoF extension (QR-pose plan 2026-08-25)

- `QrGeoPose` carries an optional `rotation` — a unit quaternion in the
  NUE GPS-world frame over the QR's local axes — alongside the legacy
  vertical-poster `headingDeg` (now optional; at least one must be
  present, rotation wins when both are). `localPlaneOffset(local, geo)` is
  the orientation-dispatching mapper `buildQrGpsVotes` uses; a
  vertical-poster quaternion (−heading about Up) reproduces the heading
  path exactly (property-tested — note local +x points TOWARD headingDeg,
  so the printed face's normal sits at heading + 90°).

## Invariants & assumptions

- **`weight = 1/max(accuracy, 1 m)^gpsAccuracyExponent`** is computed by the
  core from `latLongAccuracy`, with a default exponent of 0.1: a 5 m vote weighs
  0.85, a 3 m fix 0.90, and a 0.05 m vote is clamped to 1.0 - about 1.17x a
  5 m fix, not the ~10x an earlier version of this page claimed. The accuracy
  therefore cannot make a vote dominant; the Tour Viewer's measurement of what
  does (ring radius, votes per lock, a keep-alive) is in
  [the vote-strength results](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-1433-viewer-vote-strength-results.md).
- **4 corners are coplanar.** They constrain the in-plane axes and translation
  well; the QR-normal (depth) DOF stays weakest — exactly what
  [qr-occupancy-check.ts.md](qr-occupancy-check.ts.md) guards. Do not treat the
  4 corners as a substitute for the size sanity check.
- **Vertical-QR geo convention (legacy heading path):** local +Y = world up,
  local +X = horizontal at `headingDeg`. A flat-on-floor or tilted QR is
  carried by the 6-DoF `rotation` path (see the extension section above).
- **Frame split:** `odomPosition` is raw-WebXR/odom (the reducer applies
  `webxrToNUE` on store); `rawGpsPoint` is absolute lat/lon/alt. The library
  computes the derived NUE coordinates + weight on dispatch.
- Pure: builds payloads only. Dispatching is the caller's job (Phase 6).

## Examples

```ts
const votes = buildQrGpsVotes({
  qrPoseWorld: solution.qrPoseWorld,
  sizeM: level.qr.physicalSizeM,
  qrGeo: level.qr.geo,
  syntheticAccuracyM: 5,
  baselineM: 30, // the Tour Viewer's ring (M0b/M0c)
  count: 8,
});
for (const v of votes) store.dispatch(recordGpsEvent(v));
```

## Tests

- `qr-gps-vote.test.ts` — ENU/geo conversions, 4-vs-1 correspondence, odom
  positions match the transformed object points, altitude spread, accuracy
  and source stamping (every mode), rotation override, input validation.
- `qr-gps-vote.property.test.ts` — for any size/heading/location the geo corners
  back-convert to a centered square of side `sizeM` whose centroid is the QR
  center (so the fusion sees the same rigid square in both frames); and for any
  baseline/count the wide-baseline geo ring is congruent to the odom ring with
  every point at `baselineM` from the center.
- `qr-gps-vote.integration.test.ts` — the votes flow through the real
  `createSlamAppStore` + `recordGpsEvent` fusion and yield a finite alignment;
  the stored points keep the synthetic-QR source; a lone grossly-wrong high-weight vote does not produce a non-finite alignment
  (outlier-rejection robustness — the magnitude of the "shift toward QR" is
  validated by the Phase 6 demonstrator).

## Related

- Consumes `qrPoseWorld` from [qr-pose.ts.md](qr-pose.ts.md).
- Mirrors the normal GPS path in
  [gps-event-coordinator.ts.md](../../state/gps-event-coordinator.ts.md).
