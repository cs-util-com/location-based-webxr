# viewer-placement.ts

## Purpose

Viewer mode (QR-pose plan M4) and the photo placement (geo-join plan, flows
plan M4): the default passerby flow. Photos are placed at their capture spots
once the tracking-quality phase reports ready; scanned codes relocalize the
session via budgeted synthetic GPS votes and REFINE the alignment under the
placed planes; the ring around a code is the fallback for a tour without a
recording. Its own module since the flows plan M6.

## Public API

- `createViewerPlacement({ ctx, mode, arStore, arController, seams, errorBox, escapeButton, hooks }): ViewerPlacement` - places only in visitor mode
  - `ViewerPlacement.startScanGate()` (called when the session reaches
    running) derives the scan gate (`scan-gate.ts`) and arms the escape
    clock (`seams.schedule`, 45 s) while it scans; `reconsiderScanGate()`
    (the levels arrived) waives a scanning gate that cannot lock. The
    controller's `onLocked` with a lockable level passes the gate; the
    escape button passes it as "skipped". Nothing is placed until the gate
    allows it (DEC-N3): the capture-spot join AND the tour's content.
  - The tour's content (`tour.json`, M5) is rendered once per session as
    soon as the gate allows it and the GPS zero exists
    (`renderTourObjects`; labels through `seams.createLabel`, photos
    decoded from the streaming session at divisor 2); a failed read names
    the object in the status line.
  - `startViewerPipeline(): boolean` - creates the viewer tracking
    controller into `ctx.qrController` for THIS AR entry; false without a
    detector (plain AR, still placing photos).
  - `tryPlaceTour(): void` - the placement trigger (DEC-F3): with a tour
    open and a viewer session live (`ctx.placementUnsubscribe !== null`),
    runs the capture join ONCE per session+tour
    (`ctx.placementAttempted`) as soon as
    `isPlacementReady(selectTrackingQuality(state))`; until then sets
    `waiting-ready`. A tour without a recording declines at once (the ring
    waits for a lock). Cheap by design: a few predicate reads per dispatch.

## Invariants & assumptions

- Session-state fields it owns: the six `viewer*` QR-line inputs,
  `latestReprojectionPx`, `placement`, `viewerPlanesError`, `imagePlanes`,
  `imagePlanesLoading`, `planesRunGeneration` (bumped by the two resets in
  `archive-open.ts` / `ar-entry.ts`), `placementAttempted`, `joinDeclined`,
  `levelByText` (written by `onLevelResolved`).
- **The code is a refinement, not a gate.** `placeTourImagePlanes(null)`
  runs the capture join from the ready trigger; only the RING needs a
  locked code's geo. A lock during a running join is dropped and the next
  of the ≤ 10 budgeted locks retries (`imagePlanes === null &&
!imagePlanesLoading`, review #4); a lock after a placement changes the
  status only.
- **A declined join is remembered** (`joinDeclined`) so a later lock goes
  straight to the ring instead of replaying the walk (seconds of CPU).
- **Liveness inside the async runs is the controller status (`running`)
  plus `planesRunGeneration`** - never `qrController`, which is null for a
  whole session without a BarcodeDetector (review #2). Every bail path
  frees its textures.
- Votes: `canAcceptVotes` tests the session ZERO, not merely the slice
  (PR #386 review) - votes before the zero would charge the budget while
  `recordGpsEvent` wrote nothing.
- Planes live at the SCENE ROOT in raw GPS-world NUE (the framework's
  built-once parenting rule); the alignment moves the odometry group under
  them, which is why a later lock needs no re-placement.
- The join's gates, failure taxonomy and decline wording are the geo-join
  plan's, unchanged: every decline is a `declined { reason }` placement
  state, rendered as "photo ring (reason)" by `tour-flow` - EXCEPT on an
  open tour with zero levels, where `arStatusLine` derives it to "nothing
  to place" (a ring needs a code; M1-M4 review #1). This module never
  produces `nothing-to-place` itself.
- `levelByText` is owned here (the only reader/writer:
  `onLevelResolved`, the detection glue and the ring's geo lookup); it is
  cleared on tour teardown (`archive-open.ts`), not on session end - the
  same tour's codes stay valid across AR re-entries, and the QR
  controller's `reset()` re-resolves any text that locks again.
- Capture planes decode at divisor 2 (the framework decoder's OOM
  mitigation; geo-join review finding 4).

## Examples

```ts
const viewer = createViewerPlacement({
  ctx,
  mode,
  arStore,
  arController,
  seams,
  errorBox,
  hooks,
});
hooks.startViewerPipeline = viewer.startViewerPipeline;
hooks.tryPlaceTour = viewer.tryPlaceTour;
ctx.placementUnsubscribe = arStore.subscribe(() => viewer.tryPlaceTour());
```

## Tests

`playwright-tests/ar-mode.spec.js` - the capture-spots placement with no
detection (forced `ready`), the refine-after-place lock, the ring for a
tour without a recording (budgeted votes, marker, three planes), the
unknown-code line, the no-levels "nothing to place" line, the no-detector
placement, and the per-entry re-placement. The pure pieces:
`qr-viewer-mode.test.ts`, `capture-geo-join*.test.ts`,
`image-planes.test.ts`, `tour-flow.test.ts` (`isPlacementReady`).
