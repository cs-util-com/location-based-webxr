# viewer-placement.ts

## Purpose

Viewer mode (QR-pose plan M4) and the photo placement (geo-join plan, flows
plan M4): the default passerby flow. Photos are placed at their capture spots
once the tracking-quality phase reports ready; scanned codes relocalize the
session via budgeted synthetic GPS votes and REFINE the alignment under the
placed planes; the ring around a code is the fallback for a tour without a
recording. Its own module since the flows plan M6.

## Public API

- `createViewerPlacement({ ctx, mode, arStore, arController, seams, errorBox, escapeButton, hooks, viewingLog? }): ViewerPlacement` - places only in visitor mode
  - `viewingLog` (M1b, `viewing-log.ts`): the `?debug=1` viewer recording's
    hooks - `detection` after each recorded detection (with the status before
    it), `vote` after each dispatched vote, `votedLock` first in
    `onVotedLock`, `placed` after the content, the capture-spot and the ring
    placements (the ring's count comes back from `placeDecodedPlanes`, 0 when
    it bailed). Silent unless a recording runs; absent, nothing is logged.
  - `ViewerPlacement.startScanGate()` (called when the session reaches
    running, and again when a tour opens into a running session) derives
    the scan gate (`scan-gate.ts`) and arms the escape clock
    (`seams.schedule`, 45 s) while it scans; idle when no session runs.
    `resetScanGate()` (a tour closed) returns it to idle with the clock
    cancelled - a gate waived for one tour never carries into the next.
    `reconsiderScanGate(levels | "unavailable")` (the levels arrived, or
    could not be read) waives a scanning gate that cannot lock. The
    controller's `onLocked` with a lockable level whose code has cast
    votes in this entry (`hasVoted`; authoring plan M2b, §2.2 B3) passes
    the gate - a lock that cast none corrected nothing; the
    escape button passes it as "skipped"; both place first and render the
    line after. Nothing is placed until the gate allows it (DEC-N3): the
    capture-spot join, the tour's content, AND the ring placed on a voted
    lock (the framework dispatches a frame's votes before it reports the
    lock, so the first `onVotedLock` arrives while the gate still scans).
  - The tour's content (`tour.json`, M5) is rendered once per session as
    soon as the gate allows it and the GPS zero exists
    (`renderTourObjects`; labels through `seams.createLabel`, photos
    decoded through `session.loadContentEntry`, which joins the archive's
    manifest prefix - a re-zipped tour keeps its photos under
    `mytour/content/…` while the record names `content/…` (PR #435
    review) - at the capture planes' divisor); a
    failed read names the object in the status line, a failed render goes
    to `ctx.contentError` (its own segment; the attempt stays latched,
    because the only throws there are deterministic constructors).
  - `startViewerPipeline(): boolean` - creates the viewer tracking
    controller into `ctx.qrController` and the fused pose source into
    `ctx.fusedPose` (the votes' stable pose, each code at its level's
    printed size; QR near-frontal pose plan §60) for THIS AR entry. What
    changed for visitors with it: no vote while the fused pose is not
    stable - too few views, a fit above 1.5 px, views that disagree, a
    moving code, 1 s of only native-order frames; after a tracking restart
    the old frame's detections stop counting; a level lookup finishing
    after the session ended is dropped (the pipeline's source is no longer
    the session's); each new evaluation is counted per code into
    `ctx.fusedTallies` (the `?debug=1` readout) and, while the pipeline is
    the session's, kept as `ctx.viewerLastEvaluation` (the visitor hint;
    plan §66, `qr-debug-readout.ts`). It also starts THIS entry's code
    keep-alive (`ctx.viewerKeepAlive`, authoring plan M2b): one store
    subscription casts the keep-alive's votes after every new DEVICE fix
    (`createDeviceFixWatch`), through the same `castVote` sink as a lock's
    votes, and removes itself once that keep-alive is no longer the
    session's (`endQrPipeline`, the next entry). False without a
    detector (plain AR, still placing photos; no keep-alive).
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
- **`castVote` is the one vote sink** (authoring plan M2b): every viewer
  vote - a lock's burst and the keep-alive's rings - is dispatched through
  it, so a per-vote concern has exactly one place to go. Its payloads carry
  the synthetic-QR source stamp, which is what keeps the keep-alive's own
  fix listener from answering them.
- **The seam for the per-entry solver overrides** (plan §3.2, D12; waits for
  the core release of M2a's soft-trimming keys). The viewer is to run the
  soft trimming only for its own AR entries, never as a global default:
  `resetGpsSessionData` keeps overrides across entries, so without a reset
  every later GPS-only solve would run the soft kernel the corpus never
  credited. The step is two dispatches, both in `startViewerPipeline`'s
  closure: (1) at its start - once per AR entry, before `arController.enable`
  and before any fix or vote - `setAlignmentOverrides(null)`; (2) in
  `castVote`, before the entry's FIRST payload (a closure flag),
  `setAlignmentOverrides({ ...current overrides, ...soft keys })` - merged,
  because the action replaces the whole object. Nothing else in the Tour
  Viewer dispatches overrides. The vote-strength harness
  (`viewer-vote-strength.test.ts`) then re-measures the shipped arm under
  the soft solver.
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

`viewer-placement-viewing-log.test.ts` - the `tourViewing/*` hooks through the
real viewer controller config (a lock, then its votes as one batch; no
second lock for the next tracked frame), and exactly today's dispatches
without a running recording. Only a lock's votes are batched into
`votesCast`; the keep-alive's go through `castVote` alone and reach a
recording as source-stamped GPS events.

`viewer-votes.test.ts` (authoring plan M2b) - with the real store: the
scan gate stays scanning on a lock that cast no vote (no GPS zero yet, a
converging pose) and passes on the first one that did; the keep-alive
casts exactly one ring per device fix from the kept pose, answers no
synthetic point, stops at AR exit, and starts fresh per entry.

`fused-pose-wiring.test.ts` - the votes' stable pose is the fused one (at
the true rotation where single-frame poses scatter past the old average's
gate), a restart empties it, and each pipeline start makes a new source.

`playwright-tests/ar-mode.spec.js` - the capture-spots placement with no
detection (forced `ready`), the refine-after-place lock, the ring for a
tour without a recording (budgeted votes, marker, three planes), the
unknown-code line, the no-levels "nothing to place" line, the no-detector
placement, and the per-entry re-placement. The pure pieces:
`qr-viewer-mode.test.ts`, `capture-geo-join*.test.ts`,
`image-planes.test.ts`, `tour-flow.test.ts` (`isPlacementReady`).
