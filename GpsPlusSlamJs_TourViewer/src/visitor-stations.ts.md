# visitor-stations.ts

## Purpose

The visitor's stations, composed (tour kit plan K4): the station guide
(`station-guide.ts`), the story panel (`scene-view.ts`), the AR stage
(`scene-stage.ts`) and the one sound channel (`scene-audio.ts`), wired to
the page's session object, store and seams. Glue: the behaviour is tested
in those modules, the composition in `playwright-tests/stations.spec.js`.

## Public API

- `wireVisitorStations({ ctx, mode, arStore, seams, dom, now, schedule, relocate? }):
VisitorStations` - `{ tick, loadContent, codeLocked, unlockAudio, stop }`
  (properties, handed to the hooks unbound). `loadContent(path)` reads one
  of the open tour's entries through the stations' prefetch cache: the
  station content's photos (`viewer-placement.ts`) read through it, but
  the cache holds story media only, so a return to a station reads its item
  photos from the archive again until item photos join the prefetch. `relocate` (`{ onRelocated }`) turns on the
  test switch `?relocate=here` (`tour-relocation.ts`): the stations are
  held back until the phone's first raw GPS fix, then moved there.
- `stationPlacementAllowed(ctx, mode): boolean` - the guide's
  `placementAllowed`, exported so the placement test drives the page's
  own rule (see below).
- `stationAlignmentSignals(ctx, arStore)` - the guide's `codeLinedUp`,
  `alignmentReady` and `trackingReady` (`tour-flow.ts`; the last is
  `isPlacementReady` on the report, which a lined-up code's votes feed
  too: the guide latches its heading on it only without a code): the viewer
  pipeline's voted locks this AR entry (`ctx.viewerLockedText`,
  `ctx.viewerVotedLocks`) and the store's tracking-quality report.
  Exported for the same reason. No state of its own: all are read each
  tick.

## Invariants & assumptions

- The tour is read from the session object each time:
  `ctx.tourDocument.manifest()` (settled) for the stations, the order and the assets, and the store's
  zero for the visitor's raw fix position. A code lock only re-judges the
  guide (tour editor plan D16: a lock is no arrival; the moved-code check's
  veto acts on the alignment, never here), so the code-only station's spot,
  the D20 veto and the lock hold (K4 review R1) are no longer read.
- Placement is allowed for a visitor with a live session
  (`ctx.placementUnsubscribe`) and a gate that allows it
  (`gateAllowsPlacement`, DEC-N3): the stations wait behind the scan gate
  like the tour's other content. From r857 to r863 they also waited behind
  the compass wait (a station on the scanned code turned with the compass
  swing the wait hid, r857 milestone review #1); since r863 a code's
  rotation stands from its first lock (`viewer-vote-sink.ts`
  `VIEWER_SOFT_TRIM`), so a station on the scanned code is found on that
  lock: the lock places the visitor, and a station at the code is inside
  its radius (D16).
- The stations are judged on the aligned frame only while it is ready
  (r881, `stationAlignmentSignals`): tracking ready or a code lined it up,
  re-read each tick. While it is not the guide judges by the fresh device
  fix (review H1). The arrows, the breadcrumbs, the figure's turn and the
  figure's pose wait for the first readiness of the AR entry and keep it
  through a dip (re-review L-B, M-B): the stage reads
  `guide.figurePoseOf`, so a story found on the raw fix plays its words
  and voice at once while its figure waits ("Waiting for your position to
  place the figure…"). The gate alone was not enough: the library aligns
  a session from its first fix, with no heading.
- Media are read through `ctx.session.loadContentEntry` (K0's allowlist and
  `.glb` check, K1's per-entry hash check), ahead of time as the visitor
  approaches (`station-prefetch.ts`; the story's own reads go through the
  same cache). The cache lives with the open tour's manifest
  (`ctx.tourDocument.manifest()`, by identity; a visitor never edits it,
  so it changes only with the tour): kept across AR sessions, dropped when
  the tour closes or another opens (K4 review R15). A figure is decoded by the framework's
  `decodeFrameTexture`, one at a time through a `keyed-chain` key, via
  `decodeFigure` (its size read from its own header, refused over the tour
  pixel cap, scaled to 2048 px; K4 review R2); a story picture is checked
  by `pictureProblem` before its `<img>`; a model by `seams.loadGlbModel`
  after `loadContentEntry`'s `checkGlbInert`, which also measures every
  image inside it.
- The breadcrumbs (`breadcrumbs.ts`) follow the guide's `onGuide`, one
  trail for the page.
- The guide's `guideStore` is `arStore`: the present station lands in its
  `visitorGuide` slice (visitor plan 2026-10-18-2349 M1). Its `walkStore`
  is `arStore` too: the visitor's walk lives in its `visitorWalk` slice
  (`visitor-walk-slice.ts`, W4 build plan 2026-10-21-1105 M1). The station
  content draws by it (`viewer-placement.ts`, M2), and each `tick` hands
  the stage `selectStationContentShown` (`stage.follow`): the figure fades
  with its station. The stage's fade runs on `deps.now` and the AR frame
  loop (`registerFrameUpdate`).
- The assets by id are built once per manifest (K4 review R13).
- A choice button is a `.btn` with `data-testid="scene-choice"`.
- `stop()` stops the story and the HUD; the guide keeps the progress with
  the open tour, and the prefetch its cache unless the tour closed.

## Examples

```ts
const stations = wireVisitorStations({
  ctx,
  mode,
  arStore,
  seams,
  dom,
  now,
  schedule,
});
hooks.tickStations = stations.tick;
```

## Tests

- `playwright-tests/stations.spec.js` (the composition).
- `visitor-stations.test.ts` - `stationAlignmentSignals` against the real
  tracking-quality slice, `trackingReady` reading the report, not the lock state.
- `viewer-content-alignment.test.ts` ("finds the station on the scanned
  code on the first voted lock"): the real station guide over the real
  placement, `stationPlacementAllowed` and `stationAlignmentSignals`.

## The walk's sheet (visitor walk W4 build plan M2)

- `deps.walk?: { dom: WalkSheetDom, toast: WalkToast, exitAr }` - wires
  `walk-sheet.ts` and draws it after every tick, code lock, skip tap,
  story change (`scene-view.ts` `onChange`) and sheet change, from
  `walk-sheet-model.ts` over the guide's `view()`, the store's walk
  (`selectWalkProgress`, `selectWalkSheet`) and the tour (the guide's own
  reader, `guideTour`). Hidden while the guide does not run.
- The story card's end control (`#walk-story-end`) is the guide's `end`
  dom and taps like the skip button (`skipTapped`); "Keep listening"
  calls `cancelAsk`; the completion card's "Exit AR" calls `exitAr`
  (`main.ts`: a tap on `#enter-ar`, the session's one way out).
- Toasts: the guide's note ("Skipped X." / "Brought back X.") once per
  note, and `WELCOME_BACK` ("Welcome back - your progress is kept.") at
  the first drawn sheet of an entry after leaving AR with progress; one
  render's words go out as ONE toast (`walk.toast.say(words)`).
- **The store rule** (W4 build plan M2 review): the welcome waiting is
  walk state, in the slice (`welcomePending`, `welcomeSet`); `stop()`
  arms it, the first drawn sheet says it and clears it. `stop()` also closes the list (`sheetSet("peek")`): the next entry starts at the peek, as W4 does, whatever was open on leaving. Two closure values
  stay, argued as DOM resources rather than state: `saidNote` is the
  toast's dedup (like `walk-toast.ts`'s own, no view reads it), and
  `sheetShown` mirrors what the last render drew, read by the status and
  compared to call `onShownChange`.
- **No sheet drawn inside a guide call**: a story's `onChange` fires from
  inside one (a find starts the story) while the guide's view is half made
  and its walk batch has not reached the store. `createCallGuard(render)`
  (exported) wraps every guide call made here (`tick`, `codeLocked`,
  `skipTapped`, `cancelAsk`, `storyEnded`, the stop's `stopAll` and
  `endSession`); `request()` inside one defers the draw to the end of the
  outermost call, once, and outside any call draws at once. A call that
  throws still draws (try/finally). Tests: `visitor-stations.test.ts`
  "createCallGuard".
- `progressKept()` - the open tour has a walk with progress: the
  progress's stations are the open tour's (a closed tour's walk stays in
  the store until the guide's next run) and `walkHasProgress`. `stop()`
  draws the away block on the start page from it (`awayModel`), or
  hides it.
- `walkShown()` - the last render drew the sheet (the guide runs, the
  tour and its walk are known); `ar-entry.ts` passes it to the status as
  `walkRuns` (the tour reads as placed). When it flips, `walk.onShownChange` is called (main: the AR
  status re-renders), since nothing else re-renders the status when the
  guide starts after the code locked.
- Tests: the models and the writer's pure half have their own unit tests;
  this glue is driven by `playwright-tests/visitor-walk.spec.js`.

## The radar and the directions (visitor walk W4 build plan M3)

- `walk.radar?: WalkRadarDom` - the radar and the chip
  (`walk-radar.ts`), rendered with the sheet from the guide's view and
  the store's chip kind (`selectWalkChipKind`); hidden when the sheet is.
  Its stations are the list's rows (the branch rule stays one). A tap
  toggles the list through `sheetSet`.
- `walkDirectionsOf(view, chip, memory)` - each station's word and angle
  (`bearingDeltaDeg(bearing, heading)`) for the sheet model; none without
  a heading or while the chip is not `code` or `gps`, and the memory is
  then reset so the next words start cold.
- The direction memory and the radar's range and bursts reset in
  `stop()`.
- The frame time: `sampleFrameTimes` over `registerFrameUpdate` pushes
  every frame's `dt` (ms, first frame skipped) into a 2 s rolling window, registered at the
  session's first radar render and dropped in `stop()` (a session's end
  clears the frame loop's callbacks); `debugLines()` returns
  `walkDebugLines(mode, radar, frames, now)`: `walkRadarDebugLines`' two
  lines for a visitor's radar, none for a creator (who has no radar) or a
  page without one.
- The seam `xrProjection0` gives the radar its cone; the radar's canvas
  is observed by a `ResizeObserver` (`observeSize`) so its size is read
  only after a resize; its `listOpen` is the store's sheet.
- Tests: `walkDirectionsOf` and `walkDebugLines` in
  `visitor-stations.test.ts`; the composition
  in `playwright-tests/visitor-walk.spec.js`.
