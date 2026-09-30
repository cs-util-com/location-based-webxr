# tour-viewer-session.ts

## Purpose

The page's mutable session state as ONE explicit object (flows plan M6,
executing the simplification plan's M-1 with DEC-T6 = an explicit session
object created in `main.ts` and passed to each wiring module). It replaces
the 28 module-scope `let`s (plus one mutable `Map`) that `main.ts` carried
at the split, which four concerns wrote to through one file. No behaviour
lives here.

## Public API

- `endQrPipeline(ctx)` (QR near-frontal pose plan §61): dispose the QR
  controller - a decode or level fetch still in flight then reaches no
  callback (no detection into the next session's window, no status line,
  no vote) - and forget it. `ar-entry.ts`'s `onSessionEnd` calls it.
- `interface TourViewerSession` - the fields, grouped by owner:
  - the open tour (`archive-open.ts`): `session`, `currentLevels`,
    `openGeneration`;
  - shared AR session state (`ar-entry.ts`): `qrController`, `qrDebugView`,
    `cameraFrameCount`; `levelByText` is grouped here but OWNED by
    `viewer-placement.ts` (its only reader/writer) and cleared on tour
    teardown by `archive-open.ts`;
  - the creator setup (`creator-setup.ts`): `lastDetectedText`,
    `activeSizeM`, `authorErrorText`, `gpsSamplesAtSessionStart`,
    `mintedLevel`, `mintedLevelTour` (the tour the measured code named,
    valid while its `levelId` is the level's id), `mintGeneration`,
    `codeMeasurement` (the raw inputs of a mint made in this page, cleared
    with the level) and `visitCodeSighting` (the anchor code's latest stable
    pose in the running AR visit, cleared at the visit's end) - both for the
    settle (authoring plan 2026-09-28-0953 §3.2, M2c),
    `finishing`, `rebuiltZip`, `tourLabel` (set by archive-open); the open
    tour's `tourManifest` (archive-open.ts); the placement layer (M4):
    `placedObjects` (each with an optional `placement`: the odometry-NUE
    pose in the world group and the AR visit it belongs to, authoring plan
    2026-09-28-0953 M2c), `placedPreviews`, `placementNote`, `reticle`,
    `latestFrame` (a `CapturedCameraFrame | null`: the pixels the photo
    encodes plus the capture pose the photo is placed with);
  - the scan gate and the placed content (viewer-placement.ts, M5):
    `scanGate`, `cancelEscapeClock`, `contentRendered`, `contentAttempted`,
    `contentError`; the hooks `startScanGate` / `resetScanGate` /
    `reconsiderScanGate(levels | "unavailable")`;
  - the viewer QR line and the placement (`viewer-placement.ts`): the six
    `viewer*` line inputs, `latestReprojectionPx`, `placement`,
    `viewerPlanesError`, `imagePlanes`, `imagePlanesLoading`,
    `planesRunGeneration`, `placementUnsubscribe`, `placementAttempted`,
    `joinDeclined`.
- `createTourViewerSession(): TourViewerSession` - the initial values.
- `createTourViewerStore(recording?)` - with the creator's troubleshooting
  recording (`authoring-recording.ts`; authoring recording plan
  2026-09-28-0953, M1a) the store writes into its backend under its
  `persistWhile` gate, which REPLACES the `isRecording` gate, and numbers
  actions across sessions (`continuousActionIndex`): this app starts and ends
  a session on every AR entry and exit, so under the defaults the per-exit
  `resetGpsSessionData` and everything done on the page would be lost and a
  second visit would overwrite the first. Persisted beyond the framework's
  built-ins: `qrDetected` and `tourAuthoring`, both derived from real action
  creators (`slicePrefixOf`). Without `recording` (tests) it writes into a
  `NullStorageBackend` as before.
- `type TourViewerStore` / `type ArController` -
  the store factory both modes share (with the opt-in `qrDetected` slice)
  and the two handle types the wiring modules take.
- `interface TourViewerHooks` / `createUnwiredHooks()` - the late-bound
  cross-module calls (`renderArStatus`, `renderArEntry`, `renderAuthorReadout`,
  `tryPlaceTour`, `startAuthorPipeline`, `startViewerPipeline`,
  `presentTourForPrint`, `beginAuthorVisit` / `endAuthorVisit` - the
  creator's AR visit start and its settle, M2c), no-ops until their owner
  module is wired.
  (`QrController` and `QrDebugView` are module-private: reached through
  the fields, a standalone export counts as dead.)

## Invariants & assumptions

- **One writer per group, readers anywhere.** The owner module named above
  is the only one that writes a group's fields; `teardownSession`
  (`archive-open.ts`) and the AR session end (`ar-entry.ts`) are the two
  cross-cutting resets, and each resets exactly the fields the closing
  tour or session owned (see those sidecars for the lists).
- The generation counters (`openGeneration`, `planesRunGeneration`) are
  only ever incremented; async runs capture a value and compare.
- `placementUnsubscribe !== null` is the "viewer session is live" signal
  the placement trigger reads; it is set after the runtime start and
  cleared on session end.

## Examples

```ts
const ctx = createTourViewerSession();
wireArchiveOpen({ ctx, ... });
wireArEntry({ ctx, ... });
```

- **The fused pose's debug state** (plan §66): `fusedTallies` (per code,
  replaced at each pipeline start and kept at session end), `debug` (the
  page's `?debug=1`, set once at boot) and `viewerLastEvaluation` (the
  visitor hint's source, cleared at session end).

- **`printSizeCheck`** (QR size consensus plan S3a): the creator's
  print-size check, set by `wireCreatorSetup`, null for a visitor; reset at
  AR session end (`ar-entry.ts`) and at a tour switch (`archive-open.ts`).

## Tests

`tour-viewer-session.test.ts`: `endQrPipeline` disposes and forgets the
QR controller, and is harmless without one. Otherwise no logic to test;
the fields' behaviour is pinned by the owning modules' tests and the e2e suite (`playwright-tests/*.spec.js`), which runs
unchanged across the split (the split's behaviour-neutrality proof).
