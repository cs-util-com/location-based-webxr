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
- `isCodeIgnored(ctx, text)` - whether the moved-code check made the
  viewer ignore this decoded text's code: its level id
  (`levelIdByText`) is in the veto memory (`ignoredCodes`). The one
  reading of that memory, shared by the viewer pipeline's `isIgnored`
  (`viewer-placement.ts`) and the status line's hint guard
  (`ar-entry.ts`); `viewerIgnoredText` names only the latest veto of
  this AR entry and is never the test of "ignored".
- `interface TourViewerSession` - the fields, grouped by owner:
  - the open tour (`archive-open.ts`): `session`, `currentLevels`,
    `levelsUnreadable` (the levels' read failed: the tour has no usable
    code, r857 review #4), `openGeneration`;
  - shared AR session state (`ar-entry.ts`): `qrController`, `qrDebugView`,
    `cameraFrameCount`; `levelByText` is grouped here but OWNED by
    `viewer-placement.ts` (its only reader/writer) and cleared on tour
    teardown by `archive-open.ts`;
  - the creator setup (`creator-setup.ts`): `lastDetectedText`,
    `activeSizeM`, `authorErrorText`, `gpsSamplesAtSessionStart`,
    `mintGeneration` (the code in hand, its measurement and the visit's
    sighting of it are private to `creator-codes.ts` since code book plan
    M5d-2),
    `finishing`, `rebuiltZip` (with the `manifest.json` list it carries,
    for the next Finish, K1 milestone review R7), `walkBake` (the
    creator's bake of the open recording's walk, `WalkBake` of
    `tour-document-bake.ts`: running with its progress, or what it decided -
    set by `archive-open.ts`, read by the Finish and the status line,
    cleared at tour teardown), `tourLabel` (set by
    archive-open); the open
    tour's document `tourDocument` (`creator-document.ts`: the shared
    `tourDocument` slice of the store the session was made with, plus the
    pictures and AR placements beside it - the manifest, `manifest()`,
    opened by archive-open.ts; the creator's placed, edited and deleted
    objects; one per page, never replaced) and `scanEntries` (the
    creator's walk, from `tour-read-set.ts`; empty without a manifest);
    the placement layer (M4): `placedPreviews` (a `Map` by object id - this device's
    objects AND the hosted zip's in the running visit, so an edit, a move
    or a delete finds its preview and a tap in AR names what it hit, M4),
    `placementNote`, `reticle`,
    `latestFrame` (a `CapturedCameraFrame | null`: the pixels the photo
    encodes plus the capture pose the photo is placed with);
  - the scan gate and the placed content (viewer-placement.ts, M5):
    `codesOnly`, `scanGate`, `cancelEscapeClock` (the compass wait's two
    fields went in r863: a code's rotation now stands from its first lock,
    `viewer-vote-sink.ts`), `stationContent` (the side table of the
    visitor's content per station, `station-content.ts`: created with the
    first part after the gate, disposed at the session's end and when its
    tour closes), `contentAttempted`,
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
    by `endTourCodeVotes`), `placement` (whether the placement still
    waits for readiness), `placementUnsubscribe`,
    `placementAttempted` (the wait ended, for this session and tour).
- `createTourViewerSession(store?): TourViewerSession` - the initial
  values; `store` holds the tour document in the page's store (the
  `tourDocument` slice the desktop editor uses too; a fresh
  `createTourViewerStore()` when absent, for tests that need no other).
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
  It also mounts the visitor's guide state (`visitorGuide`,
  `visitor-guide-slice.ts`: the present station and "show all", visitor
  plan 2026-10-18-2349 M1; not persisted) and the tour document
  (`tourDocument`, `tour-document.ts`, D29-D31; not persisted) and returns `listenToDocument`, its own listener
  middleware's `startListening`, where a page runs the document's side
  effects (the draft's writes, `tour-document-draft.ts`) after the
  reducer. Its own middleware rather than an `addListener` dispatch, which
  would land in whichever of the framework's listener middlewares came
  first.
- `type TourViewerStore` / `type ArController` -
  the store factory both modes share (with the opt-in `qrDetected` slice)
  and the two handle types the wiring modules take.
- `interface TourViewerHooks` / `createUnwiredHooks()` - the late-bound
  cross-module calls (`renderArStatus`, `renderArEntry`, `renderAuthorReadout`,
  `tryPlaceTour`, `startAuthorPipeline`, `startViewerPipeline`,
  `presentTourForPrint`, `presentLocalTour` (a tour opened from a file:
  no link to print, tour kit plan K0), `presentUnverifiedLink` (step 2's
  link whose file is not there yet, or that could not be checked offline:
  printed as given, marked unverified - polish round M2, A16),
  `presentTourCodes` (the open tour's codes arrived: the print step
  continues their numbering - polish round M0b), `presentTourLevels`
  (the open tour's levels settled, read or failed: the visitor screen's
  line follows), `presentTourInfo(tour)` (`{ manifest,
loadImage }` once the open tour's manifest settled, `manifest` null for
  a zip without `tour.json`; null on teardown: the visitor's start page
  leads with the tour itself - its name, subline and cover, read from the
  zip by archive path - or says that the tour is not finished yet), `finishFromAr()` (a creator's
  Done in AR: start a finish if one can start, false when none can -
  polish round M3), `beginAuthorVisit` / `endAuthorVisit` - the
  creator's AR visit start and its settle, M2c), no-ops until their owner
  module is wired.
  (`QrController` and `QrDebugView` are module-private: reached through
  the fields, a standalone export counts as dead.)

## The moved-code veto's state (D20, M5c)

- `levelIdByText` - the level id each decoded text resolved to (cleared
  with `levelByText` at a tour close).
- `movedCodeChecks` - the AR entry's checks (`moved-code-check.ts`);
  dropped by `endQrPipeline`, cleared by `endTourCodeVotes`.
- `ignoredCodes` - level id to text (and the spread the veto was read on)
  of every code judged moved: ignored for this tour, across AR entries;
  cleared by `endTourCodeVotes` (a tour switch) and, per code, when the
  moved-code check lifts the veto on wider evidence (polish round C5,
  `viewer-placement.ts` `restoreMovedCode`).
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
- The generation counter (`openGeneration`) is only ever incremented; async runs capture a value and compare.
- `placementUnsubscribe !== null` is the "viewer session is live" signal
  the placement trigger reads; it is set after the runtime start and
  cleared on session end.

## Examples

```ts
const ctx = createTourViewerSession(arStore);
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
re-arms every code while keeping both objects; `isCodeIgnored` reads
the memory by level id. `viewer-votes.test.ts`
drives a reopened tour through it. Otherwise no logic to test;
the fields' behaviour is pinned by the owning modules' tests and the e2e suite (`playwright-tests/*.spec.js`), which runs
unchanged across the split (the split's behaviour-neutrality proof).

## UI round 1 additions

- `TourViewerHooks.confirmLeaveTour()` - false when the creator declined to
  leave an unsaved rebuilt file for another tour (U2; `main.ts` binds it,
  `createUnwiredHooks` returns true).
- `rebuiltZip.delivered` - a save delivered the rebuilt file (U2).
- `rebuiltZip.written` - the tour.json that zip carries: what a yes to
  "did you upload it?" notes (F19 review #2).
- `scanEntries` - see the S1 note above.

- `frameEpochAtSessionStart` (code book plan M6 v5.1): the odometry
  frame's epoch (`qrDetected.frameEpoch`), taken when the session's
  runtime started, next to `gpsSamplesAtSessionStart`. A visit whose
  frame changed since makes no automatic code-spot decision.
