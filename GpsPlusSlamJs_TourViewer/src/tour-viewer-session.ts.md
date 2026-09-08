# tour-viewer-session.ts

## Purpose

The page's mutable session state as ONE explicit object (flows plan M6,
executing the simplification plan's M-1 with DEC-T6 = an explicit session
object created in `main.ts` and passed to each wiring module). It replaces
the 28 module-scope `let`s (plus one mutable `Map`) that `main.ts` carried
at the split, which four concerns wrote to through one file. No behaviour
lives here.

## Public API

- `interface TourViewerSession` - the fields, grouped by owner:
  - the open tour (`archive-open.ts`): `session`, `currentLevels`,
    `openGeneration`;
  - shared AR session state (`ar-entry.ts`): `qrController`, `qrDebugView`,
    `cameraFrameCount`; `levelByText` is grouped here but OWNED by
    `viewer-placement.ts` (its only reader/writer) and cleared on tour
    teardown by `archive-open.ts`;
  - author mode (`author-mode.ts`): `lastDetectedText`, `activeSizeM`,
    `authorErrorText`, `gpsSamplesAtSessionStart`, `mintedCodeId`;
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
  cross-module calls (`renderArStatus`, `renderAuthorReadout`,
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

## Tests

No logic to test; the fields' behaviour is pinned by the owning modules'
tests and the e2e suite (`playwright-tests/*.spec.js`), which runs
unchanged across the split (the split's behaviour-neutrality proof).
