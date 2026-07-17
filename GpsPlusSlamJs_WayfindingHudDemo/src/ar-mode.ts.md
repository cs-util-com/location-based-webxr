# ar-mode.ts

- **Purpose:** the live-AR mode — tap-to-place waypoints guided by the wayfinding HUD. Device-only WebXR glue (verified via `pnpm dev` on an ARCore phone); the config wiring is unit-tested.
- **Public API:**
  - `startArMode(deps: ArModeDeps): Promise<ArMode>` — `deps` = `{ container, getConfig, onStatus, onError, onStarted?, onEnded? }`. Resolves to an inert no-op handle when `initAR` fails (after `onError`).
  - `ArMode` — `{ refreshHud() (slider change), placedCount(), dispose() (idempotent) }`.
- **Flow & invariants:**
  - `initAR(container, isolation, features, callbacks)` with camera/depth crash-surface features **off** (`enableCameraAccess/DepthSensingFeature/CameraTextureAcquisition: false` — this demo never reads the camera image), `requestHitTest: true`, and the store as the `tracking` callbacks group (framework convention; no GPS watches started).
  - Screen-centre hit-test reticle (MinimalExample inline pattern, incl. the ended-while-requesting `source.cancel()` guard); `select` places a `createWaypointMarker` sphere under `arWorldGroup` (world→local); a tap with no surface is ignored.
  - The HUD runs in its DEFAULT self-registering mode — inside a session the framework frame loop ticks it; session teardown auto-disposes it via the session-disposer registry.
  - Per XR frame the status line is emitted from the HUD's actual scene output (`hud-status.ts`).
  - The session `end` event (system gesture) triggers full cleanup + `onEnded`.
- **Tests:** `ar-mode.test.ts` (deep-subpath mocks): initAR isolation/feature/tracking wiring, default-mode HUD creation from the current config, refreshHud re-creation, initAR-failure path. Everything else is device-verified.
