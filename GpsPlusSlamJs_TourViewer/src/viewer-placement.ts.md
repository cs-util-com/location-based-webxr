# viewer-placement.ts

## Purpose

Viewer mode (QR-pose plan M4) and the photo placement (geo-join plan, flows
plan M4): the default passerby flow. Photos are placed at their capture spots
once the tracking-quality phase reports ready; scanned codes relocalize the
session via budgeted synthetic GPS votes and REFINE the alignment under the
placed planes; the ring around a code is the fallback for a tour without a
recording. Its own module since the flows plan M6.

## Public API

- `createViewerPlacement({ ctx, mode, arStore, arController, seams, errorBox, escapeButton, hooks, viewingLog?, now? }): ViewerPlacement` - places only in visitor mode
  - `now` (M2b review #4): the page clock - the QR controller's detection
    times and the moment a GPS fix arrives, the one clock the keep-alive's
    hold runs on; `Date.now` when absent (the controller's own default, and
    what the status line reads the hold with). Tests pass a fake clock.
  - `viewingLog` (M1b, `viewing-log.ts`): the `?debug=1` viewer recording's
    hooks - `detection` after each recorded detection (with the status before
    it), `vote` after each dispatched vote, `votedLock` first in
    `onVotedLock`, `placed` after the content, the capture-spot and the ring
    placements (the ring's count comes back from `placeDecodedPlanes`, 0 when
    it bailed), and `keepAlive` wrapping each AR entry's code keep-alive so
    its state changes are logged (M1b review #5; the wrapper is what
    `ctx.viewerKeepAlive` holds, so the AR exit's and the tour close's
    `stop()` are logged too). Silent unless a recording runs; absent,
    nothing is logged.
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
    the gate - a lock that cast none corrected nothing (`gateOnLock`); AFTER
    it, every such lock of a code with a known level id goes to
    `hooks.stationCodeLocked` (tour kit plan K4: the lock that passes the
    gate may also find the station the code anchors; an ignored code
    reaches `onIgnoredLock` instead, D20); the
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
    plan §66, `qr-debug-readout.ts`). Its FIRST statement, before the
    plain-AR return, starts the entry's vote sink
    (`ctx.viewerVoteSink`, `viewer-vote-sink.ts`, M2e), which clears every
    solver override. It also starts THIS entry's code keep-alive
    (`ctx.viewerKeepAlive`, authoring plan M2b) with one store
    subscription that stops it when the odometry frame changes
    (`qrDetected.frameEpoch`: the kept pose names a place in the old frame,
    M2b review #1) and removes itself once that keep-alive is no longer the
    session's (`endQrPipeline`, the next entry); its votes are cast by
    `recordDeviceFix`. A lock's votes reach the sink all at once
    (`dispatchVotes`): one batch per lock. It creates the entry's vote
    budget as `ctx.viewerVoteBudget`, which a tour switch resets
    (`endTourCodeVotes`, M2b review #6). False without a detector (plain
    AR, still placing photos; no keep-alive).
  - `recordDeviceFix(fix): void` (M2e, D18) - where the page's device GPS
    fixes go: `main.ts` hands it to `createGpsPositionHandler` as
    `recordFix`, so the framework coordinator builds the fix (after the
    session zero) and this decides how it reaches the store. With a viewer
    entry running it asks the keep-alive for the fix's ring, scheduled by
    the fix's ARRIVAL on `now` and stamped with its Geolocation time (M2b
    review #4), and the sink stores the fix and the ring as ONE
    `recordGpsEventBatch`, the fix first - one solve per tick. Without a
    ring (no kept code, the fade owing less than 3 votes, a fix time that is
    not finite) or outside a visitor entry (author mode, after AR exit) it is
    the plain `recordGpsEvent`. Only device fixes reach it, so the
    keep-alive never answers a vote.
  - `tryPlaceTour(): void` - the placement trigger (DEC-F3): with a tour
    open and a viewer session live (`ctx.placementUnsubscribe !== null`),
    runs the capture join ONCE per session+tour
    (`ctx.placementAttempted`) as soon as
    `isPlacementReady(selectTrackingQuality(state))`; until then sets
    `waiting-ready`. It also waits while `tour.json` is still loading
    (`tourManifestStatus === "pending"`; the manifest's settle calls it
    again), because the baked spots live there. A tour with neither a
    recording nor baked spots declines at once (the ring waits for a
    lock). Cheap by design: a few predicate reads per dispatch.

## The moved-code veto (D20, M5c; owner approval 2026-10-02)

- **Pin.** `startViewerPipeline` creates the entry's `movedCodeChecks`;
  the config's `onVotedPose` pins a code (by its level id from
  `levelIdByText`) on the stable pose of its first voted lock, through the
  current zero.
- **Judge.** One store subscription per entry: whenever the GPS history
  array changed, `checks.update(history, now())` folds the new device fixes
  and judges; an odometry frame change (`qrDetected.frameEpoch`) ends every
  pin (`frameChanged`). The recovery's own dispatches are not judged again.
  No compass reading reaches the checks (owner, 2026-10-02): a code's turn
  comes from its pose in GPS world space only.
- **Veto** (`vetoMovedCode`), once per level id: the id joins
  `ignoredCodes` (the rest of the page session for this tour); the
  keep-alive stops if it holds this code; `viewerVoteSink.retractVotes()`
  resets the history and re-feeds the device fixes with the soft keys off,
  so the content moves ONCE, to the GPS answer; the vote budget is reset
  (M5c review M2: every code's votes are gone, so another code, even a
  spent one the keep-alive holds, votes again on its next lock; the vetoed
  code stays blocked by `isIgnored`); the viewing log records
  `codeIgnored` with the evidence and the recovery; `viewerIgnoredText` is
  set; the gate passes `ignored` (`markGateIgnored`: a scanning gate, or
  one the code itself passed; an escape or a waived gate stays).
- **Afterwards** the config's `isIgnored(text)` (level id in
  `ignoredCodes`) makes every later lock of the code free: no fused pose,
  no vote, no keep-alive; `onIgnoredLock` sets the line and the gate. The
  next entry's gate starts from `ignoredLevelIds` (all lockable codes
  ignored: passed at once).
- **Two codes** (M5c review M1): the gate records which code passed it
  (`ctx.scanGateCodeText`); a veto flips it to `ignored` only for that
  code. Another code's voted lock clears `viewerIgnoredText` (the line no
  longer names the vetoed code) and turns an `ignored` gate back to `code`
  for itself. The lock's text is the latest detection's, which the
  controller reports before the lock.
- **No lock-time veto** (M5d dropped): a sighting is never judged through an
  alignment that converged before it.

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
- **The photos' spots come from `tour.json` when the creator's Finish
  baked them** (`captureSpots`, scan-pass plan S1, S-D11): no download of
  the walk, no replay, and the status line reports the baked fixes. A tour
  without them runs the SAME bake here (`capture-bake.ts`: each photo
  through the first settled alignment after it was taken), so both show
  the photos at the same spots.
- **The ring's photos are the visitor's** (`entriesForVisitor` over
  `ctx.visitorEntries`): the first three images a visitor reads, never a
  frame of a walk the copy kept for a co-author.
- **A declined join is remembered** (`joinDeclined`) so a later lock goes
  straight to the ring instead of replaying the walk (seconds of CPU).
- **Liveness inside the async runs is the controller status (`running`)
  plus `planesRunGeneration`** - never `qrController`, which is null for a
  whole session without a BarcodeDetector (review #2). Every bail path
  frees its textures.
- Votes: `canAcceptVotes` tests the session ZERO, not merely the slice
  (PR #386 review) - votes before the zero would charge the budget while
  `recordGpsEvent` wrote nothing.
- **The entry's vote sink is the one way a vote reaches the store**
  (`viewer-vote-sink.ts`; authoring plan M2b, batched in M2e): a lock's
  ring and each keep-alive tick (with its device fix) are ONE
  `recordGpsEventBatch` each (D18), so a per-vote concern has exactly one
  place to go. The votes carry the synthetic-QR source stamp; the keep-alive
  is triggered only by `recordDeviceFix`, never by a stored point, so it
  cannot answer its own votes. **The cost check:** a keep-alive tick is
  exactly one store action (pinned by `viewer-votes.test.ts`, no
  wall-clock assertion; the CPU numbers are the CPU-cost results' M2f
  re-measurement). With a `?debug=1` recording running, a keep-alive state
  change also logs its `tourViewing/keepAlive` action first.
- **The seam for the per-entry solver overrides** (plan §3.2, D12; WIRED in
  M2e on core 1.26, `viewer-vote-sink.ts`). The viewer runs the
  soft trimming only for its own AR entries, never as a global default:
  `resetGpsSessionData` keeps overrides across entries, so without a reset
  every later GPS-only solve would run the soft kernel the corpus never
  credited. The contract, exactly (restated after the M2b/M2d milestone
  review #3, which found the keep-alive unsafe under the hard trim: B = 5 m
  fails the rule, 8 m jumps, 15 m never hands off):
  1. **Clear first, on EVERY entry.** `setAlignmentOverrides(null)` is
     dispatched by the first statement of `startViewerPipeline`
     (`startEntryVoteSink`), BEFORE its early return for a device without a
     detector: a plain-AR entry must never keep a previous entry's soft
     setting, and it casts no vote that would clear it later. It runs before
     any fix or vote of the entry.
  2. **Soft on at the entry's first vote.** The sink dispatches
     `setAlignmentOverrides({ ...current overrides, ...VIEWER_SOFT_TRIM })`
     right before the entry's FIRST batch - merged, because the action
     replaces the whole object (`outlierFalloffEnabled: true`,
     `outlierFalloffRadiusMeters: 1`, `outlierFalloffExponent: 1`,
     `outlierRejectionEnabled: false`). Every viewer vote (a lock's ring, a
     keep-alive tick) goes through the sink, so no vote reaches the solver
     under the hard trim.
  3. **Soft stays on until AR exit, a tour switch included** (M2e
     milestone review #1, reversing the M2b fix agent's off-at-switch
     choice): `endTourCodeVotes` stops the keep-alive and resets the budget
     but dispatches no override, and the sink has no way to turn the soft
     trimming off; only the next entry's start (rule 1) clears it. Reason:
     the closed tour's votes (up to 160 per code from its locks, plus every
     keep-alive ring) stay in the GPS history until AR exit, so turning the
     soft kernel off at the switch puts the hard trim back onto them - the
     regime M0b/M2b measured as a 2.8-5.8 m jump at a 5-8 m bias - and the
     M0c results say the viewer keeps the setting for the rest of the
     session. The cost accepted: between tours, and in the next tour before
     its first vote, a GPS-only stretch is solved under the soft kernel,
     which the corpus never credited for GPS-only solving; it is bounded by
     the entry, and those stretches still hold the closed tour's votes.
     Nothing else in the Tour Viewer dispatches overrides. Pinned by
     `viewer-vote-sink.test.ts` (the order and content against the real
     store) and `viewer-votes.test.ts` (through this module: a plain-AR
     entry, a re-entry, a tour switch); the vote-strength harness
     (`viewer-vote-strength.test.ts`, `VOTE_STRENGTH_SWEEP=m2e`) measures
     the shipped arm through the same sink. These replace
     `viewer-soft-trim-guard.test.ts`, the tripwire that held while the
     core refused the keys and broke, as designed, on core 1.26.
- **The tour's content follows the live alignment - no per-note GPS anchors
  (owner decision D10a, authoring plan 2026-09-28-0953 §3.2, M2d).**
  `tryPlaceContent` hands `renderTourObjects` the scene root
  (`seams.getScene()`), so every alignment change - a scan's votes above
  all - moves the content in the visitor's view in the same dispatch. A
  GPS anchor (`FW/visualization/gps-anchor.ts`) moves only off screen and by
  at least ~2.2 m, position only: it would hide a scan's correction and put
  the 0.3 m field acceptance out of reach. Pinned by
  `viewer-content-alignment.test.ts` through this call site and the real
  QR controller (which also pins the votes-before-lock order the gate
  relies on: the content is placed on the first voted lock, through that
  lock's votes); revisit only with that decision.
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
- Every tour image this module decodes (the placed photo planes, the
  capture planes, the ring) carries the tour pixel cap
  (`decodeFrameTexture`'s `maxPixels: TOUR_MAX_IMAGE_PIXELS`, tour kit K4
  review R2): an image over 4096 x 4096, or one whose size cannot be read,
  is never decoded and leaves its plane out.
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
`votesCast`; the keep-alive's go through `recordDeviceFix` alone and reach a
recording as source-stamped GPS events, its state changes as
`tourViewing/keepAlive` (the session's keep-alive is the logged one, the AR
exit's stop included; nothing without a running recording).

`viewer-votes.test.ts` (authoring plan M2b) - with the real store: the
scan gate stays scanning on a lock that cast no vote (no GPS zero yet, a
converging pose) and passes on the first one that did, and a code that
locks but never votes still gets the 45 s escape (M2b review #8); the
keep-alive casts exactly one ring per device fix from the kept pose,
answers no synthetic point, stops at AR exit, and starts fresh per entry;
a code re-scanned 20 minutes later votes from where it reads now and the
keep-alive re-votes from there, a frame change ends the hold (review #1);
the hold hands over by arrival with the fix clock skewed by 5 s or 1 h
either way (review #4); a tour reopened in the same entry waits for a real
vote and holds again (review #6). M2e: a lock's ring is ONE batch, a
keep-alive tick is exactly ONE store action (the device fix first, then
its ring), a fix the keep-alive does not answer is the plain
`recordGpsEvent`, a malformed fix inside a tick is dropped alone by the
core, the composed GPS handler (`recordFix`) routes here; and the
per-entry overrides through this module (soft on right before the first
vote, a plain-AR entry and a re-entry start cleared, a tour switch turns
them off until the next tour's first vote).

`viewer-vote-sink.test.ts` (M2e) - the sink against the real store: the
clear at entry start, the merge before the first vote and once only, a
keep-alive tick bringing the first vote, a ringless fix changing nothing,
`endTour`, the soft keys as M0c measured them, one batch per lock, the
tick's fix-first batch, a malformed fix dropped alone.

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
