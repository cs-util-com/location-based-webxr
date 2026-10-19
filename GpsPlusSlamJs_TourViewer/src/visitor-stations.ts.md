# visitor-stations.ts

## Purpose

The visitor's stations, composed (tour kit plan K4): the station guide
(`station-guide.ts`), the story panel (`scene-view.ts`), the AR stage
(`scene-stage.ts`) and the one sound channel (`scene-audio.ts`), wired to
the page's session object, store and seams. Glue: the behaviour is tested
in those modules, the composition in `playwright-tests/stations.spec.js`.

## Public API

- `wireVisitorStations({ ctx, mode, arStore, seams, dom, now, schedule, relocate? }):
VisitorStations` - `{ tick, codeLocked, unlockAudio, stop }` (properties,
  handed to the hooks unbound). `relocate` (`{ onRelocated }`) turns on the
  test switch `?relocate=here` (`tour-relocation.ts`): the stations are
  held back until the phone's first raw GPS fix, then moved there.
- `stationPlacementAllowed(ctx, mode): boolean` - the guide's
  `placementAllowed`, exported so the placement test drives the page's
  own rule (see below).
- `stationAlignmentSignals(ctx, arStore)` - the guide's `codeLinedUp` and
  `alignmentReady` (`tour-flow.ts`): the viewer pipeline's voted locks
  this AR entry (`ctx.viewerLockedText`, `ctx.viewerVotedLocks`) and the
  store's tracking-quality report. Exported for the same reason. No state
  of its own: both are read each tick.

## Invariants & assumptions

- The tour is read from the session object each time: `ctx.tourManifest`
  (settled) for the stations, the order and the assets, and the store's
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
  (`ctx.tourManifest`, by identity): kept across AR sessions, dropped when
  the tour closes or another opens (K4 review R15). A figure is decoded by the framework's
  `decodeFrameTexture`, one at a time through a `keyed-chain` key, via
  `decodeFigure` (its size read from its own header, refused over the tour
  pixel cap, scaled to 2048 px; K4 review R2); a story picture is checked
  by `pictureProblem` before its `<img>`; a model by `seams.loadGlbModel`
  after `loadContentEntry`'s `checkGlbInert`, which also measures every
  image inside it.
- The breadcrumbs (`breadcrumbs.ts`) follow the guide's `onGuide`, one
  trail for the page.
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
- `viewer-content-alignment.test.ts` ("finds the station on the scanned
  code on the first voted lock"): the real station guide over the real
  placement, `stationPlacementAllowed` and `stationAlignmentSignals`.
