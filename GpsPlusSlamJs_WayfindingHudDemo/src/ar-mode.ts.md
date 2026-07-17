# ar-mode.ts

- **Purpose:** the live-AR mode — tap-to-place waypoints guided by the wayfinding HUD. Device-only WebXR glue (verified via `pnpm dev` on an ARCore phone); the config wiring is unit-tested.
- **Public API:**
  - `startArMode(deps: ArModeDeps): Promise<ArMode>` — `deps` = `{ container, getConfig, onStatus, onError, onStarted?, onEnded? }`. Resolves to an inert no-op handle when `initAR` fails (after `onError`).
  - `ArMode` — `{ refreshHud() (slider change), placedCount(), dispose() (idempotent) }`.
- **Flow & invariants:**
  - **First tracked XR frame:** spawns the three example targets from [ar-waypoints.ts](ar-waypoints.ts.md) (once; the init-time camera pose is not settled, hence in-frame spawning) — the HUD is demonstrably live before the user does anything. Tap-to-place adds on top; `placedCount()` includes the examples.
  - **Blocked tap:** a `select` with no surface under the reticle calls `deps.onHint("Point the camera at the floor, then tap.")` instead of silently ignoring (async-feedback rule); `main.ts` flashes it for ~2.5 s.
  - `initAR(container, isolation, features, callbacks)` with camera/depth crash-surface features **off** (`enableCameraAccess/DepthSensingFeature/CameraTextureAcquisition: false` — this demo never reads the camera image), `requestHitTest: true`, and the store as the `tracking` callbacks group (framework convention; no GPS watches started).
  - Screen-centre hit-test reticle (MinimalExample inline pattern, incl. the ended-while-requesting `source.cancel()` guard); `select` places a `createWaypointMarker` sphere under `arWorldGroup` (world→local); a tap with no surface is ignored.
  - The HUD runs in its DEFAULT self-registering mode — inside a session the framework frame loop ticks it; session teardown auto-disposes it via the session-disposer registry.
  - Per XR frame the status line is emitted from the HUD's actual scene output (`hud-status.ts`).
  - The session `end` event (system gesture) triggers full cleanup + `onEnded`.
- **Tests:** `ar-mode.test.ts` (deep-subpath mocks): initAR isolation/feature/tracking wiring, default-mode HUD creation from the current config, refreshHud re-creation, initAR-failure path. Everything else is device-verified.
