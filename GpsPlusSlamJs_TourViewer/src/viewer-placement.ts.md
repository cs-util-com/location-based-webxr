# viewer-placement.ts

## Purpose

Viewer mode and the content placement: the default passerby flow. The
tour's own content (`tour.json`'s items) is placed once the gate allows it
and the GPS zero exists; until the tracking-quality phase reports ready or
a code placed the tour the line coaches the visitor. Scanned codes
relocalize the session via budgeted synthetic GPS votes and REFINE the
alignment under the placed content. A visitor never sees the walk, the
zip's other images, or its debug camera captures: nothing here reads
them.

## Public API

- `createViewerPlacement({ ctx, mode, arStore, arController, seams, errorBox, escapeButton, hooks, viewingLog?, now? }): ViewerPlacement` - places only in visitor mode
  - `now` (M2b review #4): the page clock - the QR controller's detection
    times and the moment a GPS fix arrives, the one clock the keep-alive's
    hold runs on; `Date.now` when absent (the controller's own default, and
    what the status line reads the hold with). Tests pass a fake clock.
  - `viewingLog` (M1b, `viewing-log.ts`): the `?debug=1` viewer recording's
    hooks - `detection` after each recorded detection (with the status before
    it), `vote` after each dispatched vote, `votedLock` first in
    `onVotedLock`, `placed` after the content placement - once per station each time that station is drawn
    (`station` names it, always: everything placed belongs to a station),
    with the count that stood - and `keepAlive` wrapping each AR entry's code keep-alive so
    its state changes are logged (M1b review #5; the wrapper is what
    `ctx.viewerKeepAlive` holds, so the AR exit's and the tour close's
    `stop()` are logged too). Silent unless a recording runs; absent,
    nothing is logged.
  - `ViewerPlacement.startScanGate()` (called when the session reaches
    running, and again when a tour opens into a running session) derives
    the scan gate (`scan-gate.ts`) and arms the escape clock
    (`seams.schedule`, `SCAN_GATE_ESCAPE_MS`, 10 s) while it scans - but
    not in the codes-only mode (`ctx.codesOnly`, QR-first M1b-1): without
    location there is no GPS to continue with, so the "Continue with GPS
    only" button never shows; idle when no session runs. The clock running
    out is not enough either: the escape waits for a DEVICE fix of this AR
    entry (the store's GPS history, which an AR exit resets while the
    session origin survives, read through `deviceGpsQuality`, which is
    built on `deviceSamples`, the one device-only filter in
    `device-gps-quality.ts` - a code's votes are not GPS). With none yet, the
    gate keeps scanning without the button, and the first device fix after
    the clock (`recordDeviceFix`) offers it: indoors a phone may hold the
    permission and never get a fix, and the escape then promised a
    placement nothing could make.
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
    line after. Nothing is placed until the gate allows it (DEC-N3), and a
    voted lock ends the wait for readiness only then too (the framework
    dispatches a frame's votes before it reports the lock, so the first
    `onVotedLock` arrives while the gate still scans).
  - The tour's content (`tour.json`, M5) is rendered once per session as
    soon as the gate allows it and the GPS zero exists
    (`renderTourStation`: a group per station at its geo pose, its
    free blocks (pins, pictures and, since B2b, placed models through
    `seams.loadGlbModel` over the same read) as children at their local
    poses, the
    stations without free blocks skipped; each
    station one "items" part of the side table, see below; labels
    through `seams.createLabel`, photos
    decoded through `deps.loadContent` when given (the stations' prefetch
    cache, `visitor-stations.ts`, which holds story media only: an item
    photo is read from the archive again on each return until item photos
    join the prefetch), else `session.loadContentEntry`, which
    joins the archive's
    manifest prefix - a re-zipped tour keeps its photos under
    `mytour/content/…` while the record names `content/…` (PR #435
    review) - at divisor 2, `PHOTO_DECODE_DIVISOR`); a
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
    M2b review #1) - and ends the code's trust there too
    (`endCodeTrust`: `viewerLockedText` null and `viewerVotedLocks` 0, so
    `codeLinedUp` reads false for the stations, the status line and the
    placement trigger; unlike a veto the code is not ignored, its votes
    stay, and its next voted lock lines the tour up again) - and removes
    itself once that keep-alive is no longer the
    session's (`endQrPipeline`, the next entry); its votes are cast by
    `recordDeviceFix`. A lock's votes reach the sink all at once
    (`dispatchVotes`): one batch per lock. It creates the entry's vote
    budget as `ctx.viewerVoteBudget`, which a tour switch resets
    (`endTourCodeVotes`, M2b review #6). False without a detector (plain
    AR, still placing the tour's content; no keep-alive).
  - `storedCodeVotes(options: CodeVoteOptions): CodeVoteDeps` - the vote
    half of a CREATOR's pipeline at a code the tour stores
    (`creator-measuring.ts`): the deps the visitor's pipeline votes by
    (`codeVoteDeps` - dispatch through the entry's sink, keep-alive,
    budget, ignored-code memory and veto hooks, the zero check, the
    stable-pose gate that sets the zero from the code, the level and
    lock callbacks), so creator and visitor vote by one path. The
    entry's pieces (`startEntryCodeVotes`: sink, keep-alive, budget,
    moved-code checks) are started with the entry's first pipeline and
    reused while `ctx.viewerVoteSink` is still theirs, so a creator's
    pipeline restarted within the entry (a print size adopted) keeps the
    soft trimming, the budget, the hold and the checks. Which frames
    may vote is the caller's rule (`options.resolvePose`); `options.live`
    drops a late callback of an ended pipeline. A creator entry keeps no
    viewing log (`viewingLog` is the visitor's). The lines a vote or a
    veto changes are re-rendered for both modes (`renderStatus`: the
    creator's panel reads the votes - its placement opens on them).
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
    places the tour's content once the gate allows it, and ends the wait
    for readiness ONCE per session+tour (`ctx.placementAttempted`; the
    placement goes back to `idle`) as soon as
    `isPlacementReady(selectTrackingQuality(state))` - or as soon as a
    code placed the tour (the gate passed on a voted lock of a trusted code;
    QR-first M1, §7 #9: on votes alone the tracking-quality report reads
    `degraded`, its smoothed convergence score having seen too few
    snapshots); until then sets `waiting-ready`. **No compass wait (since
    r863).** From 2026-10-14 to r863 a code that placed the tour before any
    device fix held the first placement back for 8 voted locks or 12 s,
    because the core's 9-solve compass window gave the first compass reading
    full weight over a short scan and the content turned by about the
    compass's error. The owner raised that as a bug of its own: once a code
    is recognised, its rotation must stand at once. The core's cold start
    restarts on a solve that stores a wide sighting's votes (core 1.26.2;
    from r863 to r868 the entry's overrides carried a 1-solve compass window
    for it), so the compass
    weight is 0 from the first voted lock, and everything shows on that lock: harness `CODE_YAW_PROBE=scan`
    (`code-yaw-compass-overwrite.test.ts`) measured at most 0.27 deg seen
    within 30 s of showing over compass bias 0-30 deg, a drifting compass,
    the first fix in the scan, 0-8 s late or before it, GPS noise 0 and 2 m
    (5 and 8 m too for a fix first) and
    1-10 locks, except a bearing the compass applied before the scan (up to
    2.47 deg on the first lock, gone by the second) - against up to 34.7
    deg with the wait, which also never covered the fix-first order. (Snap
    alpha 1, which removed that residue, was dropped in the r863 milestone
    review for its per-fix steps over the rest of the entry.) Investigation:
    `GpsPlusSlamJs_Docs/docs/2026-10-15-0511-code-rotation-overwritten-by-compass-investigation.md`.
    The code rule changes
    little (corrected after the M1 review #5; the M1 commit overstated it):
    every voted lock AFTER the gate already ends the wait itself
    (`onVotedLock`), bypassing readiness, so the rule decides only a scan
    whose single voted lock opened the gate, and this trigger's own latch
    (`placementAttempted`). (It no longer waits for a `tour.json` still
    loading: that wait was for the walk's recorded photos, which a visitor
    no longer sees; the content's own placement waits for a settled
    manifest.) Cheap by design: a few predicate reads per dispatch.

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
  `ignoredCodes` (until the check lifts the veto, or the page session for
  this tour ends); the
  keep-alive stops if it holds this code; `viewerVoteSink.retractVotes()`
  resets the history and re-feeds the device fixes with the soft keys off,
  so the content moves ONCE, to the GPS answer; the vote budget is reset
  (M5c review M2: every code's votes are gone, so another code, even a
  spent one the keep-alive holds, votes again on its next lock; the vetoed
  code stays blocked by `isIgnored`); `viewerVotedLocks` goes to 0 and
  `viewerLockedText` to null (r881 review M1: nothing reads the tour as
  lined up by a code - `codeLinedUp`, `codePlacedTour`, the stations'
  trust - until a code votes again); the viewing log records
  `codeIgnored` with the evidence and the recovery; `viewerIgnoredText` is
  set; the gate passes `ignored` (`markGateIgnored`: a scanning gate, or
  one the code itself passed; an escape or a waived gate stays).
- **Afterwards** the config's `isIgnored(text)` (level id in
  `ignoredCodes`) makes every later lock of the code free: no fused pose,
  no vote, no keep-alive; `onIgnoredLock` sets the line and the gate. The
  next entry's gate starts from `ignoredLevelIds` (all lockable codes
  ignored: passed at once).
- **Lifted** (`restoreMovedCode`, polish round C5, owner decision Q-C5):
  the check keeps folding a vetoed code and, once it reads consistent on
  at least `RESTORE_SPREAD_FACTOR` (2) times the spread it was vetoed on,
  calls back: the id leaves `ignoredCodes`, `viewerIgnoredText` clears if
  it names the code, the viewing log records `codeRestored`; the next lock
  votes and pins a new check. The veto's retracted votes are not restored.
  An AR exit, a frame change, or a veto read after a frame change ends the
  vetoed code's check; the ignored code's next lock then pins a probation
  check (`probationPin`: on the lock's detection pose, starting vetoed at
  the spread kept in `ignoredCodes`), so the veto is re-judged in every
  entry and frame (the M0a review #1). A tour switch forgets the veto.
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
  `latestReprojectionPx`, `placement`, `placementAttempted`,
  `levelByText` (written by `onLevelResolved`).
- **The code is a refinement, not a gate** of readiness:
  the ready trigger ends the coaching without a code; a lock after it
  changes the status only.
- **No debug camera capture, ever** (the debug captures plan, E1): the
  walk's frames are debug data, shown only in the desktop editor. The
  viewer places nothing from them, reads none of their files, and the line says nothing of them
  (`viewer-placement-photos.test.ts`). A visitor never replays a walk,
  so `archive-open.ts` stops the background download of every copy that
  carries one (`stopsVisitorDownload`).
- **Liveness without a detector:** `qrController` is null for a whole
  session without a BarcodeDetector, and the content still places. The
  placement itself is synchronous; the decodes run in the side table,
  whose late renders are dropped and freed.
- Votes: `canAcceptVotes` tests the session ZERO, not merely the slice
  (PR #386 review) - votes before the zero would charge the budget while
  `recordGpsEvent` wrote nothing.
- **A code alone sets the zero (QR-first plan 2026-10-14-0445 §3 M1).** The
  stable-pose gate (`resolveStablePose`) sets the session zero at the code's
  stored geo when a code's pose is stable and the session has none, so the
  frame's votes land at once. The order is the controller's: the zero
  BEFORE the votes are dispatched (the sink's soft trim and the store need
  it) and before `onVotedPose` pins the moved-code check on it (§7 #9). A
  later device fix joins that frame: the coordinator sets a zero only when
  the session has none. A code without geo sets nothing. With no device fix
  at all a wrongly placed code cannot be detected - the moved-code check
  needs device fixes; once they arrive it reads and retracts as before, and
  the retraction keeps the code's zero. **Latency** (M1 review #2): with no
  fix before the pin, a wrong code is read at the earliest after the rule's
  60 s of device fixes (`CODE_MOVE_RULE.minSpanS`; measured 60-75 s for a
  25 m move), and a code hung less than the 20 m floor
  (`MOVED_CODE_FLOOR_M`) from its saved spot is never read (measured: 15 m,
  no veto in 120 s) - it holds the tour off by its offset until device
  fixes take over from its hold; with no device fix at all there is no
  hand-over (the keep-alive casts only on a device fix), so the offset
  stands for the whole session (PR #620 review).
- **Effectively unreachable lines, kept on purpose** (M1 review #6): the
  placement decline "waiting for a GPS fix or a scanned code" (a code's
  votes need the zero it sets itself, and `ready` needs GPS data) and the
  fused hint "Code measured - placing the tour." (the same frame votes).
  Both stay so no state is ever silent.
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
  `tryPlaceContent` hands the side table the scene root
  (`seams.getScene()`), so every alignment change - a scan's votes above
  all - moves the content in the visitor's view in the same dispatch. A
  GPS anchor (`FW/visualization/gps-anchor.ts`) moves only off screen and by
  at least ~2.2 m, position only: it would hide a scan's correction and put
  the 0.3 m field acceptance out of reach. Pinned by
  `viewer-content-alignment.test.ts` through this call site and the real
  QR controller (which also pins the votes-before-lock order the gate
  relies on: the content is placed on the first voted lock, through that
  lock's votes); revisit only with that decision.
- **Drawn per station** (visitor plan 2026-10-18-2349 §3, M2;
  `station-content.ts`): everything placed is a part of its station in
  the session's side table (`ctx.stationContent`, created with the first
  part): the tour's items ("items", one per station that has some). Only the
  stations the store shows - the present one, or every one under "show
  all" - are decoded and stand in the scene, one station group at a time
  with a 400 ms fade. `syncContent()` tells the table the shown set on
  every store dispatch and camera frame (`main.ts` `hooks.tickStations`);
  `tryPlaceTour` ends with it.
  - **What the status line says** (the async-UI rule): the content's
    count for the stations shown (`contentStatus`, "N placed objects");
    a part that could not be built goes to `ctx.contentError`.
  - **A code's trust ends on events only**: a veto, an odometry-frame
    change, an AR exit, a new tour - never by the clock, a count of fixes
    or a distance (measured across clock, fix-count and distance rules in
    a museum-sized layout: every clock rule kept the right station far
    less often than "never by the clock").
  - Tracking alone shows nothing: a code's votes feed the tracking-quality report;
    nothing here is shown or kept alive on tracking alone - the shown set
    comes from presence (`station-guide.ts`'s one gate), and a veto still
    stops every keep-alive. M2 reads `codeLinedUp` nowhere new.
- Station groups live at the SCENE ROOT in raw GPS-world NUE (the
  framework's built-once parenting rule); the alignment moves the odometry
  group under them, which is why a later lock needs no re-placement.
- `levelByText` is owned here (the only reader/writer:
  `onLevelResolved` and the detection glue); it is
  cleared on tour teardown (`archive-open.ts`), not on session end - the
  same tour's codes stay valid across AR re-entries, and the QR
  controller's `reset()` re-resolves any text that locks again.
- Every tour image this module decodes (the placed photo planes) carries
  the tour pixel cap
  (`decodeFrameTexture`'s `maxPixels: TOUR_MAX_IMAGE_PIXELS`, tour kit K4
  review R2): an image over 4096 x 4096, or one whose size cannot be read,
  is never decoded and leaves its plane out.
- Photo planes decode at divisor 2 (`PHOTO_DECODE_DIVISOR`, the framework
  decoder's OOM mitigation; geo-join review finding 4).

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

`viewer-placement.test.ts` - the scan gate's driver against a fake clock
and button: the clock, the escape's tap, the levels' waivers, the reset per
tour; the escape only with a device fix of this entry (none at the clock
then one after it, a fix before the clock, an origin kept from an earlier
entry, codes only). The e2e `ar-mode.spec.js` "a visitor with location
allowed but no fix is offered the GPS escape only once a fix arrives"
drives it through the page.

`viewer-placement-photos.test.ts` - through the real
controller config, the decoder faked: a zip with a walk and frames draws
none of them and reads none of their files, while its pins stand at their
stations.

`viewer-placement-viewing-log.test.ts` - the `tourViewing/*` hooks through the
real viewer controller config (a lock, then its votes as one batch; no
second lock for the next tracked frame), and exactly today's dispatches
without a running recording. Only a lock's votes are batched into
`votesCast`; the keep-alive's go through `recordDeviceFix` alone and reach a
recording as source-stamped GPS events, its state changes as
`tourViewing/keepAlive` (the session's keep-alive is the logged one, the AR
exit's stop included; nothing without a running recording).

`viewer-votes.test.ts` (authoring plan M2b) - with the real store: the
scan gate stays scanning on a lock that cast no vote (a converging pose)
and passes on the first one that did - since QR-first M1 also before any
device fix, the code setting the zero itself (its order before the votes
and the moved-code pin, a later fix in the same frame through the page's
composed handler, readiness on votes alone), and a code that
locks but never votes still gets the escape (M2b review #8); the
keep-alive casts exactly one ring per device fix from the kept pose,
answers no synthetic point, stops at AR exit, and starts fresh per entry;
a code re-scanned 20 minutes later votes from where it reads now and the
keep-alive re-votes from there, a frame change ends the hold (review #1);
a frame change ends the code's trust (no code lines the tour up, neither
line says it places the tour, the visitor's line asks for the code, and
the tour is no longer code-placed until the next voted lock:
`codePlacedTour`) but keeps what a veto takes (the code not
ignored, its votes, the gate), a re-scan lines the tour up again, a store
change without a frame change keeps it, and codes only behaves the same;
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

`viewer-moved-code.test.ts` (M5c) - the wired veto: the keep-alive stops
(also when another code holds it: no ring goes into the fixes after the
veto, and that code's next lock votes again), every vote is taken back and
the tour moves once, later locks of the code are free, the log, the gate,
the line, the re-judged veto.

`viewer-vote-sink.test.ts` (M2e) - the sink against the real store: the
clear at entry start, the merge before the first vote and once only, a
keep-alive tick bringing the first vote, a ringless fix changing nothing,
`endTour`, the soft keys as M0c measured them plus the two compass keys
(r863), one batch per lock, the
tick's fix-first batch, a malformed fix dropped alone.

`viewer-content-alignment.test.ts` (D10a, M2d; QR-first) - through the
real controller and store: the content follows the live alignment, a code
alone places the tour, and since r863 no compass wait: the content and
the station on the scanned code show on the first voted lock (r857 review
#1 the other way round), a second AR entry and a tour opened inside one entry
show on their first voted lock too (PR #624 review; the AR exit and the
tour switch are mirrored in the test); and the owner's bug (r863): a
code's rotation stays within 1 deg of the code's when device fixes with a
20-30 deg biased compass follow one voted lock, a 3-lock glance with a late
first fix, the fix-first order, a second entry and a reopened tour - while
without a code the compass still leads the GPS-only cold start.

`fused-pose-wiring.test.ts` - the votes' stable pose is the fused one (at
the true rotation where single-frame poses scatter past the old average's
gate), a restart empties it, and each pipeline start makes a new source.

`playwright-tests/ar-mode.spec.js` - a `tour.json` carrying debug camera
captures showing its pin and no frame, the refine-after-place lock, the
content and photos waiting for the lock (budgeted votes, marker), the
unknown-code line, the no-detector placement, and the per-entry
re-placement. The pure
pieces: `qr-viewer-mode.test.ts`, `image-planes.test.ts`,
`tour-flow.test.ts` (`isPlacementReady`).

## Reached story blocks (B2b)

- `syncContent` (and the end of `tryPlaceContent`) gives each reached
  story world block (`selectShownBlocks` through `reachedWorldBlocks`)
  one part of its station's side-table entry, key `story:<blockId>`,
  drawn by `renderStationBlocks` with the same renderer deps as the
  station's `items`; a block no longer reached (a new walk) has its part
  removed. The table is told only changes, and a new table (a new AR
  entry) is told again.
- A tour whose stations hold no free block but a story world block is
  placed too (the early return also asks `hasStoryWorldBlocks`).
- Tests: `viewer-placement-story-blocks.test.ts`; the e2e
  `story-blocks.spec.js` (a pin the story shows stays after its end).
