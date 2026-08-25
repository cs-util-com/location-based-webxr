# Changelog

## [Unreleased]

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
