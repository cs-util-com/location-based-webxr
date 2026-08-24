# Changelog

## [Unreleased]

> **Entries for 1.4.0 through 1.19.0 were backfilled on 2026-08-24**, months
> after the fact, from commit history - the file had been unmaintained since
> 1.3.0. They are accurate about what changed but less complete than a
> contemporaneous entry would be; the per-release "What's Changed" lists on the
> GitHub Releases are the raw record. Versions absent below (1.5.0, 1.6.0,
> 1.12.0, 1.15.0-1.18.0) were bumped but never published, so no consumer can
> install them; their contents appear under the next published version.

## [1.19.0] - 2026-08-24

Requires `gps-plus-slam-js` >= 1.19.0.

Versions 1.15.0 through 1.18.0 were bumped in the manifest but never published;
everything they contained reaches consumers here.

### Features

- **Elevation and floor estimation** - a production elevation-offset estimator
  (slew-limited median with a freeze layer) and a corpus-validated floor
  estimator with plane fit and a confidence model.
- **OPFS-backed `OsmBlobStore`**, under a new `osm-bridge` subpath export.
- **A log-only diagnostics action**, so measurements taken during a session
  survive it. Adds a framework-reserved `diagnostics` state slice.
- **Consumer-owned devtools state summaries** - a consumer can now summarise
  its own slices for devtools rather than relying on the framework's view.
- **Consumer-supplied dev-check exemptions**, so an app can opt individual
  checks out without forking the store wiring.
- **A shared toast mechanism** (`utils/toast-core`), owning the element, the
  ARIA contract, the timer and replace-and-restart semantics, with per-message
  class and linger overrides. Placement and lifetime stay with the caller.
- **A shared ground picker** with CPU, GPU and no-ground modes.
- **One `escapeHtml` and one distance formatter** for the whole workspace,
  replacing per-package copies.

### Bug Fixes

- Image-quality filtering is now enabled by default, with thresholds tuned
  against the benchmark corpus.
- `formatDistance` honours a fractional `metreStep`, and decimal options are
  clamped into `toFixed`'s valid domain instead of throwing.
- The toast is emptied on replace, and its live region is no longer torn out of
  the accessibility tree and re-inserted on every message.
- The `diagnostics` slice name is reserved in the `extraReducers` collision
  check, and its `atMs` is pinned to epoch milliseconds so replay paces by it.
- Signed zero is normalised in the OSM view position.

### Refactoring

- `OcclusionMesh` carries one mode field rather than a boolean and a mode.
- Failure trackers became config-only presets.
- Hand-rolled callback sets route through a shared snapshot-and-isolate
  registry.

## [1.14.0] - 2026-07-19

### Features

- **`compassVoteWeight` store option** - carries the vote-weight setting to the
  library, dispatched once `gpsData` exists. Absent means the library default.

## [1.13.0] - 2026-07-19

### Features

- **Wayfinding HUD** - `createWayfindingHud` presenter, an explicit-tick mode
  for deterministic driving, and a placement seam ported from the HUD
  prototype.
- **`startHitTestReticle`** - a shared hit-test reticle driver.
- **`startReplaySession`** - a desktop-replay composer.
- **Engine-free pointer-picking raycast helper**, plus `OcclusionMesh.getMesh`.
- **Occupancy cube visualizer** promoted from the recorder, with live
  `setVisible` for mesh-view toggling.
- **Stats.js performance overlay** promoted into the framework.
- **`enableCompassExperiment` and `enableRobustSolverComparison`** store
  opt-ins for experiment enablement.
- **Confidence-guarded carving** for `OccupancyGrid`, where
  `carveConfidenceThreshold` decays established cells rather than hard-blocking
  them.

### Bug Fixes

- The `enable-gps-ar` controller observes session end, so the state no longer
  sticks at `running`.
- Wayfinding HUD visibility is distance-gated and independent of view
  direction.
- `replay-session` is kept out of the state barrel, fixing an eager-evaluation
  regression.

### Performance

- Occluder re-mesh worker fast path - 69% off the smooth re-mesh.
- The carve walk is fused into `OccupancyGrid`, cutting fold time by 31%.
- Depth reconstruction cadence moved from 2000 ms to 200 ms, with field-tested
  tuning (voxel 16 cm, `minConfidence` 2) that consumers inherit.

## [1.11.0] - 2026-07-12

### Features

- **FFT high-frequency-energy blur metric**, with a selector to choose between
  blur metrics.
- **`flushPendingWrites`** - a persistence drain hook; the stop flow awaits it
  before readers touch `actions/`.

### Breaking Changes

- **Replay owns its scene.** The `webxr-session` scene-injection exports are
  deleted.
- **`webxr-session` callback injectors are folded into `initAR` options.**
- **The recorder settings catalog moved into the recorder app**, out of the
  framework.
- **The dead legacy single-tile `MapOverlay` is deleted.**

### Refactoring

- The QR cluster moved into an `ar/qr/` namespace, the first step of the `ar/`
  restructure.
- Zero-consumer `webxr-session` exports were pruned.

## [1.10.0] - 2026-07-11

### Features

- **Built-in object-pose bootstrap source** for `createGpsAnchor`.
- **`initAR` applies the Chromium tab-crash workaround by default.**
- Image capture interval minimum lowered to 250 ms.

### Bug Fixes

- `interpolatingMedian` no longer overflows on large finite values.

### Breaking Changes

- The deprecated `greedy` option and the `setDebugVisualization` wrapper are
  removed.

### Refactoring

Largely a quality-review pass: six private median copies consolidated into
`utils/median`, `offsetGeo` delegating to the library's geodesy, three
permission-checker duplication clusters extracted, the alignment lerper
epsilon-snapping to its target, and per-frame recomputation phase-gated in the
tracking-quality path.

## [1.9.1] - 2026-07-10

### Dependencies

- Core pin moved to `^1.9.1`. No framework source changed; the release also
  carried the pnpm 11 configuration (packageManager 11.11.0, Node >= 22.14.0,
  and a 24 h `minimumReleaseAge` embargo that excludes our own packages).

## [1.9.0] - 2026-07-09

### Features

- **QR payload transport** - a size estimator for the printed-QR payload
  benchmark, base64url/base45/base32up encoders, payload codecs with total
  decoders, and `buildQrLaunchUrl` for the measured-best launch URL.
- **Lazy ZIP loading** - `ZipSource` supports a Reader integration so a
  recording can be read without loading it whole.
- **Live-map improvements** - the blue dot defaults to the fused pose rather
  than the raw GPS fix, and auto-centering follows it.
- **`loopClosureDebug` recording option**, plus a core re-export of
  `createLoopClosureHandler`.

### Bug Fixes

- A throwing `mapOverlay.render` is contained, so centering and the dispatch
  chain survive it.
- A leading U+FEFF is preserved when decoding UTF-8 QR payload text.
- The OPFS collision probe treats a file-occupied session name as taken.

## [1.8.0] - 2026-07-05

### Features

- **Persistent occluder on by default**, meshed in a Web Worker, with a
  surface-nets mesh and viewer-local windowed queries backed by a 16-cube chunk
  index.
- **Occlusion debug materials** - depth-shaded skin with distance fade and
  fresnel rim, composed per style via `setDebugStyle`; the
  `occluderDebugViz` boolean is replaced by an `occluderDebugStyle` enum.
- **AR far plane raised to 200 m**, via exported `AR_CAMERA_*` frustum
  constants.
- **Session-end hook** with full teardown when the system ends the XR session.
- **`visualization.statsOverlay`** recording option, default off.
- **FIFO cap on live frame tiles** via `frameTileDisplay.maxTiles`.

### Bug Fixes

- Every key-touching `OccupancyGrid` path is guarded against packed-key
  aliasing outside the +/-65535 envelope.
- The mesh worker driver recovers from worker errors, including one that fires
  before the first post, instead of freezing.
- The CSS3D minimap plane is re-fitted so it clears the viewer plane at
  map-viewing pitches for all yaws.
- `updatePosition` is a real no-op when the map is hidden.
- `maxLinearVelocity` raised so walking does not suppress capture.

### Performance

- Allocation-free mesher inner loops, a memoized `getOccupiedCells` snapshot
  per revision, a flattened `CellRecord` with deduped carves, cached frame
  registry snapshots, and no per-frame allocations in the heading-up minimap
  path.

## [1.7.0] - 2026-06-28

### Features

- **Absolute-orientation compass reference** - `AbsoluteOrientationSensor` is
  captured as an independent north reference and injected into GPS events, with
  a default-on cold-start compass override and a `compassDebug` recording
  option group.
- **Image-quality gate** - pure blur and blackness metrics with a
  self-calibrating verdict gate, an off-thread drop-and-retry gate in
  `ImageCaptureManager`, an injectable off-thread analyzer seam, and a
  persisted `qualityFilter` configuration.
- **Capture motion gate** - pure pose-motion velocity helpers, a sliding-window
  decision, and a `motionFilter` entry in the persisted image-capture options.
- **Tunable `minConfidence`** voxel noise filter for the occupancy grid.

### Bug Fixes

- Corrupt alignment matrices score as a failure rather than as perfectly
  stable, and a non-finite `matrixDelta` can no longer NaN the score.
- `saveCapture` and quality verdicts are guarded against resolving after
  `stop()`.
- A superseded absolute-orientation start is aborted, fixing a stop race.
- Compass opt-ins are re-applied idempotently and deferred to a microtask, so
  they survive store recreation and `setZeroPos`.

### Refactoring

- The persistence middleware warns on re-entrant persisted-action dispatch, and
  `gpsData` creation is reacted to via a listener middleware rather than a
  re-entrant subscriber dispatch.
- Dead legacy `rawDeviceOrientation`/`compassAbsolute` writes were removed.

## [1.4.0] - 2026-06-21

### Features

- **QR placement pipeline** - `deriveQrPlacement` derives pose and size
  together, an incremental deriver runs in O(1) per detection, raw geo-less
  detections are supported with an optional solved pose, and replay handles raw
  QR detections. Adds a `qr` opt-in capture group to the recording options.
- **QR sizing robustness** - dense plane fit as the primary size path, bilinear
  denser depth lookup, depth-at-corners fallbacks, and lifelong refinement.
- **`qr-debug-view`** promoted into the framework as a shared consumer view.
- **Frame-tile display-resolution slider**, prominent in-AR minimap ref-point
  markers, and role-based sphere sizing.
- Camera frame capture size set to 1024 px, from an on-device sweep.

### Bug Fixes

- Error-path cleanup in `enable-gps-ar` is isolated step by step, and a
  session is rolled back when a watch start throws after `initAR`.
- The detection scheduler isolates user callbacks so a throw cannot corrupt its
  lock state machine, and cannot wedge on a synchronous `detect` throw.
- Non-finite and degenerate inputs are rejected across `computeAspectFitSize`,
  the depth sampler config, `validateDepthOptions` grid size, the camera frame
  source interval, and resolved QR size.
- `webxr-session` snapshots `blitCapture` before awaiting, avoiding a
  null-dereference on a concurrent session reset.

### Breaking Changes

- **Scenario logic is removed from framework storage**; scenario layout is
  recorder-owned, and scenario-aware ZIP export moved to the recorder behind a
  generic framework primitive.
- **`SessionMetadata.scenarioName` is renamed to `contextTag`**, with a replay
  fallback for older recordings.
- `OpenCvQrFrontEnd` is removed; QR decoding is `BarcodeDetector`-only.

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
