# visitor-position.ts

## Purpose

Where the visitor is, for the station run (tour kit plan K4): the camera
in the session's GPS-world NUE (the raw AR pose through the solved
alignment - the frame the tour's content and the wayfinding HUD use) and
the GPS points its precision is judged by (the framework's one rule,
`gps-plus-slam-app-framework/state/position-precision`, applied by the
guide). Plan:
`GpsPlusSlamJs_Docs/docs/2026-10-03-2219-tour-kit-stations-scenes-quiz-and-signed-tours-plan.md`.

## Public API

- `visitorPosition({ alignment, arPose, gpsPositions, zero? }): VisitorPosition`
  - `nue` - `[north, up, east]`, or null without an alignment, an AR pose,
    a finite pose, or a readable alignment;
  - `gpsPoints` - the session's GPS points as given (`gpsPositions`),
    carried for the guide's `positionPrecision`, which takes the median
    reported accuracy of the latest 10 DEVICE fixes (the window, the
    device-only filter and the skipping of fixes without a usable
    accuracy are the framework's; this file had its own median until M2
    of `GpsPlusSlamJs_Docs/docs/2026-10-19-1345-shared-position-precision-plan.md`).
  - `fixNue` - where the latest DEVICE fix alone puts the visitor
    (`[north, up, east]` from the zero), or null without a zero or a device
    fix. Never moved by a code's votes, which pull `nue` onto the code's
    saved spot: the station guide judges a code lock by it (K4 review R1).
  - `aligned` - the session has a usable alignment (16 finite numbers): a
    null `nue` then means only a tracking drop (no AR pose), never "no
    alignment yet". The station guide's raw fix stands in only without
    one (M5a review M3).
  - `fixAtMs` - the latest device fix's own time (its Geolocation
    timestamp, epoch ms), or null when `fixNue` is or that fix's time is
    missing or not finite (validated here, never NaN): the guide ignores a
    fix older than `FIX_MAX_AGE_MS`, and one with no time.
  - `fixAccuracyM` - the latest device fix's own reported accuracy (m),
    or null when `fixNue` is or that fix states none (missing, zero,
    negative, not finite). Where the fix alone is the position, the guide
    judges it by the worse of this and the device median: one ±40 m Wi-Fi fix
    after a run of ±5 m GPS fixes leaves the median at 5 m (r881
    re-review M-A).

## Invariants & assumptions

- **Device fixes only** (authoring plan §3.6, §7j #3), by the framework's
  rule: the viewer's code votes carry their own fixed accuracy and would
  make a phone in an urban canyon look precise; a fix without a usable
  accuracy is skipped. `fixNue`, `fixAtMs` and `fixAccuracyM` read the
  latest device fix by the same source check (`gpsPointSourceOf`).
- The window (about 10 s at 1 Hz, the median, so one outlier neither
  widens nor shrinks every station) is the framework's
  `DEVICE_ACCURACY_WINDOW_FIXES`; its reasoning lives in that sidecar.
- The camera position goes through `throughAlignment(odomNueFromWebXr(...))`
  (`visit-anchoring.ts`), the composition the settle uses.

## Examples

```ts
const p = visitorPosition({
  alignment: selectAlignmentMatrix(state),
  arPose: seams.getArPose(),
  gpsPositions: selectGpsPositions(state),
});
```

## Tests

- `visitor-position.test.ts` - a real store aligned by a shifted walk puts
  the camera where the shift says; no position without each input; the
  carried points judged by the shared rule (the median of the latest ten
  device fixes, votes and older fixes ignored);
  `aligned` with a dropped pose and without an alignment, and the latest
  device fix's time (never a vote's), null for a missing or non-finite
  timestamp.

## The camera's forward (visitor walk W4 build plan M3)

- `ArPoseLike.orientation?` - the raw WebXR quaternion `[x, y, z, w]`.
- `VisitorPosition.forwardNue?` - the camera's forward (raw WebXR -Z)
  in GPS-world NUE through the alignment, a unit vector; null without an
  alignment or an orientation, or for a non-finite or zero quaternion.
- `cameraForwardNue(alignment, arPose)` computes it: the pose through
  `odomNueFromWebXr` and `throughAlignment`, then `(0, 0, -1)` rotated by
  the result. The station guide turns it into the radar's heading.
- Tests: the `cameraForwardNue` describe in `visitor-position.test.ts`
  (identity looks north; a raw +Y quarter turn looks west; an alignment
  rotating north to east looks east; the null cases).
