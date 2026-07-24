# webxr-session.ts

## Purpose

Manages WebXR AR session initialization, Three.js renderer setup, and the XR frame loop.

**ARCHITECTURE NOTE:** See `docs/architecture-ar-gps-pose-separation.md` for the scene hierarchy design.

## DOM-Overlay / HUD stacking invariant

`buildSessionOptions(rootElement, …)` sets `sessionOptions.domOverlay = { root: rootElement }`
when `enableDomOverlay` is on, and `initAR(container, …)` passes its `container`
through as that `rootElement`. Under WebXR DOM Overlay the browser composites
**only the overlay root's subtree** over the camera feed during an
`immersive-ar` session.

**Invariant:** any HUD/overlay node an app wants visible in AR must be a DOM
**descendant** of the element passed to `initAR`. A sibling overlay renders in
the 2D pre-AR layout but disappears once the session starts. This is a DOM
_nesting_ rule, not a `z-index` rule. The repo-meta guard
`tests/repo-config/hud-overlay-nesting.test.js` enforces it for every app's
`index.html`; the AppFramework README's "DOM-Overlay / HUD stacking convention"
documents it for app authors.

## Scene Hierarchy

```
scene (GPS world frame — NUE: X=North, Y=Up, Z=East)
├── cameraFollower (lerps to camera world position; rotation = identity; Issue 8)
│   └── GPS compass cubes, map mesh, etc.
└── arWorldGroup (local space = NUE; receives alignment matrix directly)
    └── basisChangeNode ('webxr-to-nue', constant WEBXR_TO_NUE matrix, matrixAutoUpdate=false)
        └── arpose (Object3D - AR pose; local space = WebXR)
            └── camera (PerspectiveCamera)
```

- `arWorldGroup` local space is **NUE** — objects added here use `[1,0,0]`=North, `[0,0,1]`=East.
  `applyAlignmentMatrix(m)` writes `m` directly to `arWorldGroup.matrix` (no WEBXR_TO_NUE composition).
  **`arWorldGroup.matrix` carries the alignment (AR/odometry-NUE → GPS-world NUE), and that is what GPS-registers the view:**
  the camera (a descendant) and every GPS anchor parented under `arWorldGroup` ride the alignment
  together. Apps apply it via `enableArWorldGroupAlignment({ store, arWorldGroup })`
  (smoothly lerped); the recorder drives its own lerper into `applyAlignmentMatrix`. GPS anchors
  (`createGpsAnchor`) MUST live under `arWorldGroup` (the factory throws otherwise) so they re-register
  to their reference GPS off-screen with only a small residual; GPS-world "truth" markers that should
  NOT ride the alignment go on the **scene root** instead.
- `basisChangeNode` is a static child of arWorldGroup holding the constant WEBXR_TO_NUE basis-change
  matrix. It is set once at scene creation and never modified. This ensures the full camera chain is:
  `camera_world = alignment × WEBXR_TO_NUE × arpose × camera_local` — mathematically identical to the
  previous runtime composition, but WEBXR_TO_NUE now lives in the scene graph instead of code.
- `arpose` local space is **WebXR** (X=East, Y=Up, Z=South):
  - **Recording:** stays at identity (transparent in transform chain)
  - **Replay:** receives recorded `odomPosition`/`odomRotation` from store subscriber (positions must
    be converted from NUE to WebXR via `nuePositionToWebXR()`, and rotations via `nueQuaternionToWebXR()`,
    before writing to `arpose.position` / `arpose.quaternion`)
- Camera's local transform = raw AR pose (recording) or user controls (replay)
- Camera's world transform = `arWorldGroup.matrix × basisChangeNode.matrix × arpose.matrix × camera.matrix`

## Public API

| Export                      | Type                                                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARPose`                    | interface                                                                    | Extracted pose data (position + orientation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `getCurrentArPose()`        | `() => ARPose \| null`                                                       | Get latest raw AR pose (for GPS callback)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getDepthInfoFromFrame()`   | `(XRFrame, XRViewerPose \| null) => DepthInfo \| null`                       | Wrap the per-frame `XRCPUDepthInformation` (the widened `data`/`rawValueToMeters`/`normDepthBufferFromNormView`/`projectionMatrix`) for the **live depth occluder**. Call from a `registerXrFrameUpdate` callback (`pose = frame.getViewerPose(referenceSpace)`). Returns `null` when depth is unavailable (no pose/view, no `getDepthInformation`, or it throws). Same wrapped depth the sparse grid sampler consumes                                                                                                                                                                                                                                                                                                                                                                    |
| `SessionFeatureOptions`     | interface                                                                    | Opt-in standard WebXR features (`requestHitTest`, `requestDepthOcclusion`) independent of crash-isolation flags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `createSceneHierarchy()`    | `() => { scene, arWorldGroup, arpose, camera }`                              | Create scene with correct hierarchy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `isWebXRSupported()`        | `async () => boolean`                                                        | Check if immersive-ar is available                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ArSessionCallbacks`        | interface                                                                    | The per-session host-callbacks struct passed to `initAR` (surface-reduction step 1 — replaces the 13 deleted pre-init setter exports). Optional groups: `imageCapture { onCaptured, getScreenRotation, onFailed?, onSuspicious?, qualityAnalyzer? }`, `tracking { store, onRestarted?, onLost?, onRecovered? }` (store + callbacks arrive TOGETHER), `depth { onCaptured, onUnavailable? }`, `cameraFrame { onFrame }`, plus top-level `onFrame?` (per-XR-frame tick) and `onSessionEnd?(info)` (fired exactly once per session end, `info.requestedByApp` discriminates app vs. system end). Unpacked once into the session handle's slots at init; `resetWebXRState()` replaces the handle wholesale (incl. `qualityAnalyzer` — per-session), so re-pass the struct with each `initAR`. |
| `initAR()`                  | `async (container, isolationOptions?, sessionFeatures?, callbacks?) => void` | Start AR session and Three.js renderer; forwards `sessionFeatures` (e.g. `requestHitTest`) to session negotiation and unpacks `callbacks` ({@link ArSessionCallbacks}) into the session handle's slots the frame loop reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `rebindTrackingStore()`     | `(store: TrackingSubscribableStore) => void`                                 | Re-point the tracking pipeline at a NEW store **mid-session** — the ONE runtime mutation that survived the setter fold (the recorder swaps its Redux store per recording; without re-pointing, `poseReceived` keeps flowing into the orphaned store). Tears down the previous store's phase subscription (the subscription itself is only re-established by the next `initAR`, matching the old `setTrackingStore` semantics).                                                                                                                                                                                                                                                                                                                                                            |
| `getScene()`                | `() => THREE.Scene \| null`                                                  | Get current Three.js scene                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `getArWorldGroup()`         | `() => THREE.Group \| null`                                                  | Get AR world group (for AR content)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `getCamera()`               | `() => THREE.PerspectiveCamera \| null`                                      | Get current camera                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `applyAlignmentMatrix()`    | `(matrix: number[]) => void`                                                 | Write alignment directly to arWorldGroup.matrix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `nuePositionToWebXR()`      | `(nue: number[]) => [n, n, n]`                                               | Convert NUE position to WebXR (for replay arpose)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `nueQuaternionToWebXR()`    | `(nue: readonly number[]) => [n, n, n, n]`                                   | Convert NUE quaternion to WebXR `[z, y, -x, w]` (for replay arpose rotation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `endARSession()`            | `async () => void`                                                           | Full AR cleanup: stops animation loop, ends XR session, then delegates teardown to `resetWebXRState()` (disposes renderer/CSS3D, removes canvas, replaces the session handle wholesale)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SessionEndInfo`            | interface                                                                    | `{ requestedByApp: boolean }` — payload of the session-end callback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `startImageCapture()`       | `(config?: Partial<ImageCaptureConfig>) => void`                             | Start periodic image capture with optional config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `stopImageCapture()`        | `() => void`                                                                 | Stop periodic image capture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `startCameraFrameCapture()` | `(config?: CameraFrameCaptureConfig) => void`                                | Begin delivering throttled QR frames. `config.intervalMs` (default 125 ≈ 8 Hz) and `config.captureSize` (longer-edge px, default `DEFAULT_CAMERA_FRAME_CAPTURE_SIZE` = 1024 after the 2026-06-17 on-device sweep) tune cadence/resolution. The blit **preserves the camera aspect** (long edge = `captureSize`, e.g. 1024×768 for 4:3) so the QR reaches the detector undistorted. No-op if the `cameraFrame` callbacks group was not passed to `initAR`.                                                                                                                                                                                                                                                                                                                                 |
| `stopCameraFrameCapture()`  | `() => void`                                                                 | Stop QR frame capture. Safe when not running.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `getCameraFrameCount()`     | `() => number`                                                               | Frames captured since the last `startCameraFrameCapture` (0 when idle).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### Exported for unit testing only

These exports are internal implementation whose contracts are pinned directly by unit tests (documented test-only exports per the 2026-07-10 quality-review B-5 precedent; consolidated by surface-reduction step 3). They are NOT re-exported by the `ar/` barrel; if one gains a production consumer, move it out of the test-only block and into the barrel:

- `buildSessionOptions(rootElement, isolationOptions?, sessionFeatures?) => XRSessionInit`
  - Builds the session-negotiation options (throws on null root; `requestHitTest` adds `hit-test` as an _optional_ feature; `requestDepthOcclusion` requests `depth-sensing` (cpu-optimized) independently of `enableDepthSensingFeature` — both coexist on the same stream).
  - Production code reaches it exclusively through `initAR`; the export lets tests pin the full flag matrix without renderer/`navigator.xr` mocks.
- `extractPoseFromViewer(pose) => ARPose | null` — pure pose extraction used by `onXRFrame`.
- `extractResetTransformData(event) => ResetTransformData | null | undefined` — pure reset-transform extraction (property missing → `undefined`, null → `null`, present → data) used by the XR reference-space `reset` listener.
- `isXRCameraLike(value) => value is XRCameraLike` — runtime guard for `XRView.camera` candidates; accepts only finite, positive `width`/`height`.
- `getXrCameraFromPose(pose) => XRCameraLike | null` — collapses every camera-texture precondition failure to `null` so the frame loop can clear its texture cache unconditionally.
- `shouldLogCameraAccessDiagnostic(pose, alreadyLogged, captureActive) => boolean` — one-shot camera-access diagnostic predicate (pose-guarded against the false "NOT GRANTED" latch).
- `resetWebXRState() => void` — `@internal` full module teardown; load-bearing across the framework's webxr-session test files (the single chokepoint every restart passes through).

Removed in surface-reduction step 3 (zero consumers): `getLiveCss3dManager()` and `getCameraFrameCaptureSize()` were deleted; `AR_CAMERA_FOV`/`AR_CAMERA_NEAR`/`AR_CAMERA_FAR` became module-private constants (see Invariants).

## Invariants & Assumptions

- Requires browser with WebXR support (`navigator.xr`)
- Three.js renderer runs in XR mode with `renderer.xr.enabled = true`
- Session uses `local-floor` reference space
- DOM overlay optional (for HUD visibility during AR)
- Depth sensing optional (for depth point capture)
- Camera-access optional (for blit-based image capture; falls back to canvas.toBlob)
- **Container element must be provided** — `initAR(container)` no longer queries the DOM internally; the caller passes the container element
- **Single active session (re-entry guard)** — `initAR()` throws `AR session already initialized …` if a `renderer` or `xrSession` is still set. This prevents a second call from orphaning the previous renderer's canvas in the DOM and leaking its GPU resources. The host must call `endARSession()` (or `resetWebXRState()` in tests) before starting a new session. Covered by `webxr-session.init-guard.test.ts`.
- **`startImageCapture()` is self-stopping** — if a capture session is already running (an `ImageCaptureManager` or `CameraBlitCapture` exists), it calls `stopImageCapture()` first. This disposes the previous `CameraBlitCapture`'s `WebGLRenderTarget` GPU memory and stops the previous `ImageCaptureManager` (clearing its safety timeout), so toggling capture settings mid-session can't leak GPU memory or leave two managers competing over the same callbacks. Covered by the `startImageCapture stops any in-flight capture before starting a new one` test in `webxr-session.test.ts`.
- `ARPose` is a plain object suitable for JSON serialization
- **Camera MUST be parented under arpose (which is under basisChangeNode under arWorldGroup)** for pose separation to work
- **arpose is identity during recording** — transparent in the transform chain
- **arpose in replay** receives NUE odom positions converted to WebXR via `nuePositionToWebXR()` so the
  composed `alignment × WEBXR_TO_NUE` chain produces the correct GPS world position
- **basisChangeNode holds WEBXR_TO_NUE permanently** (`matrixAutoUpdate=false`). `applyAlignmentMatrix()`
  writes the alignment directly to `arWorldGroup.matrix` without any matrix multiplication. The
  WEBXR_TO_NUE effect is achieved through the scene graph, not code — zero runtime cost per call.
- **arWorldGroup local space is NUE** — any child added directly to arWorldGroup can use NUE coordinates:
  `[1,0,0]`=North, `[0,0,1]`=East, `[0,1,0]`=Up. No WebXR↔NUE conversion needed.
- **Lighting is in scene** (GPS world space), not arWorldGroup (AR local space)
- **Camera frustum comes from the module-private `AR_CAMERA_FOV`/`AR_CAMERA_NEAR`/`AR_CAMERA_FAR` constants (70 / 0.01 / 200)** — the single source of truth for live AR and replay (both build the camera via `createSceneHierarchy()`); never re-introduce inline literals in the `PerspectiveCamera` constructor. Far was raised 100 → 200 m (F2, 2026-07-04) so objects 100–200 m out render; far/near = 2×10⁴ is comfortable for a 24-bit depth buffer — revisit if near ever shrinks. WebGL-only: the CSS3D minimap is composited from the fov alone (near/far never clip it). The constants are no longer exported (surface-reduction step 3); the frustum test in `webxr-session.test.ts` pins the values on the constructed camera instead
- When `camera-access` is granted, each XR frame extracts the camera texture via `renderer.xr.getCameraTexture()` for the blit capture pipeline
- `isXRCameraLike()` accepts only finite, positive numeric dimensions so downstream capture sizing never consumes `0`, negative, `NaN`, or infinite camera sizes
- **Tracking loss handling:** When `initAR()` receives its `callbacks.tracking` group (store + host callbacks arrive TOGETHER — the old half-wired setter split is structurally impossible), it subscribes to the store, listens for `XRReferenceSpace` `reset` events, and dispatches `originResetAction(transform)` (serializing `XRReferenceSpaceEvent.transform`'s `position`/`orientation` to tuple arrays as `ResetTransformData`, or `null` if the runtime can't determine the delta). The store subscription translates tracking-phase transitions into the legacy callback contract: `tracking→lost` invokes `onTrackingLost` and clears `latestArPose`; `lost→tracking` with a non-null `lastRestartedPayload` invokes `onTrackingRestarted(payload)` (Case 2) and dispatches `clearLastRestartedPayloadAction`; `lost→tracking` with a null payload invokes `onTrackingRecovered` (Case 1, seamless). On every XR frame, `updateTrackingState()` dispatches `poseReceivedAction({pose, sensorOrientation})` or `poseLostAction()` against the store. See `state/tracking-slice.ts.md` and `docs/2026-04-08-ar-tracking-loss-review.md`.
- **Live-session-only getters (surface-reduction step 2):** `getScene()`/`getArWorldGroup()`/`getCamera()` return the LIVE AR session's scene graph, set internally by `initAR()` and cleared by `resetWebXRState()` — they are `null` during desktop replay. The historical replay injection exports (`setScene`/`setArWorldGroup`/`setCamera`/`setArPose`/`getArPose` — replay-mode Risk R1) were deleted: replay owns its scene in `replay-scene.ts` (`getReplayState()`), and scene-reading visualizers accept a replay source via `gpsEventVisualizer.setSceneSource(...)` instead.
- **`resetWebXRState()` performs full renderer cleanup:** stops the animation loop (`setAnimationLoop(null)`), removes the canvas from the DOM, and calls `renderer.dispose()` before replacing the session handle.
- **Both session-end paths run the full teardown (F3, 2026-07-04):** the XRSession `'end'` listener funnels into an internal `handleSessionEnded()` that resets the tracking slice, runs `resetWebXRState()`, and then fires the `callbacks.onSessionEnd` host callback exactly once. `endARSession()`'s own `session.end()` fires the same `'end'` event; an internal `endRequestedByApp` flag (set immediately before `end()`) discriminates the paths and can never latch across sessions. A throwing host callback is caught and logged — it cannot break the teardown. Covered by `webxr-session.session-end.test.ts`.
- **No hardcoded DOM IDs:** the renderer canvas is never assigned an `id` attribute — callers must hold their own reference.

## Internal State

- `activeSession` — the per-session `ArSessionHandle`, and since **Stage 3** of the [staged ArSession refactor](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-07-18-2045-webxr-session-arsession-handle-refactor-plan.md) the module's ONLY mutable. Owns this session's clusters:
  - `sceneGraph` (Stage 3): `renderer` (THREE.WebGLRenderer), `scene` (with lights, GPS world frame), `camera` (child of the arpose node; the handle keeps no reference to arpose itself — it stays at identity during live sessions and lives purely in the scene graph; replay's arpose is owned by `replay-scene.ts`), `arWorldGroup` (transformed by alignment), and the CSS3D manager `css3d`.
  - `xrSession` (Stage 3) — the current XRSession; `latestArPose` (Stage 3) — most recent raw AR pose, updated every frame; `onFrame` (Stage 3) — the per-frame host callback.
  - The resolved crash-isolation options, the session-end pair (`onSessionEnd` callback + `endRequestedByApp` discriminator), and the frame diagnostics (`lastFrameTime`, `latestCameraTexture`/width/height, camera-access log latches) — Stage 0.
  - The three capture clusters mirroring the `ArSessionCallbacks` group names (Stage 1) — `imageCapture`: manager + JPEG blit + callback slots incl. the injected quality analyzer; `depth`: sampler + lazy 256×192 rgb blit + callbacks; `cameraFrame`: source + lazy aspect-preserving blit + captureSize + callback.
  - The `tracking` cluster (Stage 2) — store + phase subscription + host callbacks; `tracking.store` is the ONE field mutated mid-session, by `rebindTrackingStore`.
  - Always non-null: `initAR()` creates a fresh handle parameterized with the validated isolation options and the callbacks struct; `resetWebXRState()` tears down the outgoing handle's phase subscription, disposes its GPU-backed blits + CSS3D overlay + renderer, and REPLACES the handle wholesale — one line resets every field on it, so new session state can never be forgotten in the teardown (the "add a field, forget the reset" leak class is structurally gone).

## Frame Loop

`onXRFrame()` is called each animation frame:

1. Get viewer pose from `frame.getViewerPose()`
2. Extract position/orientation via `extractPoseFromViewer()`
3. Store in `latestArPose` for `getCurrentArPose()`
4. If `camera-access` is granted, acquire camera texture via `acquireCameraTexture()` (wraps `renderer.xr.getCameraTexture()`) and store with native dimensions for blit capture
5. Trigger image capture / depth sampling if active. The depth sampler is created with an `acquireRgbLookup` callback (Iter 8 RGB voxel coloring): when a sample is actually emitted (and the `rgb` option is on), a dedicated small 256×192 `CameraBlitCapture` (`depthRgbBlit`, lazily created, disposed by `resetWebXRState()`) blits `latestCameraTexture` and `createRgbLookup` maps each point's view coordinates to a color — at most one GPU readback per ~1 Hz sample, never per frame
6. Trigger camera frame capture for CV if active (B2). A `CameraFrameSource` (created in `initAR` when the `cameraFrame` callbacks group was passed) is ticked with the XR `time`; it throttles to the detection cadence (~8 Hz) and, when due, blits `latestCameraTexture` to **top-left RGBA** via a dedicated session-owned `CameraBlitCapture` (`cameraFrameBlit`, lazy, disposed by `resetWebXRState()`) sized to the **camera aspect** with its longer edge at `captureSize` (default `DEFAULT_CAMERA_FRAME_CAPTURE_SIZE` = 1024, e.g. 1024×768 for 4:3 — `computeAspectFitSize`, so the target is undistorted), and hands the frame to the callback (QR detection today, object detection / OpenCV later). The throttle gates the blit itself, so the (larger) readback runs ~8×/s, not per frame — the §A.4 efficiency win.
7. Render scene

Per-frame dispatch order: after the dimensionless `runFrameUpdates(dt, elapsed)`
callbacks (see `frame-loop.ts`), `onXRFrame()` calls
`runXrFrameUpdates({ frame, referenceSpace, session, dt, elapsed })` so app
code registered via `registerXrFrameUpdate` (see `xr-frame-loop.ts`) gets live
WebXR access for the current frame (e.g. hit-test, light estimation). Both
registries are cleared during `resetWebXRState()`. The XR context object is
valid only synchronously inside each callback.

## Examples

```typescript
import {
  isWebXRSupported,
  initAR,
  getCurrentArPose,
  getArWorldGroup,
  applyAlignmentMatrix,
} from './ar/webxr-session';

if (await isWebXRSupported()) {
  await initAR();

  // Add AR content to arWorldGroup
  const arGroup = getArWorldGroup();
  arGroup?.add(myARObject);

  // Read current pose (for recording)
  const pose = getCurrentArPose();

  // Apply alignment from library
  applyAlignmentMatrix(alignmentMat4);
}
```

## Tests

Unit tests in `webxr-session.test.ts` cover:

**`buildSessionOptions()`:**

- Validates session features (local-floor, dom-overlay, depth-sensing)
- Null-safety regression test
- DOM overlay root binding
- `hit-test` is off by default and added as an _optional_ feature only when `requestHitTest: true`
- `depth-sensing` (cpu-optimized) is requested when **either** `enableDepthSensingFeature` **or** `requestDepthOcclusion` is set — requested exactly once when both are, with no conflict/throw (grid sampler + live occluder are two consumers of one cpu-optimized stream). Live-occluder Iter 1, [2026-06-14-0009-webxr-depth-occlusion-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-14-0009-webxr-depth-occlusion-plan.md) §6/§8.

**`extractPoseFromViewer()`:**

- Extracts position and orientation from valid pose
- Returns null for null/empty poses
- Produces serializable plain objects

**`isXRCameraLike()`:**

- Accepts finite positive camera dimensions
- Rejects zero, negative, `NaN`, and infinite dimensions before capture sizing

**`createSceneHierarchy()`:**

- Scene contains arWorldGroup as direct child
- Camera is parented under arWorldGroup
- Correct hierarchy depth (scene → arWorldGroup → camera)
- arWorldGroup starts with identity transform
- Lighting is in scene, not arWorldGroup

**Live scene getters:**

- `getScene()` / `getArWorldGroup()` / `getCamera()` / `getCurrentArPose()` return `null` before initialization
- The behavioural `applyAlignmentMatrix` tests (alignment written verbatim to the live `arWorldGroup`, full-chain WebXR→NUE mapping, `nuePositionToWebXR` replay composition) live in `webxr-session.alignment.test.ts` — they seed the module state through the real `initAR()` path (mocked `WebGLRenderer` + `navigator.xr`)

**DOM hardcoding audit regressions (P1/P2):**

- P1: source code grep confirms no hardcoded `ar-canvas` ID on the renderer canvas
- P2: `resetWebXRState()` stops animation loop, removes canvas, disposes renderer
- P2: `endARSession()` ends the XR session and delegates teardown to `resetWebXRState()` (asserted by the delegation grep test + a behavioural test that scene-graph references are cleared)
- P2: `endARSession()` is safe to call when no AR session is active
- CSS3D overlay lifecycle is pinned **observably** in `webxr-session.session-end.test.ts`: `initAR` appends the overlay element when `enableCss3dRenderer` is on, and the session-end teardown (`resetWebXRState()` → `sceneGraph.css3d.dispose()`) removes it from the DOM (replaces the deleted `getLiveCss3dManager` null-default tests, surface-reduction step 3)

Full integration testing requires an Android device with WebXR support.

**initAR callbacks (surface-reduction step 1) — `webxr-session.callbacks.test.ts`:**

- initAR with a `tracking` group dispatches `resetTracking` into the injected store and subscribes to it
- phase transitions on the injected store fire the host `onLost` / `onRestarted` / `onRecovered` callbacks
- `rebindTrackingStore()` detaches the previous store's phase subscription (mid-session store swap)
- initAR without the group leaves the store untouched
- `onSessionEnd` delivery/clearing is covered by `webxr-session.session-end.test.ts`

**Camera frame capture (B2):**

- `startCameraFrameCapture()` no-ops (doesn't throw) when the source was never created
- `stopCameraFrameCapture()` is safe when not running
- `getCameraFrameCount()` returns 0 when idle

The throttle math + the **performance regression** test (blit fires at the
detection cadence, not per frame) live in `camera-frame-source.test.ts`.
