# tracker-capture-wiring.ts

## Purpose

The visitor's tracker capture gate for one AR session. It creates the
framework's generic gate
([tracker-capture-gate](../../GpsPlusSlamJs_AppFramework/src/ar/targets/tracker-capture-gate.ts.md))
and registers QR, the first tracker, with the tour's codes as its targets.
The camera asks `wantsFrame` before each capture: full cadence while a code
is near (the nearby-targets kernel), right after a code that may be the
tour's was decoded or detected and while the scan card asks for a code,
1 Hz otherwise, so codes without a position and codes of other tours are
still read outside every gate.

Visitor mode only: a creator's session registers nothing, so a gate there
would veto every frame. `ar-entry.ts` builds one per session.

## Public API

- `createTrackerCaptureWiring(deps): TrackerCaptureWiring`
  - `deps`: `now`, `captureIntervalMs`, `gpsEvents`, `alignment`,
    `alignmentReady`, `zero`, `gpsPoints`, `arPose`, `codeLinedUp`,
    `levels`, `levelIdByText`, `stations`, `detections`, `lastDecodeAtMs`,
    `opensBurst`, `qrBusy`, `forcePref`, `codesOnly`, `scanning`, optional
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
- `codeReachM(code, stations, otherCodes)`,
  `newestHitAtMs(detections, opensBurst)` (the newest detection of a code
  whose text opens the burst).
- `stampDecodes(frontEnd, onDecode)`: the QR front end with
  `onDecode(decoded)` called with the code on every detect that resolves
  with one (before the controller's validation or lock), so the caller can
  skip a code that opens no burst; `dispose` passes through.
- `QR_BURST_MS` (10 000; the 1 Hz slow rate `QR_SLOW_HZ` is internal); types `CodeStation`,
  `QrDetectionsView`, `TrackerCaptureWiringDeps`, `TrackerCaptureWiring`.

## The rules

- **Positions are odom-NUE:** the store keeps its odometry so; the live
  pose and a code's sighting (raw WebXR) go through `odomNueOfWebXr`.
- **The live pose:** the aligned camera (`cameraNue`) and its AR position
  of the same tick, with the precision rule's acc_fix
  (`positionPrecision`, a code hold gives 1 m). Null without a READY
  alignment (below) or a pose.
- **Before the alignment is ready the AR gate and `'dr'` are off:** both
  need the live pose, so until then only a fresh lone fix opens a code
  (state `'gps'`); a fix gap reads `'unknown'` and a code just read stays
  at the slow rate once its burst ends. Both would work in odom-NUE, but a
  live pose pinned at the lone fix would let `'dr'` widen only by
  alpha x the AR distance while the visitor moves the whole AR distance,
  and an AR gate alone would need a live pose without a GPS position, a
  change of the kernel's contract. Accepted: the lone-fix phase is short
  and the burst covers the decodes a lock needs.
- **The alignment counts once ready:** the source and the live pose use
  the store's alignment only while `alignmentReady()` (the page's rule,
  `stationAlignmentSignals`: tracking ready or a code lined it up). The
  store holds the identity from the first fix, long before a solve; read
  as aligned it would place the camera at its raw AR position. Until then
  the gate judges by the lone fix, as the station guide does.
- **A code's target:** its saved spot (NaN without a zero or a spot: then
  only its sighting opens it); its accuracy is the mint's GPS accuracy;
  a heading-uncertain mint's target also carries its alignment's GPS
  extent (`alignmentGpsExtentM`), which the kernel widens it by. Both
  pass raw: the kernel alone decides what a malformed value means. Its
  sighting is the newest of the current AR frame epoch only.
- **A code's reach:** over the stations it takes along (`takesAlong`:
  within 40 m and no other code nearer), the largest found radius plus
  distance from the code, plus `HUD_ARRIVAL_BAND_M`. A visitor inside a
  station's found band is then inside its code's gate. The manifest links
  no station to a code, so the reach covers every station the code takes
  along.
- **The QR cadence:** in gate at the capture interval, outside and unknown
  at `QR_SLOW_HZ`, a burst at full cadence for `QR_BURST_MS` after the
  newest decode (`lastDecodeAtMs`, stamped before any lock) or detection,
  whichever is later, of a code that may be the tour's (`opensBurst`: not
  one the session knows has no level in this tour, whose level cannot
  lock (`isLockableLevel`: print size and geo), or is ignored; a code not resolved yet counts), forced on by
  the stored `trackerCaptureForceOn` pref, a codes-only tour or the scan
  gate scanning (`scanning`).

## Invariants and defensive measures

- The targets are memoised in two parts: the spots (position, accuracy,
  reach: the geodesic part) on the level map, the stations and the zero;
  the sightings on the detections (whose frame epoch they carry) and the
  text map with its size (it grows in place as codes resolve). A decode
  rebuilds only the sightings; a frame without a change rebuilds nothing.
  `stations()` must return a stable reference (a manifest selector), or
  the spots rebuild per call.
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

- `tracker-capture-wiring.test.ts`:
  - frames: the gate edge for a dead-reckoned position, an identity
    alignment before readiness taking the lone-fix path, no live pose
    before readiness (no AR gate, no 'dr'; both back once ready),
    sightings in odom-NUE and of the current epoch only;
  - the series within H: a fix gap within H reads 'dr' and one longer
    'unknown', R_AR counts the walk within H (both fail if the source were
    trimmed to F);
  - capture counts far (10 in 10 s) and near (full cadence), codes
    without a position and foreign codes read outside gates, the burst on
    a detection and on one decode before any lock (a newer decode beats an
    older detection and the reverse), no burst from a code that opens
    none, the scan gate scanning, force-on, codes-only;
  - targets: the reach, the heading-uncertain extent passed raw, the
    newest hit of a code that opens a burst, `stampDecodes` naming the
    code, a new detection updating the sighting without rebuilding the
    spots (and an epoch bump dropping it), no levels or zero.
- `tracker-capture-wiring.property.test.ts`: a visitor inside a station's
  found band is inside its code's gate, for any offset, accuracy and code
  hold, with the fix and its odometry at the visitor.
