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
  no vote) - and forget it; it also stops and forgets the code keep-alive
  (`viewerKeepAlive`, authoring plan M2b), whose pose belongs to the
  ending session's odometry frame, and forgets the entry's vote budget
  (`viewerVoteBudget`) and vote sink (`viewerVoteSink`; device fixes then
  take the plain `recordGpsEvent`). `ar-entry.ts`'s `onSessionEnd` calls
  it.
- `endTourCodeVotes(ctx)` (authoring plan M2b review #6): a tour closed
  while the AR entry goes on - stop the keep-alive's hold and reset every
  code's vote budget, keeping both objects (the running pipeline holds
  them). Before it, the budget outlived the tour: a reopened tour found its
  code already "voted", so its gate passed on a lock that cast nothing and
  a spent code never voted or held again. It leaves the entry's soft
  trimming on: the closed tour's votes stay in the GPS history until AR
  exit (the seam contract, rule 3, in `viewer-placement.ts.md`). It also
  clears the moved-code checks and the veto memory (`ignoredCodes`,
  `viewerIgnoredText`): per tour, cleared at a tour switch (D20 M5c, §7j
  #13).
  `archive-open.ts`'s teardown calls it.
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
    `finishing`, `rebuiltZip` (with the `manifest.json` list it carries,
    for the next Finish, K1 milestone review R7), `tourLabel` (set by
    archive-open); the open
    tour's `tourManifest` (archive-open.ts); the placement layer (M4):
    `placedObjects` (each with an optional `placement`: the odometry-NUE
    pose in the world group and the AR visit it belongs to, authoring plan
    2026-09-28-0953 M2c; an edit or a move of a hosted object is an entry
    with the SAME id, M4), `deletedObjectIds` (tombstones of objects the
    manifest carries, applied by the Finish and reset when the tour
    closes, M4), `placedPreviews` (a `Map` by object id - this device's
    objects AND the hosted zip's in the running visit, so an edit, a move
    or a delete finds its preview and a tap in AR names what it hit, M4),
    `placementNote`, `reticle`,
    `latestFrame` (a `CapturedCameraFrame | null`: the pixels the photo
    encodes plus the capture pose the photo is placed with);
  - the scan gate and the placed content (viewer-placement.ts, M5):
    `scanGate`, `cancelEscapeClock`, `contentRendered`, `contentAttempted`,
    `contentError`; the hooks `startScanGate` / `resetScanGate` /
    `reconsiderScanGate(levels | "unavailable")`;
  - the visitor's stations (tour kit plan K4, `visitor-stations.ts`):
    no session fields (the station run lives in the guide, keyed by the
    open tour's stations); the hooks `tickStations` (a store change or a
    camera frame), `stationCodeLocked(levelId)` (a trusted lock, after the
    scan gate's part), `unlockStationAudio` (inside the start tap) and
    `stopStations` (the session ended or the tour closed);
  - the viewer QR line and the placement (`viewer-placement.ts`): the six
    `viewer*` line inputs, `latestReprojectionPx`, `viewerKeepAlive` (the
    code keep-alive, created per AR entry by `startViewerPipeline`, stopped
    by `endQrPipeline` and by a tour close in `archive-open.ts`; the status
    line reads its phase), `viewerVoteBudget` (the per-code vote budget,
    created with the pipeline, forgotten by `endQrPipeline`, reset by
    `endTourCodeVotes`), `viewerVoteSink` (the entry's vote sink,
    `viewer-vote-sink.ts`: created at every visitor entry's start, which
    clears the solver overrides; forgotten by `endQrPipeline`; turned off
    by `endTourCodeVotes`), `placement`,
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
  built-ins: `qrDetected`, `tourAuthoring` and `tourViewing` (M1b), all derived from real action
  creators (`slicePrefixOf`). Without `recording` (tests) it writes into a
  `NullStorageBackend` as before.
- `type TourViewerStore` / `type ArController` -
  the store factory both modes share (with the opt-in `qrDetected` slice)
  and the two handle types the wiring modules take.
- `interface TourViewerHooks` / `createUnwiredHooks()` - the late-bound
  cross-module calls (`renderArStatus`, `renderArEntry`, `renderAuthorReadout`,
  `tryPlaceTour`, `startAuthorPipeline`, `startViewerPipeline`,
  `presentTourForPrint`, `presentLocalTour` (a tour opened from a file:
  no link to print, tour kit plan K0), `beginAuthorVisit` / `endAuthorVisit` - the
  creator's AR visit start and its settle, M2c), no-ops until their owner
  module is wired.
  (`QrController` and `QrDebugView` are module-private: reached through
  the fields, a standalone export counts as dead.)

## The moved-code veto's state (D20, M5c)

- `levelIdByText` - the level id each decoded text resolved to (cleared
  with `levelByText` at a tour close).
- `movedCodeChecks` - the AR entry's checks (`moved-code-check.ts`);
  dropped by `endQrPipeline`, cleared by `endTourCodeVotes`.
- `ignoredCodes` - level id to text of every code judged moved: ignored
  for the rest of the page session for this tour, across AR entries;
  cleared only by `endTourCodeVotes` (a tour switch).
- `viewerIgnoredText` - the ignored code the status line names in this AR
  entry; cleared at AR exit and at a tour switch, and by another code's voted lock
  (M5c review M1).
- `scanGateCodeText` - the code whose voted lock passed the scan gate; a
  veto flips the gate to `ignored` only for this code (M5c review M1).

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
QR controller, is harmless without one, and stops and forgets the
keep-alive and the vote budget; `endTourCodeVotes` stops the hold and
re-arms every code while keeping both objects. `viewer-votes.test.ts`
drives a reopened tour through it. Otherwise no logic to test;
the fields' behaviour is pinned by the owning modules' tests and the e2e suite (`playwright-tests/*.spec.js`), which runs
unchanged across the split (the split's behaviour-neutrality proof).
