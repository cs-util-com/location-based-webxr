# Changelog

## [2.0.0] — unreleased (entry started 2026-09-02 as 1.23.0)

Requires `gps-plus-slam-js` ≥ 1.23.0. **A MAJOR**: the same unreleased
entry removes published surface and changes one published behaviour (below),
so it cannot ship as the 1.23.0 it was started as (PR #411 review). The
version number is set at release time by `prep_new_releases --framework
major`; `package.json` still reads 1.23.0 until then.

### ⚠️ Breaking changes

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
- **`utils/median`** is now a built deep-import entry.
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
  `setRobustSolverHeadingPenalty`, the consts `ALIGNMENT_OVERRIDE_KEYS`,
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
