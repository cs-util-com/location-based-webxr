# Changelog

## Unreleased

### ⚠️ Breaking changes

- **`QrVoteBudget` gains a required `isSpent(text)`** (QR near-frontal pose
  plan §71): whether a code is at the budget's own cap, so an app can skip
  the fused-pose solve for a code that can no longer vote.
  - **Migration:** code that implements or stubs `QrVoteBudget` adds it
    (e.g. `isSpent: (text) => spentFor(text) >= cap`); code that only uses
    `createQrVoteBudget` is unaffected.
- **`QrDetectionEvent` gains a required `intrinsics`** (QR near-frontal
  pose plan, M3b b3): the intrinsics of the buffer the corners came from, so
  the fused QR window can re-solve several detections jointly.
  `QrTrackingController` fills it from `getIntrinsics(image)`.
  - **Migration:** code that BUILDS a `QrDetectionEvent` itself (as the QR
    demo does) adds the intrinsics it solved with; code that only receives
    the event is unaffected.
- **`engines.node` raised from `>=22.15.0` to `>=26.0.0`**
  (owner decision 2026-09-08). Installing on the Node 22 and 24 LTS lines
  is no longer a supported configuration.
  - **Why.** The consumer floor and the development line were split on
    2026-09-07 so a toolchain pin would not push consumers off an LTS
    line (PR #431 review). But nothing then ran the package at the lower
    floor: everything that builds, tests and publishes it runs Node 26. That made `>=22.15.0`
    an untested assertion whose failure mode is a syntax form or built-in
    reaching `dist/` and breaking only in a consumer's install.
  - **In practice** `engines` is a warning, not an error, for npm and pnpm
    at default settings; an out-of-range install still succeeds unless the
    consumer sets `engine-strict`.
  - **Worth knowing:** Node 26 does not itself reach LTS until October 2026.
  - `devEngines` is removed as redundant.

- **Camera frames now carry the camera pose and time of their capture**
  (QR perf plan 2026-09-23, M4). `ArSessionCallbacks.cameraFrame.onFrame`,
  `QrTrackingController.offerFrame` and `QrDetectionController.offerFrame`
  take a `CapturedCameraFrame` (`{ image, cameraPose, capturedAtMs }`)
  instead of a bare `RgbaImage`, and `getCameraPose` is removed from both
  `QrTrackingControllerConfig` and `QrDetectionControllerDeps`.
  - **Migration:** pass the frame from `cameraFrame.onFrame` straight to
    `offerFrame`, and delete the `getCameraPose` option. Code that needs the
    pixels reads `frame.image`. The raw QR records' `timestamp` is now the
    frame's `capturedAtMs` (epoch ms on the depth sampler's clock); the
    tracking controller's `onDetection` timestamp is still the lock time.
  - **Why.** A detection's corners describe the pixels of ONE frame, so the
    pose they are solved against must be that frame's. The old
    `getCameraPose` was read after the asynchronous decode, so the solved QR
    pose trailed the pixels by one decode latency. The session now pairs the
    pose with the pixels at capture, and delivers no frame without a pose.
- **`QrDetectionController` and `QrTrackingController` gained a required
  `isBusy()`** (QR perf plan 2026-09-23, M3): true while a detect is in
  flight - the camera source's capture veto. Callers are unaffected; code that
  IMPLEMENTS or stubs either interface must add it (e.g. `isBusy: () => false`).

### Fixed

- **A recording's track and coverage count device fixes only.**
  `loadGpsPathFromBlob` (the replay preview's track, the Recorder's legacy
  coverage backfill) and `buildSessionMetadataRecord`'s `h3Cells` leave out
  synthetic QR votes and readings with an unknown source stamp (the core's
  `gpsPointSourceOf`). A scanned code's votes sit up to 30 m along its face,
  where nobody walked, so they drew a walk that never happened and put the
  tour on map cells it never touched. `actionCount` still counts every GPS
  sample.
- **`OcclusionMesh` keeps vertex normals on the shared geometry while a
  shadow receiver is attached, in every debug style.** A receiver compiled
  while normals were present drew no shadow after a remesh under the
  `'wireframe'` or `'off'` style (three does not rebuild a program when the
  normal attribute disappears), so AR ball shadows vanished with those
  skins. Without a receiver, `'off'` and `'wireframe'` stay normal-free.
- **`rebindTrackingStore` keeps the host's tracking callbacks alive**
  (`2026-07-11-1811-tracking-rebind-dormant-phase-subscription-followup.md`):
  a mid-session store swap (the recorder's, on every Start Recording) now
  MOVES the phase subscription to the new store instead of only tearing it
  down, so `onLost` / `onRestarted` / `onRecovered` keep firing for the
  rest of the session, and the reference space's reset lands in the current
  store instead of the orphaned one. Apps that rebind get their restart
  handling back mid-session (for the recorder: restart actions recorded,
  alignment re-basing, QR frame resets, loss warnings).

### Added

- **`recordGpsEventBatch` and its `RecordGpsEventBatchPayload` type are
  re-exported** from `gps-plus-slam-app-framework/state` (and the package
  root), beside `recordGpsEvent`: several GPS observations with ONE alignment
  update (`gps-plus-slam-js` 1.26.0; the framework now requires `^1.26.0`).
  The Tour Viewer sends its code votes and each device fix together with its
  keep-alive ring this way.
- **Every reader of a recording handles the batch**, so a fix inside one
  never vanishes. Through the new `utils/gps-event-actions`
  (`recordedGpsEventPayloads(action)`: the GPS payloads of either action, in
  order; `GPS_EVENT_ACTION_TYPES`):
  - replay pacing (`extractActionTimestamp`) paces a batch by its first
    event with a finite time - unpaced, a recording of batches replayed with
    no pauses;
  - the track preview (`loadGpsPathFromBlob`) reads every event of a batch;
  - the tracking-quality listener reacts to a batch like to one fix (one
    solve, at most one snapshot), so a session fed by batches keeps its
    report - and the placement trigger that reads it - moving.
- **`createGpsPositionHandler({ recordFix })`**: an optional router for the
  built fix, called after the session zero is set instead of
  `store.dispatch(recordGpsEvent(payload))`, for an app that records other
  observations with the fix in one solve.

- **Session-spanning recordings: `persistWhile` and `continuousActionIndex`**
  on `createSlamAppStore` (passed through to `createPersistenceMiddleware`,
  which takes them too). `persistWhile: () => boolean` REPLACES the
  `isRecording` gate: an action is persisted exactly when the predicate is
  true after the reducer ran, so the reset dispatched after `endSession` and
  anything dispatched outside a session are written as well.
  `continuousActionIndex: true` stops the action numbering from restarting at
  `startSession`, so a second session no longer overwrites the first one's
  files. Both are optional and off by default; without them the store behaves
  exactly as before. For a recording that outlives the app's sessions (the
  Tour Viewer's troubleshooting recording, one session per AR entry).
- **`createSessionInDirectory(parent, timestamp)`** on
  **`storage/opfs-storage`** (deep import): `createSession`'s folder layout
  (`actions/`, `images/`) and same-second name probe in a parent directory
  the caller owns, instead of the Recorder's `sessions/`. `createSession()` is
  now that call on `sessions/`, unchanged in behaviour. Both apps share one
  origin, so a second app's recordings need a folder of their own.
- **`storage/session-metadata-record`** (deep import, a new subpath):
  `buildSessionMetadataRecord`, `writeSessionMetadata` and `sanitizedPageUrl`,
  the builder of a recording's `session.json` (`odomCoordVersion: 5`, the H3
  coverage, the build stamp), moved here from the RecorderApp so a second
  writer agrees with it on the coordinate era (DEC-H3). The build info is
  injected (`getBuildInfo`, which may throw: that drops only the `build`
  field), and `pageUrl` is left out rather than `undefined` when absent.
- **`utils/build-info`** (deep import): `getBuildInfo()` and `BuildInfo`, the
  reader of the five build constants a Vite `define` block injects, moved
  here from the RecorderApp. The block itself is built by the framework's
  node-only `scripts/build-metadata-define.mjs`, which the RecorderApp and
  the Tour Viewer import from their Vite configs (it is not published).
- **`utils/locate-state`** (deep import, not on the root export surface):
  the behaviour every "my location" button shares, moved here from the OSM
  demo so the globe lab's pin uses the same contract. `LocateState`,
  `labelFor`, `locateAdvice`, `stateForError`, and `locateOnce`, one
  position request that never rejects for anything the browser does (a
  failure resolves as a state; the browser timeout bounds it, so a caller
  that must not wait should make locating cancellable). The OSM demo now
  imports it; its behaviour is unchanged.
- **`ArShadows.mapRenders()`** reports how many shadow-map renders the rig
  has requested, for diagnostics (the PhysicsDemo's status line shows it).
- **`createQrParallaxSizeTally` and `measuredSizeOffer` on `/ar/qr`** (QR
  size consensus plan S3a): one counting rule for parallax sizes (turning
  and refused windows kept out, independent windows apart) and the rule for
  offering a measured printed size in place of a typed one (three
  independent windows past 2 % on one side). `estimateQrSizeFromParallax`
  also reports its window's time span, and caches each view's solve on its
  corners, so re-reads after each detection solve only the new one.
- **`estimateQrSizeFromParallax` on `/ar/qr`** (QR size consensus plan
  2026-09-27-0350, S1): a code's printed size from its views at different
  camera positions - no depth sensor needed. It refuses views that carry no
  scale (standing still, walking straight at the code, a small step, a code
  small on screen). Not yet wired into any app.
- **`utils/debug-flag`** (deep import): `debugUiEnabledFromSearch`, the
  apps' `?debug=1` reader, moved here from the RecorderApp so the
  TourViewer reads the flag by the same rule (QR near-frontal pose plan
  §67 #3).
- **`createFusedPoseTally` on `/ar/qr`** (QR near-frontal pose plan §66):
  the lock counts of one stream of fused QR pose results - stable, each
  `notStableReason`, empty (`unknown`) results, locks with ignored native
  entries, and re-reads (same epoch, equal newest timestamp), which count
  nothing else. The QR demo's `?qrperf` report and the TourViewer's debug
  readout share it.
- **`createFusedQrPoseSource`'s `onEvaluated` receives the code text** as
  a third argument (additive), so an app can keep per-code counts.

- **AR shadows on the reconstructed room** (W4 AR shadows plan
  2026-09-26-0549, M1): `createArShadows({ renderer, light, getOccluder })`
  makes the current `OcclusionMesh` receive virtual shadows automatically
  whenever the renderer's shadow map is on and a light casts (not under
  VSM). It shows a flat fallback plane while there is no mesh, and
  re-renders the map only while casters move. `OcclusionMesh` gains the
  `shadowReceiver` option and `setShadowReceiver`; the occluder itself
  never casts. `createShadowPlane` is the shared shadow-only receiver.
  Without a casting light nothing changes.
- **A custom wave set for the water surface** (programme plan
  2026-09-26-0539, W6): `new WaterSurface({ slopeGlsl })` replaces the six
  built-in waves with a GLSL `waterSlopeAt(vec2 p, float t)`, which the
  look-dev page uses for the water candidates. Each slope compiles to its
  own shader program. GLSL that does not define `waterSlopeAt` throws a
  `RangeError`. The default is unchanged.
- **The QR motion detector** (QR near-frontal pose plan 2026-09-23-2314,
  §26): `measureQrMotion(entries, options?)` and
  `createQrMotionTracker(options?)` on `/ar` tell, per code and
  independently, whether it is being MOVED (the newest view's own position
  against the others') and TURNED (its corner error at the others'
  rotation): `still`, `moving`, `turning` or `moving+turning`, each
  confirmed after 4 consecutive detections, with speeds and the time it
  has been still since. The thresholds are provisional until measured on a
  phone. Also on `/ar`: `viewErrorAtRotationPx`, and
  `QrMultiViewPoseResult.viewPositions` (each view's own position).
  `createFusedQrPoseTracker` runs it by default (`motion: false` switches
  it off) and reports it as `QrFusedPose.motion`: while the code is moved or
  turned the fused pose is `measuring` (the app shows the raw pose), and
  once it is still again only the views since then are fused. Until the
  motion is confirmed the stable pose can trail it for up to 3 detections.
  New option `sinceMs` on `selectFusedWindow` / `evaluateFusedQrPose`.
- **The TourViewer votes and mints with the FUSED QR pose** (QR near-frontal
  pose plan §60-§61, b4b-3) instead of the average of single-frame poses;
  the owner switched without the replay measurement §23 had planned (no
  usable recordings existed). New: `createFusedQrPoseSource` on `/ar/qr`
  (and deep-importable), one fused tracker per code over the entries an app
  reads - the QR demo's former local copy, now shared (DEC-H3). Behaviour
  changes for the TourViewer: after a tracking restart the old frame's
  detections stop counting (the entries are per frame epoch); the 3 cm
  translation-spread gate is gone (position agreement is policed by the
  motion detector); a gap of more than 4 s between two detections starts a
  new window; no vote while the views' fit exceeds 1.5 px (2.25 px to stay
  stable; about 30 % of locks on a wall code in one demo run, plan §32 -
  provisional, it depends on `maxFitPx` and the capture resolution), while
  the views disagree (fallback), while the code moves, or after 1 s of only
  native-order frames; the creator's status line names what the fused
  pose waits for; a code's budget-spent locks are not evaluated; a level
  lookup that finishes after the session ended is dropped.
- **Raw QR records carry the corner-order source** (QR near-frontal pose
  plan §60, b4b-2): `RawQrObservation.orderSource` (the thin producer) and
  `orderSource` on the tracking controller's raw callback; the recorder
  stores it in both modes, so a replay can ignore native-order frames of an
  ordered code. Recordings made before carry none.
- **`dispose()` on the QR controllers and the detection scheduler** (QR
  near-frontal pose plan §61): `createQrTrackingController`,
  `createQrDetectionController` and `createDetectionScheduler` stop for
  good - a decode or level fetch still in flight reaches no callback. Before,
  an AR session ended mid-decode let one late lock record a dead-frame
  detection into the next session and reset status lines, and in the
  recorder's level mode (network fetch, ungated raw-pose votes) cast votes.
  `reset()` cannot do this. The TourViewer and the recorder now call it at
  session end.
- **A QR code's native-order frames no longer reach its fused pose or
  its motion reading once its corner order is known** (QR near-frontal
  pose plan §54-§55). A detection in the detector's own corner order is 90
  or 180 deg wrong whenever the code is rolled past 45 deg in the image;
  six of eight such frames agreed on a STABLE pose 90 deg off, and a run
  of them could read as "turning" on a still code (one frame gives a
  single candidate, never a confirmed turn). `ignoreNativeWhenOrdered` drops the
  `native` entries of the run ending at the newest detection when that run
  holds a `finder` or `memory` one; `selectFusedWindow`, the motion
  detector and the fused tracker apply it. Entries without a source (old
  recordings) and all-native runs are kept. New: `QrFusedEntry.orderSource`,
  `QrDetectionEvent.orderSource` (filled by the tracking controller),
  `QrDetectionEntry.orderSource` (handed on by `selectQrFusedEntries`),
  `QrFusedPose.nativeIgnored`, and `notStableReason` `order`: after 1 s of
  only ignored native frames the stable pose is withdrawn, since the code
  may have moved meanwhile (native frames start where the chain ends -
  typical of a hand-held move).
- **The corner order is chained frame to frame** (QR near-frontal pose
  plan §42): when the finder patterns cannot be read, a detection takes the
  cyclic shift closest in roll to the code's last known order (a finder
  frame or an earlier chained one) instead of the detector's own image
  order, which relabelled the corners - the 90/180 deg pose flips of the
  field tests. The chain ends after a gap over `memoryMs` (500 ms, now the
  max gap between detections, not a lifetime), a roll over `maxRollDeg`
  (30 deg), a centre jump over `maxJumpEdges` (1.5 edges) or a capture-size
  change; on a finder frame that follows a chained one,
  `QrDetection.orderAudit` says whether the chain would have agreed.
  Non-finite or non-positive options fall back to the defaults. `createCornerOrderCanonicalizer` gains those
  options and an injectable `orderFrame`.
- **Where a QR detection's corner order came from** (QR near-frontal pose
  plan §39 F0a): `QrDetection.orderSource` - `finder` (the finder patterns),
  `memory` (the order carried by the chain) or `native` (the
  detector's own order) - and `CornerOrderResult.source`; type
  `CornerOrderSource` on `/ar`. A `CornerOrderer` now returns `{ corners,
source }` instead of the corners alone (unreleased API).
- **The code's size on screen, and why a fused pose is not stable** (QR
  near-frontal pose plan §34 R1): `meanEdgePx(corners)` on `/ar`;
  `QrMotionSignals.newestEdgePx`, `QrFusedPose.edgePx` (the window's median)
  and `QrFusedPose.notStableReason` (`views` | `fit` | `fallback` | `motion`,
  null when stable) - so field tests can judge every pixel threshold
  against the code's size before any threshold becomes size-relative.
- **`selectQrFusedEntries(state, text)`** on `/state` (QR near-frontal pose
  plan, M3b b3): a marker's detections of the current frame epoch as
  fused-window entries, cached per detections array and epoch; raw entries derive their intrinsics from the projection
  matrix. `QrDetectionEntry` gains an optional `intrinsics`.
- **A frame epoch in the `qrDetected` slice** (QR near-frontal pose plan
  2026-09-23-2314, M3b b2): `state.frameEpoch` moves on an odometry
  restart or loop closure that reaches the store (the recorded gpsData
  actions, the session's `tracking/clearLastRestartedPayload`, or the new
  `qrFrameChanged()`; not every app delivers one yet), and
  `recordQrDetection` stamps each entry's `frameEpoch` from it, so the
  fused QR window never combines detections from two coordinate frames.
  `isQrFrameChangeAction(type)` names the actions. Stored entries gain the
  field; state without it reads as epoch 0. `recordQrSizeEstimate` now keeps
  the marker's detections array instead of copying it.
- **The fused QR pose window** (QR near-frontal pose plan 2026-09-23-2314,
  M3b b1): `evaluateFusedQrPose(entries, options?, previous?)`,
  `selectFusedWindow` and `createFusedQrPoseTracker` on `/ar`. The window
  is the newest run of detections in one tracking epoch without a long time
  gap (and, optionally, near the newest raw position; the entries carry a
  `frameEpoch`); its rotation comes
  from the joint multi-view solve, with today's averaging as the fallback
  when the views contradict each other. `stable` needs enough views and a
  good median per-view fit, with hysteresis. The tracker solves once per new
  entries array. Nothing calls it yet (M3b b2-b6); the fit thresholds are
  set from rendered walks and still to be checked against a phone's corner
  noise.
- **The AR scene's lights are named** (AR sun shadow prototype plan
  2026-09-23-2343, M3a): `SCENE_NODE.AMBIENT_LIGHT` and `SCENE_NODE.SUN_LIGHT`
  (the directional light fixed at (0, 10, 5)), set by `createSceneHierarchy`,
  so an app finds them with `getObjectByName` instead of by type.
- **One QR code rotation from several views** (QR near-frontal pose plan
  2026-09-23-2314, M3a): `solveQrPoseMultiView(views, sizeM, options?)` on
  `/ar` solves a static code's world rotation jointly over detections from
  different camera poses, which a single near-frontal frame cannot pin down
  (its tilt, and its mirror flip). Returns the rotation, the mean of the
  views' own positions, the RMS corner error, a tilt uncertainty
  (`tiltSigmaDeg`) and the work done; `null` on unusable input. Pure and
  synchronous; nothing calls it yet (the tracking wiring is M3b). Also
  `realIppeCandidates(H)`: the IPPE candidates that can be the true pose.
- **The shadow-casting sun light** (AR sun shadow prototype plan
  2026-09-23-2343, M2): **`visualization/sun-shadow`** (deep import):
  `createSunShadow({ light })` drives a `DirectionalLight` from the rig and
  re-renders its shadow map only when the rig says so; `enableSunShadows`
  turns shadow maps on before the first frame.
- **The sun-shadow rig** (AR sun shadow prototype plan 2026-09-23-2343,
  M1): **`visualization/sun-shadow-rig`** (deep import), pure: the sun
  light's pose and shadow-camera bounds (`sunShadowPose`), when to re-render
  the map (`shadowNeedsUpdate`), the display opacity for a transmittance
  (`shadowOpacity`) and the elevation floor (`sunShadowActive`).
- **A cloud layer to fly through** (look-dev plan 2026-09-24-1010):
  `SkyAtmosphere.configure({ cloudMode: 'sheet' })` draws the clouds on a
  camera-following disc 2 km up (the same pattern, cover and light as the
  sky's layer, with a sunlit top seen from above), which a camera can fly
  through and look down on; `cloudMode` reads it back. The default
  `'dome'` is unchanged and adds nothing to the scene.
- **The AR sun check** (sun-overlay plan 2026-09-24-0100, M1-M3):
  - **`ar/sun-check-geometry`** (deep import): the sun's direction, the
    sighting error, `alignmentYawDeg`.
  - **`ar/sun-marker`** (deep import): the virtual sun and the reticle.
  - **`ar/sun-check`** (deep import): `startSunCheck`, the controller the
    RecorderApp's debug wheel switches on.
  - **`ar/session-disposers`** (deep import): `registerSessionDisposer`, so
    an app can tie its own UI to the AR session's end.
- **QR capture cadence constants** (QR near-frontal pose plan 2026-09-23-2314,
  M1): `QR_CAPTURE_INTERVAL_CONSTRAINTS` (`{ min: 50, max: 1000, step: 25 }`
  ms) and `DEFAULT_QR_CAPTURE_INTERVAL_MS` (125), on the `ar/qr` barrel and
  **`ar/qr/qr-capture-cadence`** (deep import). The one definition of the QR
  capture interval's default and bounds; the Recorder's settings and the QR
  demo's `?interval=` read them instead of restating them.
- **QR capture-pipeline hooks** (QR perf plan 2026-09-23, M2-M4); the options
  below are optional (the M4 signature change and the new required
  `isBusy()` member are under Breaking changes above):
  - `startCameraFrameCapture({ onCaptureTiming })` reports per-capture
    `CaptureTiming` (`blitReadbackMs`, `flipCopyMs`, size); without it the
    capture path never reads the clock. `CaptureTiming` is exported from `/ar`.
  - `startCameraFrameCapture({ wantsFrame })` and `CameraFrameSource.setWantsFrame`:
    the consumer vetoes captures it would drop (e.g. while its detector is
    busy), skipping the GPU readback without consuming the interval.
  - `CapturedCameraFrame`, `poseFromArPose(arPose)` and
    `capturedCameraFrame(image, arPose, xrTimeMs, timeOriginMs)` (`null`
    without a pose), exported from `/ar` and
    **`ar/captured-camera-frame`** (deep import).
  - `CameraFrameSource<TFrame = RgbaImage>` is generic over what its
    `capture` builds, and `capture` now receives the XR frame `timestamp`.
    Existing `CameraFrameSource` code compiles unchanged (the default is
    `RgbaImage` and a zero-argument `capture` still type-checks).

- **`test-utils/zip-central-directory` resolves for the first time.** The
  `./test-utils/*` export only serves what the build emits, so this
  subpath was advertised but broken - importing it failed. It is now
  built, which also makes `readStoredEntryBytes(bytes, name)` available
  alongside `readStoredCentralDirectory(bytes)`: it returns one stored
  entry's bytes by name, or `undefined` when the archive has no such
  entry, and throws on a deflated entry rather than handing back
  compressed bytes. Test-only; it reads an archive back with a parser
  independent of the library that wrote it.

### Changed

- **The compass cold start is on by default wherever GPS fixes are fed**
  (owner decision D30, 2026-10-02; plan
  `GpsPlusSlamJs_Docs/docs/2026-10-02-1830-compass-cold-start-default-plan.md`).
  `createGpsPositionHandler` now starts the `AbsoluteOrientationSensor`
  watch at the first fix that arrives while recording, so later fixes carry
  `rawAbsoluteOrientation` and the core's cold-start yaw override (default
  on since 2026-07-25) can act. Before, only apps that started the watch
  themselves (the Recorder, OsmDemo) got it; the Tour Viewer,
  MinimalExample and AnchorStarter now do too, with no code change.
  - **No new permission prompt:** off Chrome Android (iOS, Safari, Firefox,
    desktop, headless) it reports `unavailable` before any permission
    query; it never calls `DeviceOrientationEvent.requestPermission`. An app
    that already started the watch is never restarted (new
    `ensureAbsoluteOrientationWatch`).
  - **Opt out** with `absoluteOrientation: 'off'`; observe the default's
    status with `onAbsoluteOrientationStatus`. Any other value throws a
    `TypeError` at creation.
  - **Cost:** one 20 Hz sensor while it runs; the handler never stops it
    (the app's own `stopAbsoluteOrientationWatch()` still does).

- **QR votes carry their provenance** (Tour Viewer authoring plan
  2026-09-28-0953, M2b). Every payload `buildQrGpsVotes` builds is stamped
  `rawGpsPoint.source: GPS_POINT_SOURCE_SYNTHETIC_QR`, the core's provenance
  field (`gps-plus-slam-js` 1.25.0), which the reducer keeps on the stored
  point. Recordings written from now on can tell a vote from a device fix
  (`gpsPointSourceOf`); older recordings read as device, as before. The
  core does not weigh or trim by the stamp. `core` re-exports
  `gpsPointSourceOf`, `GPS_POINT_SOURCE_DEVICE` and
  `GPS_POINT_SOURCE_SYNTHETIC_QR`. The module and its page no longer call
  the votes "very-high-weight": a vote weighs about one GPS fix
  (`1/max(acc, 1 m)^0.1`).

- **The cloud slab reads its thickness at step boundaries and lights each
  step exactly** (clouds-from-above plan 2026-09-26-0549, M1). The layered
  "slices" seen from above at low step counts came from one thickness read
  and one light sample per step. The march now reads the thickness at N + 2
  jittered nodes, finds the part of each segment under the interpolated top
  (a secant step), and integrates the sun's light over it in closed form.
  Steps are spaced uniformly from above and quadratically from below and
  inside. At steep views from above, 8 steps now carry 4-23x less layer bias
  than before; from below and inside, 16 steps stay within 15 % (plus a
  small floor) of their previous error. The default step count is now 8
  (was 16): the owner saw no difference worth the cost on the look-dev page
  (round-2 plan 2026-09-26-2055 M2).
- **`solveQrPoseMultiView` drops unusable views instead of failing**
  (QR near-frontal pose plan 2026-09-23-2314, §16 #7): a view with a
  mirrored or non-finite quad, bad intrinsics, a non-unit camera quaternion
  or no single-frame solve is left out and counted in the new
  `droppedViews`; `null` only when no usable view is left. The result also
  gains `viewRmsPx`, each used view's own corner error.
- **QR corners now come out in SYMBOL order (TL, TR, BR, BL of the printed
  code)** (QR near-frontal pose plan 2026-09-23-2314, M1c).
  `BarcodeDetectorFrontEnd` reorders the native detector's corners from the
  image's finder patterns (`ar/qr/qr-corner-order`); the native detector on
  Android reported IMAGE order, which turned every solved pose by 90 or 180
  deg whenever the code was seen sideways or upside down. When the image
  cannot tell, the code's chained order (see "The corner order is chained
  frame to frame") or the detector's order is kept. A third, optional constructor argument
  (`orderCorners`, type `CornerOrderer`) replaces the rule.
  Recordings made before this change keep their native-order corners, and
  replay re-solves them unchanged. A cross-scan through each candidate
  finder's core (as zxing does) keeps the alignment pattern near BR from
  passing for a finder on some codes (milestone review 2026-09-24).
- **`BarcodeDetectorFrontEnd`'s default conversion no longer copies the
  frame** when it can be adopted (plain-`ArrayBuffer`-backed pixels), saving
  one full-frame copy per decode.

- **`downloadZip` resolves a boolean**: `true` when a download or save was
  started, `false` when the user dismissed the save picker (nothing was
  written; that path used to resolve silently). Callers awaiting `void`
  are unaffected.
- **`OpenedArchive.evict()` no longer waits for an in-flight warm
  download - it aborts it.** The session keeps streaming remotely, a
  recovery download is still awaited (it serves a live read), and the
  evicted latch still guarantees nothing repersists after the call. Before,
  a caller clearing the cache while a tens-of-MB warm was running waited
  for the whole download (the Tour Viewer's "Clear cache" sat at
  "Clearing…" for minutes on a phone). Callers that did
  `dispose(); await warmed; await evict()` can drop the middle step.
- **`BoundedLocalCacheStore.clear()` resolves the number of index entries
  it removed** (was `void`; awaiting callers are unaffected), and a new
  **`size()`** reports the index length - read it BEFORE evicting an open
  session's copy when the number feeds a "cleared N" message, because
  `delete`/`evict` drop that entry from the index first.
- **Opening a remote archive on `@zip.js/zip.js` 2.9 or newer costs one
  read of up to 64 KB** (the library now fetches its whole
  end-of-central-directory search window at once instead of a 22-byte
  probe; measured 2026-09-07 against 2.11.2). Entry reads are unchanged
  (three range requests per entry). The framework's peer range (`>=2.7.0`)
  is unchanged; the request-budget test now sizes its archive so this
  fixed cost is the small fraction it is on a real recording. One more
  consequence for CONSUMERS' TESTS: zip.js 2.9+ reads a `BlobReader`'s
  source through `blob.stream()`, which jsdom's `Blob` lacks — a jsdom test
  that pushes a Blob through the zip export needs a `Blob.prototype.stream`
  polyfill in its setup (the recorder's `src/test-setup.ts` is one).
- **`WayfindingHud` gained a REQUIRED member, `entranceStats()`.** Code
  that builds a `WayfindingHud`-typed object by hand — test doubles, mostly
  — must add `entranceStats: () => ({ redraws: 0, drawMs: 0, animating: 0,
entranceMs: 0, peakDrawMs: 0 })` to compile; a consumer that only calls
  the handle is unaffected.

### Added

- **`rgbaImageToJpegBlob(frame, quality)`** on `/ar` (and
  **`ar/camera-blit-capture`** (deep import)): the RGBA (top-left origin)
  → JPEG encoder `CameraBlitCapture` always used, exported so an app can
  encode a camera frame it already holds (the Tour Viewer's placed
  photos) without a second copy of the canvas dance; OffscreenCanvas where
  available. A data length that is not `width * height * 4` rejects.
- **Store-mode zip writing from in-memory entries, and rebuilding an
  existing zip** (`/storage`; the modules are **`storage/pack-files-as-zip`** (deep import), **`storage/zip-rebuild`** (deep import) and **`storage/zip-entry-path`** (deep import)):
  **`packFilesAsZip(entries)`** writes `{ path, data: Blob | Uint8Array |
string }` entries uncompressed so a range reader can slice them out
  (an empty list is a valid empty archive); **`rebuildZipWithEntries(zip,
entries, { onProgress? })`** re-emits an existing archive with entries
  added or replaced by path, keeping every other entry byte-identical, and
  THROWS (`ZipPackagingError`) rather than returning the input on failure;
  **`assertSafeZipEntryPaths(paths)`** is the one path rule set every
  writer applies (empty, absolute, drive-lettered, backslash, `.`, `..`,
  empty segment, trailing slash, duplicate). Absorbed from community PR
  #321 and hardened per its review; `exportSessionHandleAsZip`'s composed
  contributor paths (`subdir/relativePath`) now go through the same
  validator (a trailing slash, an empty segment, a drive-lettered or
  backslashed subdir is rejected where it was silently accepted), and
  `embedCoverageInSessionJson` is a wrapper over the rebuild. The rebuild
  re-emits an opened archive's existing entries AS THEY ARE (a duplicate
  name collapses to its last occurrence) and reads them as Blobs, so a
  phone-sized recorder zip is not copied onto the JS heap; only the new
  entries are validated. Also on `/storage`: `writeStoreZip(entries,
caller)` (the writer without validation, for callers that validated)
  and `assertWritableZipEntries(entries, caller)`.
- **`tour.json` - the tour manifest** (`/ar`; **`ar/tour-manifest`** (deep import) and **`ar/tour-archive`** (deep import)): `parseTourManifest`,
  `serializeTourManifest`, `createEmptyTourManifest`; objects are text
  `pin`s and captured `photo`s, each with an exact geo pose (lat, lon,
  absolute altitude, rotation against north) minted like a printed code's;
  `TOUR_MANIFEST_ENTRY`, `TOUR_CONTENT_FOLDER`, `TOUR_MANIFEST_VERSION`,
  `tourContentEntryName(id, ext)` (`content/<id>.<ext>`; a photo's
  `image` must be that name for its own id), `tourManifestEntryOf`,
  `readTourManifestFromEntries(names, readText, parse)` (null for no
  manifest; a broken manifest REJECTS), `TourManifestValidationError`;
  `TourObject` is the union `TourPin | TourPhoto`. The geo-pose validator
  (`HEADING_CONSISTENCY_TOLERANCE_DEG` now public) moved from
  `qr-level.ts` into **`ar/qr/geo-pose`** (deep import) - `parseGeoPose(value, { path,
fail })` - so the level and the manifest share one rule set;
  level messages are unchanged.
- **`circleEntrance` on `createWayfindingHud`** (opt-in): the circle indicator is the design system's diamond building itself up — the outline drawn over 800 ms, the accent dot popping at 600–850 ms, the sheet's `--ease-out` — each time a target appears or comes back through the distance gate (a head turn does not restart it). Drawn per target into a canvas texture with a 30 Hz redraw cap and a 60 ms stagger for simultaneous spawns; reduced motion (the OS setting, or `reducedMotion: true`) shows the finished marker at once. Mutually exclusive with `circleSprite`; meant alongside `arrowSprite`. `WayfindingHud.entranceStats()` reports the last frame's redraws, their wall-clock cost, how many entrances still animate, and the costliest entrance's accumulated and peak draw milliseconds — the on-device cost readout (the accumulated figure clears the browser clock's 100 µs floor where a single frame does not). The building blocks are public on `/visualization` (`computeDiamondEntrance`, `DIAMOND_ENTRANCE`, `createDiamondMarkerTexture`, `DIAMOND_GEOMETRY`) and **`utils/cubic-bezier-easing`** (deep import) — evaluates CSS `cubic-bezier()` timing functions exactly.

## [1.24.0] — 2026-09-05

Requires `gps-plus-slam-js` ≥ 1.24.0.

### ⚠️ Breaking changes

- **The solver's option family is named `consensusSolver*` everywhere**,
  aligned with `gps-plus-slam-js` 1.24.0: `createSlamAppStore({
enableConsensusSolverComparison })`, the re-exported actions
  `setConsensusSolverComparisonEnabled` and
  `setConsensusSolverHeadingPenalty`, the `gpsData` state field
  `consensusSolverComparisonEnabled`, and the `AlignmentOverrides` key
  `consensusSolverEnabled`. The previous names are gone rather than aliased;
  TypeScript consumers get a compile error, a JavaScript consumer passing the
  old override key gets `setAlignmentOverrides`' thrown `unknown key`.
  **Recordings are not migrated:** the two store actions are persisted by
  type string, so a recording made before this release with the comparison
  arm or the heading penalty set replays those actions as ignored and runs
  the default solver configuration.

- **Removed from `/ar/qr`** (`createQrDetectionScheduler`,
  `QrDetectionScheduler`, `QrDetectionSchedulerConfig`): the QR-specialised
  aliases over `createDetectionScheduler<T>`. Nothing but their own tests used
  them; instantiate the generic with `TResult = QrPoseSolution`.
- **Removed from `GpsAnchorOptions`** (`floorY`, `angleThresholdInDegrees`,
  `heightAboveGround`): accepted since the port, never read by the anchor.
  Drop them from your options object; behaviour is unchanged because they
  never had any.
- **`state/app-selectors`** (`selectAlignmentMatrix`, `selectGpsPositions`,
  `selectOdometryPositions`, `selectOdometryRotations`, `selectZeroReference`)
  are plain functions rather than `createSelector` outputs. Returned values
  and reference stability are unchanged; the reselect surface (`.resultFunc`,
  `.recomputations()`, `.clearCache()`, extra selector arguments) is gone.

### Changed

- **The wayfinding HUD's procedural cone and ring wear the design system's
  accent** (`#f2971f`) instead of the prototype's red `0xff3b30`, and the ring
  is a third as wide (0.0133 at `indicatorScale` 1, outer radius unchanged at
  0.12). Pass `indicatorColor` to keep another tint.
- **URL-loaded `arrowSprite` / `circleSprite` textures are tagged
  `SRGBColorSpace`.** They were sampled as linear and rendered lighter than
  the image file; a caller-passed `THREE.Texture` keeps its own colour space.
- **`lerpAngleDeg`** now returns `+180` where it returned `−180` for two
  angles exactly 180° apart, because it is built on the shared
  `bearingDeltaDeg` (`utils/bearing-degrees`). Both are shortest arcs; only the
  turning direction at that single boundary changes.

### Added

- **`createWayfindingHud({ indicatorColor })`** — tint of the procedural
  indicators (`THREE.ColorRepresentation`; the shape is validated and `null`
  rejected, a string's content is passed to `THREE.Color` unchecked), also
  exposed as `DEFAULT_WAYFINDING_HUD.indicatorColor`. Inert in image mode.
- **`utils/bearing-degrees`** gains `bearingDeltaDeg(a, b)` — the signed
  shortest difference in `(−180, 180]`, replacing two unnamed copies.
- **`utils/median`** (deep import) — now a built entry.
- **`visualization/wayfinding-targets`** (deep import) — `createTargetResolver`,
  the wayfinding HUD's boundary validation as a pure, directly tested module;
  `WayfindingTarget` is re-exported unchanged by `wayfinding-hud`.

- **`utils/compass-influence-mapping`** (deep import) — the "influence 0..1 →
  seven compass settings" contract, moved out of the OSM demo so any app with
  a compass-influence slider shares one definition of "influence 0 is GPS
  only" (three settings, not one). `experiments` is a required parameter and
  no defaults are exported: the demo's `ramp` gate and 15° tolerance stay the
  demo's decisions.
- **State re-exports for core 1.23.0**: `setAlignmentOverrides`,
  `setCompassPairSelectionMode`, `setCompassPairSelectionRequireTrust`,
  `setConsensusSolverHeadingPenalty`, the consts `ALIGNMENT_OVERRIDE_KEYS`,
  `COMPASS_TRUST_GATE_MODES`, `COMPASS_PAIR_SELECTION_MODES`, and the types
  `AlignmentOverrides`, `CompassPairSelectionMode`. Derive dropdown lists from
  the consts rather than mirroring the unions — the fourth trust-gate mode,
  `latch`, is the reason.

## [1.22.0] — 2026-09-01

Requires `gps-plus-slam-js` ≥ 1.22.0.

> ⚠️ **This MINOR carries breaking type changes.** It is numbered 1.22.0 rather
> than 2.0.0 to keep one version number across both packages —
> `gps-plus-slam-js@1.22.0` made the same call for the same change (owner
> decision, 2026-09-01). The cost is stated plainly: a consumer on `^1.x` gets
> these changes with no version-level warning. **Pin `1.20.0`** if you need the
> old types. There is no 1.21.0; the framework goes 1.20.0 → 1.22.0 so the two
> packages carry the same number.

### ⚠️ Breaking changes

- **Device orientation can now say "nothing was reported"** —
  `DeviceOrientation.alpha` / `.beta` / `.gamma` are `number | null`, and
  `PoseReceivedPayload.sensorOrientation` is `DeviceOrientation | null`.
  Consumers that read these angles must handle `null`.
  - **Why:** `snapshotDeviceOrientation` used to substitute `0` for every
    absent axis, and `0` is a legal reading meaning "facing north, flat and
    level" — so nothing downstream could tell "no compass" from "pointing
    north". The value is not diagnostic: it reaches
    `calcRotationOffsetFromRestart` in the core library, the rotation
    correction applied to the world after a tracking restart.
  - **What was actually damaged:** two fabricated readings cancel each other in
    `newSensor · inv(lastSensor)`, so a device with no magnetometer was never
    harmed. The MIXED case was — compass availability changing between the last
    valid pose and the restart, so one snapshot carried a real heading and the
    other a fabricated zero, and a whole absolute heading was applied as though
    the device had turned by it.
  - The tracking slice's restart payload now **omits** an absent orientation
    instead of zeroing it, so the core's `resolveSensorPair` can refuse a
    half-real pair rather than trusting it. The `?? sensorOrientation`
    back-fill — which copied the new reading into the old slot — is gone: its
    effect was benign (equal sides cancel) but it wrote a fiction into the
    recording to get there.
  - Per-axis nulls are preserved rather than collapsed to a single null: a
    phone with no magnetometer reports a null `alpha` beside real
    `beta`/`gamma`, and the library pairs the axes individually so tilt still
    corrects while heading cancels.
- **`replayRecording`'s first parameter widened** from `Uint8Array` to
  `ZipSource`, and it takes an optional `ReplayRecordingOptions` second
  argument (abort seam included). Passing a `Uint8Array` still works.
- **`QrRawDetection` is no longer a named export.** It appears in an exported
  callback signature, so consumers still reach it by inference; only the
  `import type { QrRawDetection }` form breaks.

### Features

- **QR anchor authoring and tracking pipeline** — a printed code can now be
  minted into a geo-anchor from a whole recording, and recognized at runtime.
  All deep-importable under `ar/qr/*` and `utils/qr-payload/*`:
  - `qr-code-id` / `qr-code-origin` — code identity and the "is this ours"
    safety gate, plus the `qr/<id>.json` level convention.
  - `qr-level` / `qr-level-archive` — level parsing and archive lookup, with
    widened mint quality.
  - `qr-sighting-accumulator` — folds per-frame detections into sightings.
  - `qr-anchor-mint` / `qr-mint-level` — assemble a mint level from a recording.
  - `qr-vote-budget` — bounds how much a single session may vote.
  - `qr-launch-dispatch` / `qr-print-plan` — `?qr=` launch handling and print
    layout planning.
  - Every one of them is a **per-file dist entry**, deep-importable through the
    `./ar/*` and `./utils/*` wildcards, so an app can wire the pipeline without
    pulling the whole `/ar/qr` barrel into node unit tests.
- **Capture-time geo join and replay** —
  - `replayActions` is now exported from `state`: replay a pre-loaded action
    list without going through a zip.
  - `state/segmenting-actions` names the actions that segment a recording
    (`SEGMENTING_ACTION_TYPES`, `isSegmentingActionType`).
- **Google Drive tours through the CORS proxy** — share-link normalization,
  range-probe and remote byte-source hardening, with `410 Gone` no longer
  conflated with the two other conditions it had been folded into.
- **Shared helpers unified (DEC-H3)** — `utils/median` (the weighted-median
  family) and the new `utils/bearing-degrees` replace copies that had drifted
  apart; see the fixes below for what the drift had cost.

### Bug Fixes

- **`weightedMedian` did not honour the tie convention it documented.** On an
  exact half-weight tie the lower of the two straddling values should win;
  `total` sums every weight while `cumulative` sums a prefix, so the two
  accumulate rounding differently and an exact tie could miss by a ULP. Found
  by property tests on their first run.
- **`recencyHalfLifeS` was divided by unguarded.** It is caller-supplied public
  API. Zero gives the newest sighting `1/(1 + 0/0)` = `NaN` and every older one
  `0`; a negative value can give `Infinity` or a negative weight.
  `weightedMedian` drops all of those and falls back to the _unweighted_
  median — so the weighting silently did not run.
- **`computeCaptureSize` handed `NaN` straight to render-target allocation.**
  `cameraWidth <= 0` is false for `NaN`, so `NaN` flowed through `Math.floor`
  and survived `Math.max(1, NaN)`; `(Infinity, 1080, 1)` produced an infinite
  edge. Both reached `new THREE.WebGLRenderTarget(...)`.
- **A disposal raced its own flag.** The deadline race's loser was disposed
  using a flag set inside the `catch`, at least two microtasks after the gate
  rejects, while the disposal handler is registered first — so an open settling
  inside that window was disposed by neither path. That is the leak the block
  was added to close.
- **Two runtime validator lists only _looked_ type-checked.** TypeScript accepts
  an incomplete array literal for `readonly T[]`, so a list missing a union
  member compiles cleanly — and both lists were runtime validators, meaning a
  legitimate value was rejected in production. `BLUR_METRIC_IDS` is now the
  source of truth and `BlurMetricId` is derived from it.
- **Six unnamed bearing normalizers**, `((deg % 360) + 360) % 360` written out
  in six files, one of which had received a fix the others never did. Now one
  named `utils/bearing-degrees`.
- Plus the accumulated fixes from PR reviews #369–#391 across the AR, storage,
  replay and visualization modules.

## [1.20.0] — 2026-08-26

Requires `gps-plus-slam-js` ≥ 1.20 (the `resetGpsSessionData` carrier).

### Features

- **Range-based zip streaming transport** (`storage` subpath) — open a
  cloud-hosted archive without downloading it whole: `openRemoteArchive` runs
  share-link normalization (Dropbox/GitHub/Google Drive/OneDrive →
  raw-download URLs) → a revalidated cache lookup (ETag / Last-Modified /
  size) → an HTTP range probe with a pure fallback policy (206 ranges, 200
  eager-local, full-download degrade, typed rejections) → the right
  `ByteSource`, plus a background warm-download that switches a live session
  onto a local copy exactly once and persists it via the Cache API only when
  the switch took (size-mismatch poison guard). Includes
  `BoundedLocalCacheStore` (LRU cap + `clear()`), `ByteSourceReader` (zip.js
  adapter with EOF clamping), a per-read instrumentation seam (`onRead`), and
  `StructuralReadError`'s permanent-vs-transient failure split. Originates
  from community PR #322 (thanks @superhellth), hardened with strict 206 +
  body-length validation, safe-integer size parsing, UTF-8 share-link
  tokens, and a measured request-budget test. The `utils/qr-payload`
  launch-URL codec (`buildQrLaunchUrl`, `decodeDictionaryPayload`) is now
  deep-importable for `?qr=` launch handlers.
- **`teardownArSessionState` (`state/ar-session-teardown`)** — the shared
  AR session-end STATE teardown (close the recording, drop the session's
  odometry↔GPS pairs via the core's `resetGpsSessionData` while keeping
  the zero, clear the coordinator cache). Unified from three identical
  app sequences (DEC-H3); requires gps-plus-slam-js ≥ 1.20.
- **`decodeFrameTexture` promoted from the recorder** —
  `visualization/frame-texture-decoder` decodes an image Blob into an
  UPRIGHT `THREE.Texture` (the ImageBitmap orientation contract: browsers
  ignore three's `flipY` for bitmap uploads, so the decoder pre-flips),
  with an optional downscale divisor. Shared so consumer apps don't copy
  the orientation contract.
- **QR-pose authoring surface deep-importable** — `ar/qr/qr-level`,
  `ar/qr/qr-gps-vote` and `ar/qr/qr-tracking-controller` are now per-file
  dist entries (alongside `ar/qr/qr-geo-pose-minting`), so a consumer app
  can wire the QR tracking pipeline without pulling the whole `/ar/qr`
  barrel into node unit tests.

> **The ten entries below were RECONSTRUCTED on 2026-09-11**, from the
> commits between each version's bump, and they read differently from the
> entries around them on purpose. The ones written at release time say what
> a release was FOR; these say what changed, because that is all the record
> still holds. Where a release's externally visible surface is genuinely
> unclear from its commits, the entry says so rather than inventing a
> summary.
>
> **Which versions exist here is not a judgement call**: the list comes from
> the registry, so every version below was really published and every
> version absent from this file was never published. That closes the gap
> between 1.3.0 and 1.20.0 - ten releases, roughly two months, documented
> for the first time.

## [1.19.0] — 2026-08-24

The largest of the backfilled releases: 82 framework commits over nine
weeks, and the one where several helpers stopped existing three times over.

### Features

- **Production elevation-offset estimator** — a slew-limited median with a
  freeze layer, alongside a corpus-validated floor estimator with a plane
  fit and a confidence model.
- **A log-only diagnostics action**, so a measurement survives the session
  that took it.

### Changed

- **One implementation each for helpers that had several.** `escapeHtml`
  became the workspace's single escaper; `clamp01` became one per package
  and `smoothstep` one in the OSM demo; the distance formatter became one
  formatter with three call-site rules. A consumer that imported any of
  these from a second location will have to move to the surviving one.
- **The toast mechanism moved out of the OSM demo** and into the framework.
- **The occlusion mesh takes one `mode` field**, replacing a boolean and a
  mode that could disagree.

## [1.14.0] — 2026-07-19

### Features

- **`compassVoteWeight` store option** — the carrier for a vote-weight
  control. Dispatched once `gpsData` exists; absent means the library
  default, so existing consumers are unaffected.
- **`enableCompassExperiment` and `enableRansacComparison` store opt-ins.**

## [1.13.0] — 2026-07-18

### Features

- **`startHitTestReticle`** — a shared hit-test reticle driver, so an app
  placing content on surfaces no longer writes its own.
- **The wayfinding HUD** — `createWayfindingHud` plus the placement seam
  ported from the HUD prototype, with an explicit-tick mode for callers
  that drive their own frame loop, and frame-rate-independent damping of
  the circle.
- **The Stats.js performance overlay** was promoted into the framework.

### Performance

- **The occluder re-mesh worker gained a fast path** (about 69 % off the
  smooth re-mesh), and the carve walk was fused into the occupancy grid
  (fold time down about 31 %).

## [1.11.0] — 2026-07-12

**This release removes exports.** It is the one version in the backfilled
range where an upgrade can fail to compile, and the commits are marked
breaking in the history.

### Removed / Changed

- **The webxr-session callback injectors folded into `initAR` options**,
  and the session injection exports were deleted - replay owns its scene.
- **The recorder settings catalog moved into the recorder app**, out of the
  framework.
- **The dead legacy single-tile `MapOverlay` was deleted**, along with
  zero-consumer `webxr-session` exports.
- **The QR cluster split into `ar/qr/`**, the first step of the `ar/`
  restructure - import paths for QR modules changed.

### Features

- **`flushPendingWrites`** — a drain hook the stop flow awaits before
  actions and readers run, so a recording's writes are on disk before
  anything reads them.
- **An FFT high-frequency-energy metric** for image quality, with a
  blur-metric selector.

## [1.10.0] — 2026-07-11

### Features

- **A built-in object-pose bootstrap source for `createGpsAnchor`.**
- **`initAR` applies the Chromium tab-crash workaround by default.**

### Changed

- Internal tightening from a quality review: depth acquisition became lazy
  behind the sample-interval gate, the live-map snapshot rebuild is
  memoized on input references, `app-selectors` is typed against the
  `gpsData` slice only, and zip export consumes the OPFS layout owner's
  sessions handle.

## [1.9.1] — 2026-07-10

A packaging-only release: pnpm 11 configuration, `engines.node >= 22.14.0`,
and a 24-hour minimum release age. No source changes.

## [1.9.0] — 2026-07-09

### Features

- **QR launch-URL payload codecs** — candidates A2-A5 with total decoders,
  then pruned to the measured-best, with `buildQrLaunchUrl` as the helper a
  consumer calls.
- **`loopClosureDebug` recording option**, and a core re-export of
  `createLoopClosureHandler`.
- **`ZipSource` supports lazy loading** through a Reader integration.
- **The live map follows the fused pose**, not the raw GPS fix, and
  auto-centres on the blue dot.

## [1.8.0] — 2026-07-04

### Features

- **A session-end hook plus full teardown** when the system ends an
  `XRSession` - the case an app cannot observe on its own.
- **The AR far plane rises to 200 m**, via exported `AR_CAMERA_*` frustum
  constants a consumer can read rather than guess.

### Fixed

- The CSS3D minimap plane was re-fitted so it clears the viewer plane at
  map-viewing pitches for every yaw.
- Packed-cell keys were consolidated into one implementation, and every
  key-touching path guarded against aliasing outside the ±65535 envelope.
- `createSlamAppStore` now rejects `extraReducers` keys that collide with
  framework-reserved slices, rather than letting one silently win.

## [1.7.0] — 2026-06-28

### Features

- **The Phase-4 Stage-0 cold-start compass override is on by default.**

### Removed

- **The inert `computeCompassAgreement` and its first-agreement subsystem.**
- **The dead legacy `rawDeviceOrientation` / `compassAbsolute` fields** are
  no longer written on GPS events.

### Fixed

- A corrupt alignment matrix scores as a failure rather than as perfectly
  stable, and a non-finite `matrixDelta` can no longer make the score NaN.

## [1.4.0] — 2026-06-21

### Changed

- **Scenario layout became recorder-owned.** Scenario logic was deleted from
  framework storage and the scenario-aware zip export moved to the recorder,
  leaving a generic primitive behind. A consumer relying on the framework's
  scenario handling has to move to the recorder's.
- **`SessionMetadata.scenarioName` was renamed to `contextTag`**, with a
  replay fallback so existing recordings still load.

### Features

- **A frame-tile display-resolution slider** in settings, and a setup order
  that asks for permissions first and GPS last.

### Fixed

- Several error paths were isolated so one throwing step cannot strand a
  session or corrupt a lock state machine, and the QR-derived-pose fold
  cursor advances only past observations that were actually folded.

## [1.3.0] — 2026-06-13

### Features

- **Captured-image pixel dimensions for aspect-correct frame tiles** — the image-capture pipeline now surfaces each captured frame's encoded pixel size. `CameraBlitCapture` exposes `getWidth()`/`getHeight()` (the render-target size, which equals the encoded JPEG size); the `captureFrame` callback returns a `CapturedFrame` (`{ blob, width, height }`) instead of a bare `Blob`; `ImageCaptureManager` attaches `width`/`height` to `CapturedImage` (blit render-target size, or canvas backing-store size on the `toBlob` fallback) when positive; and `selectFrameTilesInWebXR` projects the new `width`/`height` fields (exhaustiveness guard extended). These flow into `ArImageCapture.width`/`height` so consumers (e.g. the recorder's 3D frame-tile visualizer) can render frames at their true aspect ratio. Requires `gps-plus-slam-js` ≥ 1.3.0 (the schema carrier). Old recordings and captures without dimensions are unaffected (consumers fall back to square).

## [1.2.0] — 2026-06-13

### Features

- **Depth → occupancy-grid mapping** — ported the Unity occupancy-grid core (`bresenham3d` ray-carving + `OccupancyGrid`) into the framework, added a `depth-unprojection` helper (screen + depth → raw WebXR point), captured each `XRView` `projectionMatrix` in depth samples (with a denser default grid), stored `latestDepthSample`, and wired the occupancy grid into the recorder store. `DepthCaptureOptions` now plumb depth recording options through the sampler without dropping `projectionMatrix`.
- **RGB voxel coloring (occupancy-grid port Iter 8)** — `DepthPoint` gains an optional, additive `rgb: [r, g, b]` (0–255) sampled from the camera frame in the same XR frame as the depth read; `DepthSampler` gains a `rgb` config (default true) + lazy `acquireRgbLookup` callback (at most one small GPU blit+readback per emitted sample via the new `CameraBlitCapture.captureToPixels()` and the pure `ar/depth-rgb-lookup`); `OccupancyGrid.getCellColor()` exposes a per-cell running average of the colored observations; `DepthCaptureOptions.rgb` recording option (default on). Old recordings and rgb-off sessions are unaffected (consumers fall back to height-based coloring).

### Bug Fixes

- Cap `bresenham3d` trace span to prevent a main-thread freeze on long rays
- Reject non-negative-integer `stopDistance` in `bresenham3d`
- Clarify `OccupancyGrid.addSample` behavior and ensure point-order independence in carving
- Correct `WEBXR_TO_NUE` imports to the correct subpath and add the missing entry file
- Close recorder payload field-drop seams (audit F2/F3/F4)

### Refactoring

- Make `DepthSample.points` readonly to enforce the no-mutation invariant
- Hoist the projection inverse + camera quaternion to a sample-scoped `DepthUnprojector`
- Pass `projectionMatrix` straight to `mat4.invert` in depth-unprojection

## [1.1.0] — 2026-06-08

### Features

- **ArWorldGroupAlignment** — `enableArWorldGroupAlignment()` applies lerped GPS→AR alignment on `arWorldGroup`, replacing per-anchor lerps with a single group-level correction
- **AR re-entry** — `enable()` now exposes `disable()` teardown with a `stopping` state, allowing clean AR session restart without stale state
- **`onBootstrapComplete` callback** — `createGpsAnchor` accepts an optional callback fired once the anchor's world-pose bootstraps
- **Hit-test reticle** — promoted from consumer apps into the framework as a first-class visualization primitive
- **Headless Enable GPS AR seam** — `enable-gps-ar` module provides a headless entry point for starting AR+GPS without UI
- **`registerXrFrameUpdate`** — new seam for per-frame XR callbacks + `requestHitTest` opt-in
- **Capability checker** — promoted to `ar/` with `contextLabel` for richer diagnostics
- **Onboarding-guidance coaching** — coaching seam over tracking-quality for consumer UIs
- **GPS-anchor guard** — `createGpsAnchor` now validates that the target `Object3D` is a descendant of `arWorldGroup`
- **Smooth steady-state corrections** — GPS-anchor corrections default to smooth interpolation
- **Chromium camera-access workaround** — version-gated `baseLayer` persistence for affected Chrome builds

### Bug Fixes

- Guard `refreshSupport` against clobbering active `starting`/`running` AR state with a stale probe
- Correct on-screen GPS-anchor hard-jump by removing the large-jump bypass
- Apply `WEBXR_TO_NUE` basis change to hit-test pose so the reticle stays centred
- Keep hit-test reticle pinned at screen centre under aligned `arWorldGroup`
- Start sensor watches only after `initAR` resolves in `enable-gps-ar`
- Isolate throwing listeners in `enable-gps-ar` `setState` dispatch
- Make orientation permission probe truly non-blocking in `enable()`
- Harden `updateRenderState` patch against `null` and explicit `undefined` baseLayer
- Isolate throwing per-frame callbacks so one bug cannot kill the render loop
- Isolate WebXR `baseLayer` persistence per `XRSession` via `WeakMap`
- Nest HUD overlays inside the `initAR` container
- Widen baseLayer patch window to all of Chrome 148 + add bootstrap diagnostics
- Publish `visualization` subpath artifacts in tsdown `entryFiles`

### Refactoring

- Tie `ArWorldGroupAlignment` disposal to the XR session lifecycle
- Remove D1 per-anchor lerp — steady-state corrections now snap instantly at the group level
- Derive recording action types from action creators in persistence middleware

### Documentation

- Update scene-graph docs: anchors ride lerped `arWorldGroup` alignment
- Cross-link trivial → starter → full example ladder
