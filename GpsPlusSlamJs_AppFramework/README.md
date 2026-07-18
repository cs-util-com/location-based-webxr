# GPS+SLAM App Framework

[![npm version](https://img.shields.io/npm/v/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![npm downloads](https://img.shields.io/npm/dm/gps-plus-slam-app-framework.svg)](https://www.npmjs.com/package/gps-plus-slam-app-framework)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/gps-plus-slam-app-framework.svg)](https://nodejs.org/)

Reusable building blocks for AR+GPS web apps, built on top of the closed-source [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js) alignment core.

It is part toolkit, part fusion engine: the toolkit covers the AR + GPS plumbing every app needs anyway, and the fusion engine lifts location accuracy to the point where ideas that previously sat on the "someday, on native" shelf become reachable in a browser:

- A **WebXR + Three.js scene** with image and depth capture, replay rendering, and tracking-state monitoring.
- **GPS, orientation, and permission wiring** ready to plug into the store.
- **OPFS + ZIP record & replay** with a `StorageBackend` interface you can swap.
- A **composable Redux store factory** (`createSlamAppStore`) that combines the core library's reducers with your own slices.

## Why use GPS+SLAM? (Visual Stability Beyond Raw GPS)

Raw GPS is useful for getting near a place, but it still jitters by meters and altitude is usually the hardest channel to trust. Most location-based AR apps work around that with broad proximity zones, floating beacons, or oversized highlights — fine as a fallback, but limiting if you want content that sits exactly on a path, a wall, or a specific spot on the ground.

GPS+SLAM fuses GPS observations with the device's AR odometry, so as the user moves the alignment between the AR world and real-world coordinates gets more stable. On top of that, the framework gives you placement helpers for objects that should stay tied to a real location:

- **Alignment improves with motion:** Once the user has walked for roughly 15 seconds in representative outdoor conditions, the solver has enough baseline that visible drift drops well below raw GPS. How stable it actually feels still depends on the device, the environment, and how clean the GPS track is — but in our own outdoor tests it consistently held up well enough for content that needs to sit on a specific spot.
- **VPS-like benefits without a VPS dependency:** Cloud visual-positioning systems can work well, but they usually require network access and a provider-maintained scan of the place where the user stands. GPS+SLAM localizes from the device's own GPS, camera tracking, motion, and orientation sensors, so the same alignment approach works in rural areas, woods, mountains, and private sites that no VPS provider has pre-scanned.
- **Just a URL, no app install:** The whole experience runs in the mobile browser through WebXR, so end users open a link and are in AR within seconds. There is no app-store gate, no native build per platform, and authors can iterate on the live URL while users keep using the same link.
- **Heading does not depend only on the compass:** Phone compass data can be noisy, biased, or temporarily wrong enough to make a naive AR overlay rotate in the wrong direction. GPS+SLAM can infer the world heading from how the user actually moves through space, so after the user has walked a few meters the overlay no longer has to trust the device-orientation readings.
- **Session-local objects stay fixed:** Objects created directly in the AR scene can stay at the same 3D position for the current session, independent of later GPS alignment updates. This is ideal for content the user creates live, such as a 3D trail of the path they walked, temporary markers, or objects they place by hand in the world.
- **Anchors make placed content shareable:** When an object should also be tied to a GPS coordinate for replay, persistence, or sharing with other users, `createGpsAnchor` bootstraps from median GPS samples, keeps the Three.js object positioned from its GPS target inside `arWorldGroup`, and can defer small corrections until the object is off-screen. Large alignment jumps still force a correction so content does not remain in a stale location.
- **Use exact paths and POIs, not only blobs:** Proximity zones remain a good UX for letting users enter an experience from any direction, but they do not have to be the only interaction model. The framework is designed for route-following cues, authored POI objects, precise areas of interest, and other content that benefits from being visibly tied to a real-world path or location.

Don't take any of this on trust. Because everything runs in the browser, the fastest review is to open one of the example URLs on your own phone, step outside, drop an object, walk around it, and judge for yourself whether the stability holds up for your use case.

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
pnpm add gps-plus-slam-app-framework gps-plus-slam-js
```

### Runtime Dependencies

These are pulled in automatically — you do not need to install them yourself:

- `@reduxjs/toolkit`
- `gl-matrix`
- `gps-plus-slam-js`

### Peer Dependencies

Required (install in your app):

- `three` (>= 0.170.0)
- `@zip.js/zip.js` (>= 2.7.0)
- `h3-js` (>= 4.0.0)

Optional:

- `leaflet` (>= 1.9.0) — only needed if you use `LeafletMapOverlay`
- `@sentry/browser` (>= 10.0.0) — only needed if you wire Sentry error reporting

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

See [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/) for a complete, runnable smallest-possible consumer (Three.js scene + status panel, no AR, no recording). For the next rung up — a readable AR + GPS + persistence demo (a single GPS anchor that survives a page reload) — see [`GpsPlusSlamJs_AnchorStarter`](../GpsPlusSlamJs_AnchorStarter/). The example ladder is **trivial** (MinimalExample) → **starter** (AnchorStarter) → **full** (RecorderApp).

> **Imports.** Prefer subpath imports (`gps-plus-slam-app-framework/ar`, `…/state`, `…/sensors`, `…/storage`, `…/geo`, `…/visualization`, `…/utils`, `…/types`, `…/licensing`). The root barrel re-exports conflict-free names for convenience.

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

| Option            | Purpose                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storageBackend`  | **Required.** Bridge from Redux actions to durable storage. Use `NullStorageBackend` for tests/replay, `OpfsStorageBackend` for browser recording. |
| `extraReducers`   | Caller-supplied reducers added alongside the framework's built-ins (`gpsData`, `gpsElements`, `arElements`, `recording`).                          |
| `extraMiddleware` | Caller-supplied middlewares appended after RTK defaults and the persistence middleware.                                                            |
| `onWriteFailure`  | Invoked when the persistence middleware fails to durably write an action.                                                                          |
| `enableDevChecks` | Toggle RTK's expensive dev-only Serializable / Immutable checks. Default `true`; set `false` for high-throughput replay.                           |
| `licenseKey`      | Override the bundled community key with a paid license. Validation always runs.                                                                    |

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
> [`enableArWorldGroupAlignment({ store, arWorldGroup })`](src/visualization/ar-world-group-alignment.ts.md)
> once after AR starts. It subscribes to the store's alignment matrix, lerps it
> onto `arWorldGroup.matrix` each frame, and thereby **GPS-registers the view**:
> the camera and every object parented under `arWorldGroup` (including GPS
> anchors) shift together as alignment refines, so anchors stay stable in the AR
> overlay and only ever correct a small residual. The recorder wires its own
> lerper; the simpler apps use this helper. Forgetting it leaves the camera
> pure-VIO and forces each anchor to absorb the full alignment delta on every
> re-registration.

**Three options for placing your own `Object3D`:**

1. **Add it to `scene`** (with NUE-meter coordinates from `calcRelativeCoordsInMeters(zeroRef, …)`). The object's world pose stays at the correct latitude/longitude/altitude forever, but every time the alignment matrix is corrected the camera shifts inside `arWorldGroup`, so from the user's AR view the object visually "floats". Cheap and correct, but ugly during corrections — fine for small markers (e.g. ref-point spheres), not great for richer GPS-anchored content.
2. **Add it to `arWorldGroup`** with a fixed local transform. The object is frozen relative to AR-tracked content and stays visually fixed at the same 3D position for this session. This is a good fit for user-created local content such as a walked path, a temporary marker, a hit-test reticle, or an object the user placed by hand. The tradeoff is that its world / GPS pose drifts every time alignment is corrected, so this mode is not enough when the object must be replayed or shared by GPS coordinate.
3. **Use `createGpsAnchor` for objects that should stay visually stable at a GPS target.** The anchor owns a single `Object3D` **inside `arWorldGroup`** (the factory throws if `object3D` is not a descendant of the `arWorldGroup` you pass — placing an anchor under the scene root defeats AR stability), bootstraps from median samples unless `skipBootstrap` is set, and re-derives the object's local pose from the current GPS target and alignment state each tick. Because the object rides the (lerped) `arWorldGroup` alignment, its motion relative to the camera between re-registrations is small. In the default `snap-when-offscreen` mode an accepted correction is committed **instantly** while the object is outside the camera frustum, making the (now small, residual) correction hard to notice; larger alignment jumps bypass that gate so the object does not stay in a stale location. Use `snap-every-tick` when correctness is more important than hiding visible position changes. Smoothing is **not** per-anchor: it lives once in the lerped `arWorldGroup.matrix` (`enableArWorldGroupAlignment`), so the whole AR world eases together. This is how the MinimalExample and AnchorStarter get the smooth alignment feel.

A pure-function `syncGpsAnchoredMeshes` reconciler (option 1, bulk markers) is shipped by the RecorderApp. Use `createGpsAnchor` when a single visible object, route cue, or POI needs the more careful bootstrap and correction policy.

> **Worked example.** The [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/) ports the stock three.js `webxr_ar_hittest` example onto this convention and ends in a deliberate side-by-side **contrast demo**: a tap co-spawns an option-1 floater under `scene` and an option-3 `createGpsAnchor` marker under `arWorldGroup` at the same world pose, so the drift difference is visible. It is the canonical reference for options 1–3 and for the `registerXrFrameUpdate` + Enable-GPS-AR seams below.

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
as a sibling fails CI instead of failing silently in the field. Add new apps to
that guard's `APP_OVERLAY_CONTRACTS` list.

## Modules

### `ar/` — WebXR & 3D Scene

WebXR session lifecycle, Three.js renderer setup, image/depth capture, replay scene management.

| Export                                                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initAR(container, isolation?, features?, callbacks?)` | Start a WebXR AR session with Three.js rendering. `features.requestHitTest` opts the session into the WebXR `hit-test` feature. `callbacks` (`ArSessionCallbacks`) carries ALL per-session host callbacks — `imageCapture`, `tracking` (store + callbacks together), `depth`, `cameraFrame`, `onFrame`, `onSessionEnd` — replacing the former pre-init setter exports; re-pass it with each session (cleared at session end). `rebindTrackingStore(store)` remains for the one mid-session need (swapping the tracking store per recording) |
| `endARSession()`                                       | End the active XR session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `createEnableGpsArController()`                        | Headless "Enable GPS AR" orchestration (support check + permission bundling + sensor watches + `initAR`) with observable state; the app renders its own button over it                                                                                                                                                                                                                                                                                                                                                                      |
| `registerXrFrameUpdate(cb)`                            | Per-frame access to the live `XRFrame` + reference space + session (valid only synchronously inside the callback). Enables app-side hit-test / other WebXR features                                                                                                                                                                                                                                                                                                                                                                         |
| `isFullySupported(s)` / `capabilityMessage(s)`         | WebXR + geolocation capability gating + a user-facing message                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `startImageCapture()` / `stopImageCapture()`           | Toggle camera frame capture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `ImageCaptureManager`                                  | Configurable camera frame capture pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `DepthSampler`                                         | Depth buffer sampling with configurable grids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CameraBlitCapture`                                    | GPU blit-based camera capture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `initReplayScene(container)`                           | Create a 3D replay scene with orbit/FPS controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `applyChromiumProjectionLayerWorkaround`               | Chromium camera-access tab-crash workaround. Always deletes projection-layer hooks (forces `XRWebGLLayer`; required on every affected build incl. Chrome 150) and additionally persists `baseLayer` only on the affected Chrome window (148.0.7778.12 up to 149.0.7821)                                                                                                                                                                                                                                                                     |

### `sensors/` — GPS & Permissions

| Export                              | Description                               |
| ----------------------------------- | ----------------------------------------- |
| `startGpsWatch(onPos, onErr)`       | Start watching GPS position               |
| `stopGpsWatch()`                    | Stop GPS watch                            |
| `startOrientationWatch(cb)`         | Start device orientation events           |
| `checkAllPermissions()`             | Probe camera, GPS, XR permissions         |
| `requestAllPermissions()`           | Request all needed permissions            |
| `getGpsErrorMessage(code)`          | Human-readable GPS error messages         |
| `createGpsErrorHandler()`           | GPS error callback with deduplicated logs |
| `requestWebXRWithDepthPermission()` | Combined XR + depth permission prompt     |

### `state/` — Store & Recording

| Export                                 | Description                                                    |
| -------------------------------------- | -------------------------------------------------------------- |
| `createSlamAppStore(options)`          | Composable store factory (see options table above).            |
| `recordingReducer`                     | Recording lifecycle slice (built into the factory).            |
| `startSession()` / `endSession()`      | Recording lifecycle actions.                                   |
| `recordGpsEvent(payload)`              | Record a paired AR+GPS observation.                            |
| `createGpsPositionHandler(config)`     | Factory that adapts `GeolocationPosition` to a store dispatch. |
| `captureGpsAnchorSample(options)`      | Sample a paired AR pose + GPS point for anchoring.             |
| `replayRecording(store, blob)`         | Replay a ZIP recording into a store.                           |
| `ReplayEngine`                         | Lower-level timed action playback with pause/resume/speed.     |
| `createPersistenceMiddleware(options)` | Middleware factory used internally by `createSlamAppStore`.    |
| `wireStoreSubscribers(store, deps)`    | Bridge store state → visualization updates.                    |

### `storage/` — OPFS, ZIP, File System

| Export                                         | Description                                             |
| ---------------------------------------------- | ------------------------------------------------------- |
| `StorageBackend`                               | Abstract storage interface (implement your own).        |
| `OpfsStorageBackend`                           | OPFS-based `StorageBackend`.                            |
| `NullStorageBackend`                           | No-op backend for tests and replay.                     |
| `initOpfsStorage()`                            | Initialize the OPFS file-system layer.                  |
| `createSession()` / `listSessions()`           | Session lifecycle on disk.                              |
| `exportSessionAsZip(handle, { contributors })` | Export a recording session as a ZIP blob.               |
| `ZipExportContributor`                         | Hook for adding your own ZIP subdirectories on export.  |
| `loadActionsFromZip(blob)`                     | Parse recorded actions from a ZIP file.                 |
| `loadEntriesFromSubdir(blob, subdir)`          | Read entries written by a contributor on import/replay. |
| `loadSessionMetadataFromBlob(blob)`            | Read `session.json` from a ZIP.                         |
| `loadGpsPathFromBlob(blob)`                    | Read the recorded GPS path.                             |
| `checkStorageQuota()`                          | Check OPFS quota usage.                                 |

### `geo/` — H3 Spatial Indexing

H3-based proximity matching for GPS-anchored points (renamed from `ref-points/` in the boundary migration).

| Export                           | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| `gpsToH3(lat, lon)`              | Convert GPS coordinates to an H3 cell index.                  |
| `findNearbyGeoAnchor(h3, known)` | Find a known geo-anchored point near an H3 cell.              |
| `h3CellsMatch(a, b)`             | Compare two H3 indices.                                       |
| `approxDistanceMetres(a, b)`     | Approximate distance between two `LatLong`s.                  |
| `isH3Index(value)`               | Type guard for H3 index strings.                              |
| `H3_RESOLUTION`                  | The H3 resolution used (default: 12, ~10 m cells).            |
| `KnownGeoAnchor` (type)          | Shape of a known anchor with H3 index, lat/lon, and metadata. |

### `visualization/` — Three.js & Maps

| Export                         | Description                                            |
| ------------------------------ | ------------------------------------------------------ |
| `LeafletMapOverlay`            | 2D Leaflet map integrated via CSS3D into a 3D scene.   |
| `GpsEventVisualizer`           | Three.js spheres for GPS event positions.              |
| `createAlignmentLerper()`      | Smooth alignment matrix interpolation.                 |
| `createCameraFollower()`       | Camera that tracks a moving target.                    |
| `createCss3dRendererManager()` | CSS3D renderer for HTML-in-3D overlays.                |
| `createGpsCompassCubes()`      | Cardinal direction indicator cubes.                    |
| `createGpsAnchor()`            | GPS-anchored placement helper for one Three.js object. |
| `VIS_COLORS`                   | Consistent color palette for visualizations.           |
| `disposeObject3D(obj)`         | Safe Three.js object disposal.                         |

### `utils/` — Logging & Helpers

| Export                                      | Description                                       |
| ------------------------------------------- | ------------------------------------------------- |
| `createLogger(channel)`                     | Channeled logger with level control.              |
| `getLogBuffer()` / `subscribeToLogs()`      | Inspect or subscribe to the in-memory log ring.   |
| `computeFusedPath(inputs)`                  | Compute a fused GPS+odometry path.                |
| `createFailureTracker(config)`              | Track failure rates with configurable thresholds. |
| `mapWithConcurrencyLimit(items, fn, limit)` | Async map with bounded concurrency.               |
| `formatFileSize(bytes)`                     | Human-readable file sizes.                        |
| `listFormatter(items)`                      | Human-friendly comma/and list formatting.         |

### `types/` — Shared Type Definitions

AR and geo type definitions (`DepthPoint`, `DepthSample`, `LatLong`, `KnownGeoAnchor`, …) used across modules.

### `licensing/` — Bundled Community Key

Re-exports `COMMUNITY_LICENSE_KEY` from the core library so that consumers can pass it explicitly if they need to. `createSlamAppStore` already uses it as the default.

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
├── ar/             # WebXR session, capture, replay scene
│   └── qr/         # QR detection, pose (planar PnP), size-from-depth, GPS vote
├── sensors/        # GPS, orientation, permissions
├── state/          # createSlamAppStore, recording, replay, persistence middleware
├── storage/        # OPFS, ZIP export/import, StorageBackend
├── geo/            # H3 spatial indexing
├── visualization/  # Three.js markers, maps, camera helpers
├── utils/          # Logger, fused-path, concurrency, formatters
├── types/          # Shared type definitions
├── licensing/      # Bundled community license key
└── test-utils/     # Test helpers (browser mocks, ZIP helpers)
```

## License

This framework is licensed under **Apache 2.0** — see [LICENSE](LICENSE).

> **Note:** This package depends on [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js), which is a **closed-source, proprietary** library distributed via npm under a separate license. A free community license key is bundled with the framework so you can start building right away — no signup or API key required. See the core library's EULA for the full terms.

## See Also

- [gps-plus-slam-js](https://www.npmjs.com/package/gps-plus-slam-js) — Core alignment algorithms (closed-source)
- [`GpsPlusSlamJs_MinimalExample`](../GpsPlusSlamJs_MinimalExample/) — Smallest possible consumer of this framework (trivial rung)
- [`GpsPlusSlamJs_AnchorStarter`](../GpsPlusSlamJs_AnchorStarter/) — Meaningful-minimal starter: a persistent GPS anchor across reload (starter rung)
- [`GpsPlusSlamJs_RecorderApp`](../GpsPlusSlamJs_RecorderApp/) — Full-featured recording app built on this framework
