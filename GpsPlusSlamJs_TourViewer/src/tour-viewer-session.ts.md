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
    `mintedLevel`, `mintGeneration`, `finishing`, `rebuiltZip`; the open
    tour's `tourManifest` (archive-open.ts); the placement layer (M4):
    `placedObjects`, `placedPreviews`, `placementNote`, `reticle`,
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
- `createTourViewerStore()` / `type TourViewerStore` / `type ArController` -
  the store factory both modes share (with the opt-in `qrDetected` slice)
  and the two handle types the wiring modules take.
- `interface TourViewerHooks` / `createUnwiredHooks()` - the late-bound
  cross-module calls (`renderArStatus`, `renderArEntry`, `renderAuthorReadout`,
  `tryPlaceTour`, `startAuthorPipeline`, `startViewerPipeline`,
  `presentTourForPrint`), no-ops until their owner module is wired.
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

## Tests

`tour-viewer-session.test.ts`: `endQrPipeline` disposes and forgets the
QR controller, and is harmless without one. Otherwise no logic to test;
the fields' behaviour is pinned by the owning modules' tests and the e2e suite (`playwright-tests/*.spec.js`), which runs
unchanged across the split (the split's behaviour-neutrality proof).
