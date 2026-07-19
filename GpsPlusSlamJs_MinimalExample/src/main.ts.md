# main.ts

## Purpose

Entry script for the minimal **GPS + AR hit-test** example. Glue only — a
structural port of the stock three.js `webxr_ar_hittest` example
(button → AR session → hit-test reticle → tap-to-place) adapted for the
GPS-aligned framework.

Intentionally does **not** depend on any recorder-only slices
(routing, scenarios, ref-points). It demonstrates the smallest end-to-end AR
integration over `createEnableGpsArController` + `registerXrFrameUpdate`.

## Behavior

- Boots `createSlamAppStore({ storageBackend: new NullStorageBackend() })`
  (the store backs the status panel's recording counters; the smoke test in
  [boot.test.ts](boot.test.ts) covers that it resolves and boots).
- Creates an "Enable GPS AR" controller and renders the app's **own** button
  over its observable state via the pure `buttonView()` mapping
  (checking → unsupported/ready → starting → running/stopping/error).
- On click, calls `controller.enable({ container, requestHitTest: true,
  isolationOptions, callbacks, onGpsPosition })` inside the user gesture so
  permission prompts are allowed. `isolationOptions` disables the camera/depth
  crash-surface flags (`enableCameraAccess`, `enableDepthSensingFeature`,
  `enableCameraTextureAcquisition` → `false`) since this example only places
  content under a hit-test reticle; `dom-overlay` / CSS3D stay on for the
  status-hint UI.
- Once `running`, installs the hit-test reticle via the framework's shared
  driver
  ([ar/hit-test-reticle-driver](../../GpsPlusSlamJs_AppFramework/src/ar/hit-test-reticle-driver.ts.md),
  which owns the source request, the per-frame `getHitTestResults` loop and
  every session-end/race guard). The returned handle is disposed from
  `callbacks.onSessionEnd`, so a later AR re-entry — which calls
  `startArInteraction` again against a fresh `arWorldGroup` — starts a fresh
  driver instead of leaving the old one running (each `running` transition
  also defensively disposes any stale handle first).
- Wires the AR `select` (tap) through the GPS gate in [placement.ts](placement.ts)
  inside the driver's `onSelect` callback (fired on every tap with the reticle
  world position or `null`): before the first GPS fix a tap flashes a transient
  "waiting for GPS…" hint — even with no surface, the GPS gate outranks the
  surface check; after a fix it co-spawns the contrast pair (see below).
- Feeds GPS + orientation into the store: dispatches `startSession` when AR
  starts (recording must be active), forwards every fix through
  `createGpsPositionHandler` and every orientation sample through
  `updateDeviceOrientation`, so the alignment matrix the anchor reads is live.
- On a valid tap, `placeContrastPair` co-spawns (via [co-spawn.ts](co-spawn.ts))
  the deliberate floater cube under the scene root and an anchored marker under
  `arWorldGroup` at the same world pose, then hands the marker to
  `createGpsAnchor` in its **default bootstrap** (no `skipBootstrap`,
  `mode: 'snap-when-offscreen'`, seeded with the latest GPS fix). It also draws a
  red [connector line](connector-line.ts) from the sphere to its cube (a
  per-frame `registerXrFrameUpdate`) so each pair — and the drift between them —
  stays identifiable when several pairs are on screen.

## Invariants & assumptions

- The DOM ships three known IDs: `#status` (pre), `#enter-ar` (button) and
  `#ar-root` (the AR container passed to `initAR`). Missing any throws at
  startup so misconfiguration is loud.
- **Delta #1 — app-rendered button.** The framework owns the permission /
  enter-AR *sequence* (the controller), not the button DOM. The app styles and
  labels its own `<button>`.
- **Delta #2 — parenting.** The reticle (and any placed content) is added under
  `getArWorldGroup()` (AR-local space), **not** the GPS-aligned scene root
  (`getScene()`). This is the single line a porting developer is most likely to
  get wrong (Finding 2 in the plan doc).
- The `XrFrameContext` handed to the registered update is valid **only
  synchronously** inside the callback — the example never stashes `frame` /
  `session` for later use.

## Tests

This module is WebXR glue and is verified manually via `pnpm dev` on an
AR-capable device. The pure pieces it depends on are unit-tested: the
reticle view-model and its driver loop in the framework's
[hit-test-reticle.test.ts](../../GpsPlusSlamJs_AppFramework/src/visualization/hit-test-reticle.test.ts)
and
[hit-test-reticle-driver.test.ts](../../GpsPlusSlamJs_AppFramework/src/ar/hit-test-reticle-driver.test.ts),
the tap decision in [placement.test.ts](placement.test.ts), the status
formatter in [status.test.ts](status.test.ts), and the status
panel (write-skipping cache + transient hints) in
[status-panel.test.ts](status-panel.test.ts). The store boot is covered by
[boot.test.ts](boot.test.ts).
