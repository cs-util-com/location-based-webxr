# tracker-capture-wiring.ts

## Purpose

The visitor's tracker capture gate for one AR session. It creates the
framework's generic gate
([tracker-capture-gate](../../GpsPlusSlamJs_AppFramework/src/ar/targets/tracker-capture-gate.ts.md))
and registers QR, the first tracker, with the tour's codes as its targets.
The camera asks `wantsFrame` before each capture: full cadence while a code
is near (the nearby-targets kernel) or right after any code was read, 1 Hz
otherwise, so codes without a position and codes of other tours are still
read outside every gate.

Visitor mode only: a creator's session registers nothing, so a gate there
would veto every frame. `ar-entry.ts` builds one per session.

## Public API

- `createTrackerCaptureWiring(deps): TrackerCaptureWiring`
  - `deps`: `now`, `captureIntervalMs`, `gpsEvents`, `alignment`, `zero`,
    `gpsPoints`, `arPose`, `codeLinedUp`, `levels`, `levelIdByText`,
    `stations`, `detections`, `qrBusy`, `forcePref`, `codesOnly`, optional
    `params` (`NearbyParams`, default `DEFAULT_NEARBY_PARAMS`). Every dep
    is a getter read per call.
  - `wantsFrame()`: the gate's answer for `now()`; a wanted frame's routes
    are kept.
  - `lastRoutes()`: the routes of the newest wanted frame, or null before
    the gate wanted one.
  - `position(nowMs)`: the kernel's position inputs (fixes, AR samples, the
    live pose).
- `codeTargets({ levels, levelIdByText, stations, zero, detections })`:
  the codes as kernel targets, keyed by level id.
- `codeReachM(code, stations, otherCodes)`, `newestHitAtMs(detections)`.
- `QR_BURST_MS` (10 000; the 1 Hz slow rate `QR_SLOW_HZ` is internal); types `CodeStation`,
  `QrDetectionsView`, `TrackerCaptureWiringDeps`, `TrackerCaptureWiring`.

## The rules

- **Positions are odom-NUE:** the store keeps its odometry so; the live
  pose and a code's sighting (raw WebXR) go through `odomNueOfWebXr`.
- **The live pose:** the aligned camera (`cameraNue`) and its AR position
  of the same tick, with the precision rule's acc_fix
  (`positionPrecision`, a code hold gives 1 m). Null without an alignment
  or a pose. The alignment is used as stored.
- **A code's target:** its saved spot (NaN without a zero or a spot: then
  only its sighting opens it); its accuracy is the mint's GPS accuracy;
  a heading-uncertain mint's target also carries its alignment's GPS
  extent (`alignmentGpsExtentM`), which the kernel widens it by; its sighting is the newest of the
  current AR frame epoch only.
- **A code's reach:** over the stations it takes along (`takesAlong`:
  within 40 m and no other code nearer), the largest found radius plus
  distance from the code, plus `HUD_ARRIVAL_BAND_M`. A visitor inside a
  station's found band is then inside its code's gate. The manifest links
  no station to a code, so the reach covers every station the code takes
  along.
- **The QR cadence:** in gate at the capture interval, outside and unknown
  at `QR_SLOW_HZ`, a burst at full cadence for `QR_BURST_MS` after any
  code's newest detection (other tours' codes too), forced on by the
  stored `trackerCaptureForceOn` pref or a codes-only tour.

## Invariants and defensive measures

- The targets are memoised on the level map, the text map and its size,
  the stations, the zero and the detections, so a frame without a change
  rebuilds nothing.
- `lastRoutes()` is null until the gate decided: a frame source that never
  asks (the e2e's fake camera) still offers every frame to QR.
- A busy QR controller vetoes the frame (`qrBusy`).

## Parameters

- `QR_BURST_MS` 10 s and `QR_SLOW_HZ` 1 Hz; the kernel's own parameters in
  `nearby-targets.ts.md`.

## Examples

```ts
const wiring = createTrackerCaptureWiring({
  now: () => Date.now(),
  captureIntervalMs: 125,
  ...deps,
});
startCameraFrameCapture({
  intervalMs: 125,
  wantsFrame: () => wiring.wantsFrame(),
});
```

## Tests

- `tracker-capture-wiring.test.ts`: the gate edge for a dead-reckoned
  position, sightings in odom-NUE and of the current epoch only, capture
  counts far (10 in 10 s) and near (full cadence), codes without a
  position and foreign codes read outside gates, the burst, force-on,
  codes-only, the reach, the heading-uncertain widening, the newest hit,
  no levels or zero.
- `tracker-capture-wiring.property.test.ts`: a visitor inside a station's
  found band is inside its code's gate, for any offset, accuracy and code
  hold.
