# ar-mode.ts

- **Purpose:** the live-AR mode — tap-to-place waypoints guided by the wayfinding HUD. Device-only WebXR glue (verified via `pnpm dev` on an ARCore phone); the config wiring is unit-tested.
- **Public API:**
  - `startArMode(deps: ArModeDeps): Promise<ArMode>` — `deps` = `{ container, getConfig, onStatus, onError, onStarted?, onEnded? }`. Resolves to an inert no-op handle when `initAR` fails (after `onError`).
  - `ArMode` — `{ refreshHud() (slider change), placedCount(), dispose() (idempotent) }`.
- **Flow & invariants:**
  - **First tracked XR frame:** spawns the three example targets from [ar-waypoints.ts](ar-waypoints.ts.md) (once; the init-time camera pose is not settled, hence in-frame spawning) — the HUD is demonstrably live before the user does anything. Tap-to-place adds on top; `placedCount()` includes the examples.
  - **Blocked tap:** the driver's `onSelect(null)` (no surface under the reticle) calls `deps.onHint("Point the camera at the floor, then tap.")` instead of silently ignoring (async-feedback rule); `main.ts` flashes it for ~2.5 s.
  - `initAR(container, isolation, features, callbacks)` with camera/depth crash-surface features **off** (`enableCameraAccess/DepthSensingFeature/CameraTextureAcquisition: false` — this demo never reads the camera image), `requestHitTest: true`, the store as the `tracking` callbacks group (framework convention; no GPS watches started), and `onSessionEnd` (see below).
  - Screen-centre hit-test reticle via the framework's shared driver ([ar/hit-test-reticle-driver](../../GpsPlusSlamJs_AppFramework/src/ar/hit-test-reticle-driver.ts.md), which owns the source request and every session-end/race guard); its `onSelect(worldPosition)` places a `createWaypointMarker` sphere under `arWorldGroup` (world→local).
  - The app keeps its own `registerXrFrameUpdate` callback for the first-frame example spawn and the per-frame status line only — the hit-test plumbing lives in the driver.
  - The HUD runs in its DEFAULT self-registering mode — inside a session the framework frame loop ticks it; session teardown auto-disposes it via the session-disposer registry.
  - Per XR frame the status line is emitted from the HUD's actual scene output (`hud-status.ts`).
  - The config-derived HUD options (deadband, scale, the live `--accent` as `indicatorColor`, and `config.imageIndicators` → the `arrowSprite`/`circleSprite` URLs) come from [hud-options.ts](hud-options.ts.md), shared with the desktop simulator; URL-loaded textures are HUD-owned, so refreshHud re-creation leaks nothing.
  - `initAR`'s `onSessionEnd` (fires on the system back gesture AND the app-initiated end) triggers full cleanup + `onEnded`; a `bootCompleted` flag keeps it inert if the session dies during a failed boot (half-built state).
- **Tests:** `ar-mode.test.ts` (deep-subpath mocks): initAR isolation/feature/tracking/`onSessionEnd` wiring, driver `onSelect` hint-vs-place mapping, driver disposal on `dispose()`, default-mode HUD creation from the current config, refreshHud re-creation, initAR-failure path. Everything else is device-verified.
