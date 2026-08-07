# GPS+SLAM App Framework

[![npm version](https://img.shields.io/npm/v/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![npm downloads](https://img.shields.io/npm/dm/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://github.com/cs-util-com/location-based-webxr/blob/main/LICENSE)
[![Node](https://img.shields.io/node/v/gps-plus-slam-app-framework.svg)](https://nodejs.org/)

**Stable outdoor AR in the browser — no native app, no VPS, no signup, not even internet required**

Three.js + GPS + WebXR sensor fusion that keeps 3D content pinned to real-world coordinates as the user walks.

<p align="center">
  <a href="https://gps.csutil.com"><strong>Live Demos & Examples →</strong></a>
</p>

---

Reusable building blocks for AR+GPS web apps, built on top of the closed-source [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js) alignment core.

It is part toolkit, part fusion engine: the toolkit covers the AR + GPS plumbing every app needs anyway, and the fusion engine lifts location accuracy to the point where ideas that previously sat on the "someday, on native" shelf become reachable in a browser:

- A **WebXR + Three.js scene** with image and depth capture, replay rendering, and tracking-state monitoring.
- **GPS, orientation, and permission wiring** ready to plug into the store.
- **QR detection and pose solving** (pure-JS planar PnP) that can feed a surveyed marker in as a high-precision position observation.
- **OPFS + ZIP record & replay** with a `StorageBackend` interface you can swap.
- A **composable Redux store factory** (`createSlamAppStore`) that combines the core library's reducers with your own slices.

## What You Can Build With It

- **Outdoor AR navigation** — arrows and waypoints anchored to real-world GPS coordinates.
- **GPS-anchored 3D content** — drop persistent 3D objects at lat/lon and have them stay put as the user walks.
- **AR tour guides and museum trails** — content keyed to location, surfaced when the user is nearby.
- **Location-based games** — geocaching, scavenger hunts, multi-player AR experiences tied to physical places.
- **Field-data capture tools** — record synchronized GPS, AR poses, camera frames, and depth as reusable datasets for 3D reconstruction (COLMAP / Gaussian splatting), alignment-quality evaluation, desktop replay, geo-anchored site documentation, and ML training.
  - The recorded zips can be opened directly in third-party reconstruction tools such as [colmapview.github.io](https://colmapview.github.io/) or [LichtFeld-Studio](https://github.com/MrNeRF/LichtFeld-Studio).

## Zero-Install Onboarding

Because everything runs in the browser, there is no native build to ship, no store review to wait on, and nothing for the user to download or sign up for — which removes most of the friction that normally sits between "interested" and "in the experience".

The shortest path in is a single QR code: the user points their phone's camera at it and the AR scene opens **directly in the browser**. From there you have two ways to ground the content, and you can pick per experience:

- **Use the QR code as a high-precision GPS fix.** A code placed at a known, surveyed spot can do double duty as a spatial anchor. The framework detects it in the camera feed ([`ar/qr`](#arqr--qr-detection-pose--geo-voting)), solves its pose, and feeds that in as an extremely accurate position observation into the **same** fusion pipeline as the phone's own GPS. It doesn't replace GPS — it seeds the GPS↔AR alignment correctly **from the first second** and then keeps fusing with the ordinary, noisier GPS readings the device collects as the user walks. So you get a correct anchor immediately _and_ it stays robust as people roam away from the marker.
- **Or let GPS+SLAM do the grounding.** Reusing the onboarding code as an anchor only works when it sits at a known, surveyed spot. Many experiences can't meet that — e.g. when the code lives on flyers the user carries around, or you simply don't want to run continuous QR detection and would rather save the battery. So there are cases where the code is perfect for _opening_ the experience but carries no reliable real-world pose; you skip marker anchoring and rely only on the GPS+SLAM fusion the framework already provides. The GPS↔AR alignment converges over the first seconds of movement into a tight, world-anchored outdoor overlay.

## Why use GPS+SLAM? (Visual Stability Beyond Raw GPS)

Raw GPS is useful for getting near a place, but it still jitters by meters and altitude is usually the hardest channel to trust. Most location-based AR apps work around that with broad proximity zones, floating beacons, or oversized highlights — fine as a fallback, but limiting if you want content that sits exactly on a path, a wall, or a specific spot on the ground.

GPS+SLAM fuses GPS observations with the device's AR odometry, so as the user moves the alignment between the AR world and real-world coordinates gets more stable.

### Which layer does what

A common assumption is that markerless WebXR will drift badly or make content "jump" in large, visually uniform outdoor spaces (open parks, grass fields), because classic visual SLAM leans on camera feature points that are sparse there. It's worth being precise about which layer does what, so you can judge whether this fits your use case:

- **Visual-inertial tracking is handled by the WebXR runtime (ARCore/ARKit), not by this stack.** The device's own AR stack already fuses the camera with the IMU to produce local 6-DoF odometry, which stays usable through short stretches of sparse visual features. This framework **consumes** that odometry rather than re-implementing it.
- **What this framework adds is GPS↔AR alignment.** `gps-plus-slam-js` continuously aligns the local AR odometry with GPS, refining the fit **live as the user moves** rather than re-snapping, so placed content does not teleport on every GPS update.
- **Accuracy is sub-meter, not centimeter — and it improves with motion.** After roughly 15 seconds of walking in representative outdoor conditions, visible drift typically drops well below raw GPS, and the fusion is what keeps locally-placed content sitting on its spot as the user walks around it.

Treat global placement as GPS-accurate and local stability as motion-dependent rather than guaranteed. If your use case needs accuracy from the very first frame rather than after a few seconds of walking, anchor the content to a printed QR reference instead — see [Zero-Install Onboarding](#zero-install-onboarding).

### What that buys you

- **Alignment improves with motion:** Once the user has walked for roughly 15 seconds in representative outdoor conditions, the solver has enough baseline that visible drift drops well below raw GPS. How stable it actually feels still depends on the device, the environment, and how clean the GPS track is — but in our own outdoor tests it consistently held up well enough for content that needs to sit on a specific spot.
- **VPS-like benefits without a VPS dependency:** Cloud visual-positioning systems can work well, but they usually require network access and a provider-maintained scan of the place where the user stands. GPS+SLAM localizes from the device's own GPS, camera tracking, motion, and orientation sensors, so the same alignment approach works in rural areas, woods, mountains, and private sites that no VPS provider has pre-scanned.
- **Just a URL, no app install:** The whole experience runs in the mobile browser through WebXR, so end users open a link and are in AR within seconds. There is no app-store gate, no native build per platform, and authors can iterate on the live URL while users keep using the same link.
- **Heading does not depend only on the compass:** Phone compass data can be noisy, biased, or temporarily wrong enough to make a naive AR overlay rotate in the wrong direction. GPS+SLAM can infer the world heading from how the user actually moves through space, so after the user has walked a few meters the overlay no longer has to trust the device-orientation readings.
- **Session-local objects stay fixed:** Objects created directly in the AR scene can stay at the same 3D position for the current session, independent of later GPS alignment updates. This is ideal for content the user creates live, such as a 3D trail of the path they walked, temporary markers, or objects they place by hand in the world.
- **Anchors make placed content shareable:** When an object should also be tied to a GPS coordinate for replay, persistence, or sharing with other users, `createGpsAnchor` bootstraps from median GPS samples, keeps the Three.js object positioned from its GPS target inside `arWorldGroup`, and can defer small corrections until the object is off-screen. Large alignment jumps still force a correction so content does not remain in a stale location.
- **Use exact paths and POIs, not only blobs:** Proximity zones remain a good UX for letting users enter an experience from any direction, but they do not have to be the only interaction model. The framework is designed for route-following cues, authored POI objects, precise areas of interest, and other content that benefits from being visibly tied to a real-world path or location.

Don't take any of this on trust. Because everything runs in the browser, the fastest review is to open one of the [live demos](https://gps.csutil.com) on your own phone, step outside, drop an object, walk around it, and judge for yourself whether the stability holds up for your use case.

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Your App                                        │
│  (UI, screen flow, app-specific reducers)        │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-app-framework  ← this package     │
│  (WebXR, Three.js, sensors, storage, replay,     │
│   composable store factory)                      │
├──────────────────────────────────────────────────┤
│  gps-plus-slam-js  (core algorithms)             │
│  (GPS/AR alignment, outlier rejection, GPS math) │
└──────────────────────────────────────────────────┘
```

The framework never imports from your app. Your app imports from the framework and the core library. The core library never imports from the framework.

## Installation

```bash
pnpm add gps-plus-slam-app-framework
```

### Runtime Dependencies

These are pulled in automatically — you do not need to install them yourself:

- `@reduxjs/toolkit`
- `redux`
- `gl-matrix`
- `gps-plus-slam-js` — the closed-source alignment core. Prefer reaching its symbols through the framework's curated [`core`](#core--curated-re-exports-of-the-alignment-core) subpath instead of adding a second direct dependency.

### Peer Dependencies

Required (install in your app):

- `three` (>= 0.170.0)
- `@zip.js/zip.js` (>= 2.7.0)
- `h3-js` (>= 4.0.0)

Optional:

- `leaflet` (>= 1.9.0) — only needed if you use `LeafletMapOverlay`
- `@sentry/browser` (>= 10.0.0) — only needed if you wire Sentry error reporting

### Licensing

A **free community license key is bundled** with the framework, so you can start building right away — no signup and no API-key request process. The key is refreshed every time a new framework version is released and is valid for a year, so keeping the framework reasonably up to date keeps the license valid automatically. See the core library's [EULA](https://www.npmjs.com/package/gps-plus-slam-js) for the full terms, and pass `licenseKey` to `createSlamAppStore` if you hold a paid key.

## Quick Start

```typescript
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { initAR } from 'gps-plus-slam-app-framework/ar';
import { startGpsWatch } from 'gps-plus-slam-app-framework/sensors';
import { NullStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { recordGpsEvent } from 'gps-plus-slam-app-framework/state';

// 1. Compose the store. NullStorageBackend keeps everything in memory; swap
//    to OpfsStorageBackend when you want durable recording.
const store = createSlamAppStore({
  storageBackend: new NullStorageBackend(),
});

// 2. Start the WebXR AR session.
await initAR(document.getElementById('app')!);

// 3. Wire GPS into the store.
startGpsWatch(
  (pos) => {
    store.dispatch(
      recordGpsEvent({
        /* build the payload from `pos` */
      })
    );
  },
  (err) => {
    console.error('GPS error', err);
  }
);
```

See [Examples & Demos](#examples--demos) for runnable apps, from the smallest possible consumer up to the full recorder.

> **Imports.** Prefer subpath imports (`gps-plus-slam-app-framework/ar`, `…/ar/qr`, `…/core`, `…/state`, `…/sensors`, `…/storage`, `…/geo`, `…/visualization`, `…/utils`, `…/types`, `…/licensing`). The root barrel re-exports conflict-free names for convenience.

## Composing With Your Own Slices

`createSlamAppStore` is the headline composability seam. Your app plugs in its own reducers, middleware, and storage backend without forking the factory:

```typescript
import { createSlamAppStore } from 'gps-plus-slam-app-framework/state';
import { OpfsStorageBackend } from 'gps-plus-slam-app-framework/storage';
import { myUiReducer } from './state/ui-slice';
import { myAnalyticsMiddleware } from './state/analytics-middleware';

const store = createSlamAppStore({
  storageBackend: new OpfsStorageBackend(),
  extraReducers: { ui: myUiReducer },
  extraMiddleware: [myAnalyticsMiddleware],
  onWriteFailure: (err) => myErrorReporter(err),
  enableDevChecks: import.meta.env.DEV,
  // licenseKey: 'paid-key-here'  // omit to use the bundled community key
});
```

- `storageBackend` — **Required.** Bridge from Redux actions to durable storage. Use `NullStorageBackend` for tests/replay, `OpfsStorageBackend` for browser recording.
- `extraReducers` — Caller-supplied reducers added alongside the framework's built-ins (`gpsData`, `gpsElements`, `arElements`, `recording`).
- `extraMiddleware` — Caller-supplied middlewares appended after RTK defaults and the persistence middleware.
- `onWriteFailure` — Invoked when the persistence middleware fails to durably write an action.
- `enableDevChecks` — Toggle RTK's expensive dev-only Serializable / Immutable checks. Default `true`; set `false` for high-throughput replay.
- `licenseKey` — Override the bundled community key with a paid license. Validation always runs.

## Recording & Replay

Out of the box the framework lays out durable storage like this when you use `OpfsStorageBackend`:

```
/gps-plus-slam/
  └── sessions/
        └── recording-{timestamp}/
              ├── actions/   (one JSON file per recorded Redux action)
              ├── frames/    (captured camera/depth frames)
              └── session.json
```

Key APIs:

- `exportSessionAsZip(sessionHandle, { contributors? })` — bundle a recorded session into a ZIP blob.
- `replayRecording(store, blob)` — feed a ZIP recording back into a store.
- `loadActionsFromZip(blob)` / `loadEntriesFromSubdir(blob, subdir)` — read recorded actions or any contributor-defined ZIP subdirectory.

### Adding Your Own ZIP Sections (`ZipExportContributor`)

Apps that need to ship extra data alongside the standard recording (e.g., the recorder app stores `refPoints/` this way) implement a `ZipExportContributor`:

```typescript
import {
  exportSessionAsZip,
  type ZipExportContributor,
} from 'gps-plus-slam-app-framework/storage';

const refPointsContributor: ZipExportContributor = {
  subdir: 'refPoints',
  contribute: async (addFile) => {
    addFile('points.json', JSON.stringify(myRefPoints));
  },
};

const blob = await exportSessionAsZip(sessionHandle, {
  contributors: [refPointsContributor],
});
```

## Scene-Graph Convention

The framework's WebXR scene is laid out so that the **scene root is GPS-aligned (NUE) space**:

```
scene                             ← GPS-aligned (NUE) space, the scene root
├── arWorldGroup                  ← carries the alignment matrix (GPS → AR)
│   ├── camera                    ← WebXR XRViewerPose (raw AR pose)
│   └── ar-content                ← anything fixed in AR space
│                                   (planes, point clouds, hit-test reticles, …)
└── ..objects with gps coords..   ← anything anchored to GPS coordinates
                                    (waypoints, POIs, navigation arrows, …)
```

When the alignment solver produces a new matrix, the framework writes it to `arWorldGroup.matrix` (smoothly lerped — see `enableArWorldGroupAlignment` below). The camera moves with `arWorldGroup`; objects parented directly to `scene` do not.

> **Apply alignment to `arWorldGroup` — the framework default.** Call
> [`enableArWorldGroupAlignment({ store, arWorldGroup })`](https://github.com/cs-util-com/location-based-webxr/blob/main/GpsPlusSlamJs_AppFramework/src/visualization/ar-world-group-alignment.ts.md)
> once after AR starts. It subscribes to the store's alignment matrix, lerps it
> onto `arWorldGroup.matrix` each frame, and thereby **GPS-registers the view**:
> the camera and every object parented under `arWorldGroup` (including GPS
> anchors) shift together as alignment refines, so anchors stay stable in the AR
> overlay and only ever correct a small residual. The recorder wires its own
> lerper; the simpler apps use this helper. Forgetting it leaves the camera
> pure-VIO and forces each anchor to absorb the full alignment delta on every
> re-registration.

**Three options for placing your own `Object3D`:**

1. **Add it to `scene`** (with NUE-meter coordinates from `calcRelativeCoordsInMeters(zeroRef, …)`, importable from `gps-plus-slam-app-framework/core`). The object's world pose stays at the correct latitude/longitude/altitude forever, but every time the alignment matrix is corrected the camera shifts inside `arWorldGroup`, so from the user's AR view the object visually "floats". Cheap and correct, but ugly during corrections — fine for small markers (e.g. ref-point spheres), not great for richer GPS-anchored content.
2. **Add it to `arWorldGroup`** with a fixed local transform. The object is frozen relative to AR-tracked content and stays visually fixed at the same 3D position for this session. This is a good fit for user-created local content such as a walked path, a temporary marker, a hit-test reticle, or an object the user placed by hand. The tradeoff is that its world / GPS pose drifts every time alignment is corrected, so this mode is not enough when the object must be replayed or shared by GPS coordinate.
3. **Use `createGpsAnchor` for objects that should stay visually stable at a GPS target.** The anchor owns a single `Object3D` **inside `arWorldGroup`** (the factory throws if `object3D` is not a descendant of the `arWorldGroup` you pass — placing an anchor under the scene root defeats AR stability), bootstraps from median samples unless `skipBootstrap` is set, and re-derives the object's local pose from the current GPS target and alignment state each tick. Because the object rides the (lerped) `arWorldGroup` alignment, its motion relative to the camera between re-registrations is small. In the default `snap-when-offscreen` mode an accepted correction is committed **instantly** while the object is outside the camera frustum, making the (now small, residual) correction hard to notice; larger alignment jumps bypass that gate so the object does not stay in a stale location. Use `snap-every-tick` when correctness is more important than hiding visible position changes. Smoothing is **not** per-anchor: it lives once in the lerped `arWorldGroup.matrix` (`enableArWorldGroupAlignment`), so the whole AR world eases together. This is how the MinimalExample and AnchorStarter get the smooth alignment feel.

A pure-function `syncGpsAnchoredMeshes` reconciler (option 1, bulk markers) is shipped by the RecorderApp. Use `createGpsAnchor` when a single visible object, route cue, or POI needs the more careful bootstrap and correction policy.

> **Worked example.** The [`GpsPlusSlamJs_MinimalExample`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_MinimalExample) ports the stock three.js `webxr_ar_hittest` example onto this convention and ends in a deliberate side-by-side **contrast demo**: a tap co-spawns an option-1 floater under `scene` and an option-3 `createGpsAnchor` marker under `arWorldGroup` at the same world pose, so the drift difference is visible. It is the canonical reference for options 1–3 and for the `registerXrFrameUpdate` + Enable-GPS-AR seams below.

## DOM-Overlay / HUD stacking convention

`initAR(container)` requests the WebXR **`dom-overlay`** feature with
`domOverlay.root = container` — the **same element you pass in**. During an
`immersive-ar` session the browser composites **only that element's subtree**
over the camera feed; everything else on the page is hidden until the session
ends.

> **The rule:** every HUD / overlay / button you want visible **in AR** must be
> a **DOM descendant of the element you pass to `initAR`**. A sibling overlay
> works in the 2D pre-AR layout but silently disappears the moment AR starts —
> a failure that only shows up on real AR hardware, never in a headless test.

This is **not** a `z-index` problem; `z-index`/`pointer-events` only govern the
2D (pre-AR) layout. Nesting is what determines in-AR visibility.

```html
<!-- ✅ Correct: HUD is inside the initAR container -->
<div id="app">
  <!-- three.js canvas is injected here by initAR -->
  <div id="hud">…</div>
</div>

<!-- ❌ Wrong: HUD is a sibling — it vanishes once AR starts -->
<div id="app"></div>
<div id="hud">…</div>
```

```js
await initAR(document.getElementById('app')!); // #app's subtree = the overlay root
```

A repo-meta guard (`tests/repo-config/hud-overlay-nesting.test.js`) asserts this
structurally for every app's `index.html`, so a new app that authors its overlay
as a sibling fails CI instead of failing silently in the field.

## Modules

Each heading below matches an import subpath (`gps-plus-slam-app-framework/<name>`). The lists name the primary exports; the barrels also export the accompanying TypeScript types.

### `ar/` — WebXR & 3D Scene

WebXR session lifecycle, Three.js renderer setup, image/depth capture, occupancy reconstruction, and replay scene management. Re-exports everything from [`ar/qr`](#arqr--qr-detection-pose--geo-voting).

- **Session lifecycle**
  - `initAR(container, isolationOptions?, features?, callbacks?)` — Start a WebXR AR session with Three.js rendering. `features.requestHitTest` opts the session into the WebXR `hit-test` feature. `callbacks` (`ArSessionCallbacks`) carries ALL per-session host callbacks — `imageCapture`, `tracking` (store + callbacks together), `depth`, `cameraFrame`, `onFrame`, `onSessionEnd`; re-pass it with each session (cleared at session end).
  - `endARSession()` — End the active XR session.
  - `rebindTrackingStore(store)` — The one mid-session need: swapping the tracking store per recording.
  - `createEnableGpsArController()` — Headless "Enable GPS AR" orchestration (support check + permission bundling + sensor watches + `initAR`) with observable state; the app renders its own button over it.
  - `getScene()` / `getArWorldGroup()` / `getCamera()` / `getCurrentArPose()` — Access the live scene graph and pose (see [Scene-Graph Convention](#scene-graph-convention)).
  - `SCENE_NODE` — Canonical scene-node names.
- **Capability gating & diagnostics**
  - `isFullySupported(s)` / `capabilityMessage(s)` — WebXR + geolocation capability gating plus a user-facing message.
  - `probeImmersiveArSupport()` / `probeImmersiveArSupportOutcome()` — Timeout-guarded `immersive-ar` support probe.
  - `getXrErrorMessage(err)` — Human-readable XR error messages.
  - `applyChromiumProjectionLayerWorkaround` — Chromium camera-access tab-crash workaround. Always deletes projection-layer hooks (forces `XRWebGLLayer`; required on every affected build incl. Chrome 150) and additionally persists `baseLayer` only on the affected Chrome window (148.0.7778.12 up to 149.0.7821).
  - `validateArCrashIsolationOptions` / `DEFAULT_AR_CRASH_ISOLATION` — XR session-negotiation diagnostic flags.
- **Frame loops**
  - `registerXrFrameUpdate(cb)` — Per-frame access to the live `XRFrame` + reference space + session (valid only synchronously inside the callback). Enables app-side hit-test / other WebXR features.
  - `registerFrameUpdate(cb)` — Renderer-tick callback without XR specifics.
  - `startHitTestReticle(args)` — Turnkey hit-test reticle driver.
- **Camera & image capture**
  - `startImageCapture()` / `stopImageCapture()` / `getImageCaptureFrameCount()` — Toggle and inspect camera frame capture.
  - `ImageCaptureManager` — Configurable camera frame capture pipeline.
  - `CameraBlitCapture` — GPU blit-based camera capture.
  - `CameraFrameSource` — Generic throttled RGBA feed for computer vision.
  - `acquireCameraTexture(...)` — Raw WebXR camera texture access.
  - `ImageQualityGate`, `sharpnessScore`, `highFrequencyEnergyRatio`, `meanLuminance`, `rgbaToGrayscale` — Pure blur/blackness metrics plus the drop/retry verdict policy.
  - `createCaptureFailureTracker(config)` — Warn when capture failures cross a threshold.
- **Depth & occupancy**
  - `DepthSampler` — Depth buffer sampling with configurable grids.
  - `startDepthCapture()` / `stopDepthCapture()` / `getDepthSampleCount()` — Depth capture lifecycle.
  - `unprojectDepthPoint` / `createDepthUnprojector` / `createDepthGridLookup` — Depth → 3D point helpers.
  - `OccupancyGrid` — Voxel occupancy accumulated from the depth stream.
  - `meshOccupiedCells(cells, options)` — Sparse voxel set → face-culled surface + AABB list.
  - `bresenham3d(...)` — Voxel ray traversal.
- **Replay scene**
  - `initReplayScene(container)` / `disposeReplayScene()` — Create and tear down a 3D replay scene with orbit/FPS controls.
  - `getReplayState()` / `getCameraMode()` / `toggleCameraMode()` / `updateOrbitTarget()` / `getCameraFollower()` / `getAlignmentLerper()` — Replay scene controls.
- **Constants**
  - `WEBXR_TO_NUE` — The WebXR → NUE basis change.

### `ar/qr` — QR Detection, Pose & Geo Voting

Everything needed to turn a printed QR code into a high-precision position observation: detection, pure-JS planar PnP pose solving (no OpenCV), physical-size measurement from the depth map, sliding-window pose stabilization, and GPS voting. See [Zero-Install Onboarding](#zero-install-onboarding) for why this exists, and the [QR-tracking demo](https://gps.csutil.com/qr-demo/) for a live view.

- **Detection**
  - `BarcodeDetectorFrontEnd` / `createBarcodeDetectorFrontEnd()` — QR front end over the native `BarcodeDetector`.
  - `createQrDetectionController(deps)` — The thin, geo-less producer of raw QR observations.
  - `createQrTrackingController(config)` — Higher-level tracking controller with status reporting.
  - `createDetectionScheduler(config)` — Duty-cycle scheduler so detection does not run on every frame (`createQrDetectionScheduler` is the back-compat alias).
- **Pose solving**
  - `solveQrPose(input)` — Solve a QR's 6-DoF pose from its four detected corners.
  - `PlanarPnpSquare` — Pure-JS IPPE planar PnP; the OpenCV-free `SolvePnpSquare` implementation.
  - `ippePoseCandidates`, `homographyFromCorrespondences`, `nearestRotation3x3`, `rotationToRodrigues`, `solveLinear` — The planar-PnP building blocks.
  - `buildObjectPoints`, `intrinsicsFromProjection`, `projectViewPoint`, `composePose`, `invertPose`, `transformPoint` — Pose/intrinsics math helpers.
  - `validateQuad`, `signedQuadArea`, `reprojectionErrorPx` — Quad sanity checks and residual scoring.
- **Physical size from depth**
  - `estimateQrSizeFromDepth(...)` / `createQrSizeAccumulator(options)` — Measure the code's real-world edge length from the depth map instead of hard-coding it.
  - `createQrSizeMeasurer(...)` / `createQrSizeDepthContext(...)` — The shared depth → size pieces.
- **Stability & derived placement**
  - `aggregateQrPose(...)` / `averageRotation(...)` / `evaluateQrPoseStability(...)` — Sliding-window pose stabilization and a stability verdict.
  - `deriveQrPlacement(...)`, `deriveSolvedQrPose(...)`, `deriveQrSizeM(...)`, `solveQrPoseFromObservation(...)`, `createIncrementalQrPlacement(...)` — Derive size/pose from raw observations on read.
  - `checkQrPlausibility(...)` — Reject poses that contradict the occupancy surface.
- **Geo integration & tooling**
  - `buildQrGpsVotes(input)` — Turn a solved marker pose plus a known marker geo-pose into GPS observations for the fusion pipeline.
  - `localPlaneToEnu(...)` / `offsetGeo(...)` — Local-plane ↔ ENU/geo conversions.
  - `parseQrLevel(...)` / `fetchQrLevel(...)` — Load and validate a QR "level" descriptor (marker layout + geo poses).
  - `createQrDebugView()` — Shared 3D debug axis + cube overlay for a detected code.

### `sensors/` — GPS, Orientation & Permissions

- **GPS**
  - `startGpsWatch(onPos, onErr)` / `stopGpsWatch()` — Start and stop watching GPS position.
  - `getGpsErrorMessage(code)` — Human-readable GPS error messages.
  - `createGpsErrorHandler()` — GPS error callback with deduplicated logs.
- **Orientation**
  - `startOrientationWatch(cb)` / `stopOrientationWatch()` — Device orientation events.
  - `startAbsoluteOrientationWatch(...)` / `stopAbsoluteOrientationWatch()` / `getLatestAbsoluteOrientation()` / `isAbsoluteOrientationAvailable()` — `AbsoluteOrientationSensor` capture where the platform supports it.
- **Permissions**
  - `checkAllPermissions()` / `requestAllPermissions()` — Probe or request camera, GPS, and XR permissions together.
  - `requestWebXRWithDepthPermission()` — Combined XR + depth permission prompt.
  - `checkGeolocationPermission()`, `checkCameraPermission()`, `checkOrientationPermission()`, `checkWebXRSupport()`, `checkFileSystemPermission()` (and their `request*` counterparts) — Individual probes.

### `state/` — Store, Recording & Replay

- **Store factory**
  - `createSlamAppStore(options)` — Composable store factory (see the options list above).
  - `createPersistenceMiddleware(options)` — Middleware factory used internally by `createSlamAppStore`.
  - `wireStoreSubscribers(store, deps)` — Bridge store state → visualization updates.
  - `subscribeToSelector(store, selector, cb)` — Selector-scoped store subscription.
- **Recording**
  - `recordingReducer` — Recording lifecycle slice (built into the factory).
  - `startSession()` / `endSession()` / `recordDepthSample()` / `recordWriteFailure()` — Recording lifecycle actions.
  - `recordGpsEvent(payload)` — Record a paired AR+GPS observation.
  - `setZeroPos(...)` / `add2dImage(...)` — Core-library actions re-exported for convenience.
  - `createGpsPositionHandler(config)` — Factory that adapts `GeolocationPosition` to a store dispatch.
  - `buildRawGpsPoint(...)` / `buildRecordGpsEventPayload(...)` / `updateDeviceOrientation(...)` / `eulerToQuaternion(...)` — The pure pieces behind that handler.
  - `captureGpsAnchorSample(options)` — Sample a paired AR pose + GPS point for anchoring.
- **Replay**
  - `replayRecording(store, blob)` — Replay a ZIP recording into a store.
  - `ReplayEngine` — Lower-level timed action playback with pause/resume/speed.
  - `extractActionTimestamp(...)` / `computeInterActionDelay(...)` — Replay timing helpers.
  - Deep-import `…/state/replay-session` and `…/state/replay-occupancy-subscriber` for the desktop-replay composer — deliberately kept out of this barrel so that importing `state` does not eagerly pull in the AR/scene stack.
- **Tracking state**
  - `trackingReducer`, `poseReceived`, `poseLost`, `originReset`, `resetTracking` — The AR tracking state machine.
  - `selectTrackingPhase`, `selectLastValidPose`, `selectLostFrameCount`, `selectLastSensorOrientation` — Tracking selectors.
- **Tracking quality & onboarding**
  - `trackingQualityReducer`, `createTrackingQualityListenerMiddleware(...)`, `computeTrackingQualityReport(...)` — Convergence, residual consensus, GPS accuracy, coverage, and GPS-vs-fused divergence metrics.
  - `selectTrackingQuality` / `selectRecentAlignments` — Quality selectors.
  - `computeOnboardingGuidance(...)` / `selectOnboardingGuidance` — Derive "keep walking / you're good" guidance from the current alignment phase.
- **QR slice (opt-in)**
  - `qrDetectedReducer` — Wire it yourself via `extraReducers: { qrDetected: qrDetectedReducer }`; it is not a built-in of `createSlamAppStore`.
  - `recordQrDetection`, `recordQrSizeEstimate`, `pruneQrDetections`, `clearQrMarker`, `clearAllQrMarkers`, `setQrMaxHistory` — Actions.
  - `selectQrMarkers`, `selectStableQrPose`, `selectDerivedQrPlacement`, `selectResolvedQrSizeM`, `selectQrPoseStability`, … — Selectors.
- **Selectors over the fused state**
  - `selectAlignmentMatrix`, `selectGpsPositions`, `selectOdometryPositions`, `selectOdometryRotations`, `selectZeroReference`, `selectFrameTilesInWebXR`.

### `storage/` — OPFS, ZIP, File System

- **Backends**
  - `StorageBackend` — Abstract storage interface (implement your own).
  - `OpfsStorageBackend` — OPFS-based `StorageBackend`.
  - `NullStorageBackend` — No-op backend for tests and replay.
- **OPFS sessions**
  - `initOpfsStorage()` — Initialize the OPFS file-system layer.
  - `createSession()` / `listSessions()` / `getSessionHandle(...)` — Session lifecycle on disk.
  - `writeSessionMetadata(...)` / `checkStorageQuota()` — Metadata and quota.
  - `formatTimestamp`, `formatActionFilename`, `formatFrameFilename` — Canonical on-disk naming.
- **ZIP export**
  - `exportSessionAsZip(handle, { contributors })` — Export a recording session as a ZIP blob.
  - `ZipExportContributor` — Hook for adding your own ZIP subdirectories on export.
  - `syncToExternalZip(...)` / `downloadZip(...)` — Write out to an external file handle or trigger a download.
  - `embedCoverageInSessionJson(...)` — Embed H3 coverage cells into `session.json`.
- **ZIP import**
  - `loadActionsFromZip(blob)` — Parse recorded actions from a ZIP file.
  - `loadEntriesFromSubdir(blob, subdir)` — Read entries written by a contributor on import/replay.
  - `loadSessionMetadataFromBlob(blob)` / `loadGpsPathFromBlob(blob)` / `readZipEntries(blob)` — Metadata, GPS path, raw entries.

### `geo/` — H3 Spatial Indexing

H3-based proximity matching for GPS-anchored points.

- `gpsToH3(lat, lon)` — Convert GPS coordinates to an H3 cell index.
- `findNearbyGeoAnchor(h3, known)` — Find a known geo-anchored point near an H3 cell.
- `h3CellsMatch(a, b)` / `isH3Index(value)` — Compare indices; type guard.
- `approxDistanceMetres(a, b)` — Approximate distance between two `LatLong`s.
- `gpsPathToCoverageCells(path)` — Turn a recorded GPS path into the set of cells it covers.
- `clusterCellsByZoom(cells, zoom)` — Coarsen cells for map display (via H3 parents, never string truncation).
- `H3_RESOLUTION` — The H3 resolution used (default: 12, ~10 m cells).

### `visualization/` — Three.js & Maps

- **Alignment**
  - `enableArWorldGroupAlignment(options)` — Subscribe the `arWorldGroup` to the store's alignment matrix and lerp it each frame. **Call this once after AR starts** (see [Scene-Graph Convention](#scene-graph-convention)).
  - `createAlignmentLerper()` — The lower-level smooth alignment-matrix interpolation.
  - `clampedAlpha(...)` / `DEFAULT_LERP_RATE` — Frame-rate-independent lerp helpers.
- **Placement**
  - `createGpsAnchor(options)` — GPS-anchored placement helper for one Three.js object.
  - `nueToArLocal(...)` / `worldNueToGps(...)` — Frame conversions between GPS-aligned NUE space and AR-local space.
  - `createReticleMesh()` / `updateReticle(...)` — Hit-test reticle.
  - `pointerToNdc(...)` / `raycastPointer(...)` / `pickWorldPoint(...)` — Engine-free desktop raycast helpers.
- **Wayfinding HUD**
  - `createWayfindingHud(options)` / `validateWayfindingHudOptions(...)` — Frustum-locked target indicators (edge arrows for off-screen targets, on-screen rings, distance labels, hysteresis deadband) parented to the camera.
  - `computeTargetPlacement(...)` / `formatDistanceLabel(...)` / `getHudFrustumExtents(...)` — The pure seam the HUD is built on.
- **Occupancy & occlusion**
  - `OcclusionMesh` — Persistent depth-only occluder built from the occupancy grid, so real geometry hides virtual content.
  - `OccupancyCubesVisualizer` / `pickNearestSubset(...)` — Instanced debug cubes of the occupancy grid.
- **Markers & overlays**
  - `GpsEventVisualizer` — Three.js spheres for GPS event positions.
  - `createGpsCompassCubes()` — Cardinal direction indicator cubes.
  - `createTextSprite(options)` — Canvas-backed text sprite.
  - `createCss3dRendererManager()` — CSS3D renderer for HTML-in-3D overlays.
  - `LeafletMapOverlay` — 2D Leaflet map integrated via CSS3D into a 3D scene (needs the optional `leaflet` peer).
  - `buildMapData(input)` / `drawMapData(map, data, options)` / `addAccuracyCircles(...)` — Shared trajectory model and drawing routine (raw GPS, fused path, alignment snapshots, per-event accuracy circles).
  - `createPerfStatsOverlay(options)` — Shared Stats.js FPS/MS/MB panel row.
- **Camera & housekeeping**
  - `createCameraFollower()` — Camera that tracks a moving target.
  - `buildCameraFrustum(...)`, `isObjectInCameraFrustum(...)`, `isPointInCameraFrustum(...)`, `isSphereInCameraFrustum(...)` — Visibility tests (used by the anchor's off-screen correction gate).
  - `disposeObject3D(obj)` / `disposeMeshArray(meshes)` — Safe Three.js disposal.
  - `VIS_COLORS` — Consistent color palette for visualizations.

### `core/` — Curated Re-Exports of the Alignment Core

A curated, framework-blessed surface over the closed-source `gps-plus-slam-js`, so apps need only **one** direct npm dependency and coordinated releases only have to move the framework's dependency range. Includes the coordinate transforms (`webxrToNUE`, `calcGpsCoords`, `calcRelativeCoordsInMeters`, `isIdentityMatrix4`) and the absolute-orientation heading kernels (`magneticHeadingFromEnuQuat`, `arNorthBearingDeg`).

> The core's `RootState` type is re-exported here as both `RootState` and `LibraryRootState`, because the framework also exports a `RootState` for its own store shape. Import `LibraryRootState` when you need to disambiguate. Library-only consumers (no framework) can still depend on `gps-plus-slam-js` directly.

### `utils/` — Logging & Helpers

- `createLogger(channel)` — Channeled logger with level control.
- `getLogBuffer()` / `clearLogBuffer()` / `subscribeToLogs()` / `setGlobalLogLevel()` — Inspect, subscribe to, or configure the in-memory log ring.
- `computeFusedPath(inputs)` / `fusedGpsFromOdom(...)` — Compute a fused GPS+odometry path.
- `createFailureTracker(config)` — Track failure rates with configurable thresholds.
- `mapWithConcurrencyLimit(items, fn, limit)` — Async map with bounded concurrency.
- `geodesicAngleRad(a, b)` — Great-circle angle between two points.
- `formatFileSize(bytes)` / `listFormatter(items)` — Human-readable sizes and comma/and lists.
- `validateOptionFields(spec, values)` — Validation for persisted option catalogs.

### `types/` — Shared Type Definitions

AR and geo type definitions (`DepthPoint`, `DepthSample`, `LatLong`, `KnownGeoAnchor`, …) used across modules.

### `licensing/` — Bundled Community Key

Re-exports `COMMUNITY_LICENSE_KEY` from the core library so that consumers can pass it explicitly if they need to. `createSlamAppStore` already uses it as the default.

## Examples & Demos

All of these are deployed at **<https://gps.csutil.com>** — open them on a WebXR-capable phone. The example ladder is **trivial** → **starter** → **full**:

- [`GpsPlusSlamJs_MinimalExample`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_MinimalExample) ([live](https://gps.csutil.com/minimal/)) — the smallest possible consumer. A single-file GPS + AR hit-test demo (Enable GPS AR button → reticle → tap-to-place) that contrasts an uncompensated floater cube with a drift-corrected `createGpsAnchor` marker. Use this as your starting template.
- [`GpsPlusSlamJs_AnchorStarter`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_AnchorStarter) ([live](https://gps.csutil.com/starter/)) — the "meaningful minimal" rung: GPS-anchored placement with URL-based persistence (`?show=`) so an anchor survives a reload and can be shared across devices.
- [`GpsPlusSlamJs_RecorderApp`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_RecorderApp) ([live](https://gps.csutil.com/recorder/)) — the full-featured reference app: capture AR sessions on a phone, export the session as a self-contained ZIP, replay it on a desktop with full 3D scene reconstruction, and debug alignment quality.

Focused demos of individual framework capabilities:

- [`GpsPlusSlamJs_QrTrackingDemo`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_QrTrackingDemo) ([live](https://gps.csutil.com/qr-demo/)) — [`ar/qr`](#arqr--qr-detection-pose--geo-voting) end to end: detect any printed QR, measure its physical size from the depth map, and glue a pose overlay to it.
- [`GpsPlusSlamJs_PhysicsDemo`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_PhysicsDemo) ([live](https://gps.csutil.com/physics/)) — physics balls bounce off the reconstructed occupancy mesh of a real space, live in AR or against a replayed recording on the desktop.
- [`GpsPlusSlamJs_WayfindingHudDemo`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_WayfindingHudDemo) ([live](https://gps.csutil.com/wayfinding/)) — the wayfinding HUD: edge arrows for off-screen targets, on-screen rings, live distance labels, and the anti-flicker hysteresis deadband. Runs in AR on a phone or as a WASD walk simulator on the desktop.

[`GpsPlusSlamJs_ExampleRecordings`](https://github.com/cs-util-com/location-based-webxr/tree/main/GpsPlusSlamJs_ExampleRecordings) holds real-world session ZIPs you can load into the recorder or the physics demo without going outside first.

## Design Principles

1. **No global singletons.** Everything is created via factories and passed explicitly.
2. **Store is the integration point.** Modules communicate through Redux state.
3. **Modules are optional.** Use `initAR` without `LeafletMapOverlay`. No forced coupling.
4. **Swappable implementations.** The `StorageBackend` interface lets you replace OPFS with IndexedDB or anything else.

## Development

```bash
cd GpsPlusSlamJs_AppFramework
pnpm install
pnpm test          # format + lint + typecheck + unit tests
pnpm run build     # build with tsdown
```

### Project Structure

```
src/
├── ar/             # WebXR session, capture, occupancy, replay scene
│   └── qr/         # QR detection, pose (planar PnP), size-from-depth, GPS vote
├── core/           # Curated re-exports of the closed-source alignment core
├── sensors/        # GPS, orientation, permissions
├── state/          # createSlamAppStore, recording, replay, persistence middleware
├── storage/        # OPFS, ZIP export/import, StorageBackend
├── geo/            # H3 spatial indexing
├── visualization/  # Three.js markers, maps, HUD, camera helpers
├── utils/          # Logger, fused-path, concurrency, formatters
├── types/          # Shared type definitions
├── licensing/      # Bundled community license key
└── test-utils/     # Test helpers (browser mocks, ZIP helpers)
```

## License

This framework is licensed under **Apache 2.0** — see [LICENSE](https://github.com/cs-util-com/location-based-webxr/blob/main/LICENSE).

> **Note:** This package depends on [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js), which is a **closed-source, proprietary** library distributed via npm under a separate license. A free community license key is bundled with the framework so you can start building right away — no signup or API key required. See the core library's EULA for the full terms.

## See Also

- [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js) — Core alignment algorithms (closed-source)
- [Live demos](https://gps.csutil.com) — every example app, deployed
- [Source repository](https://github.com/cs-util-com/location-based-webxr) — framework, example apps, and the landing page
- [Examples & Demos](#examples--demos) — the example ladder and the focused capability demos
