# ar-mode.ts

## Purpose

The M2 AR foundation of the QR-pose loop (plan: gps-plus-slam
`GpsPlusSlamJs_Docs/docs/2026-08-25-1227-qr-pose-tour-relocalization-plan.md`
§3 M2): the pure button view, the `enable()` configuration both modes share,
and the on-running runtime start. Viewer and author mode are deliberately
identical here — they diverge in M3/M4.

## Public API

- `CAMERA_FRAME_INTERVAL_MS` (125, the framework's `DEFAULT_QR_CAPTURE_INTERVAL_MS`) — the ~8 Hz detection cadence. The frame
  source is the SINGLE cadence owner (Option A): the QR controller consuming
  these frames must run `minIntervalMs: 0`.
- `arButtonView(state, mode, location?): { label; disabled }` - pure
  mapping of `EnableGpsArState` to the entry button. Ready: "Start AR
  setup" (creator), "Start the tour" (visitor), "Allow location" (visitor
  while the location gate is pending, DEC-N2), "Getting your location…"
  disabled (visitor while the request runs); running: "Setting up in AR"
  / "Tour running"; error: "Try again" (the cause is the status line's, in
  plain words, `visitor-status.ts`; it used to be "Retry - " plus the raw
  browser error, UI round 1, U1, review F5).
- `buildArEnableConfig(hooks: ArEnableHooks): EnableGpsArConfig` -
  `hooks.requestHitTest` asks for the WebXR `hit-test` feature (the
  creator's reticle; without it the reticle never shows) - hooks:
  `{ container, trackingStore, onFrame, onSessionEnd, onGpsPosition, onOrientation }`.
  `onFrame(frame: CapturedCameraFrame)` receives every throttled camera
  frame - top-left RGBA plus the camera pose and epoch-ms time of its capture
  (QR perf plan 2026-09-23 M4) - forwarded unchanged from
  `callbacks.cameraFrame.onFrame`.
  `trackingStore` rides in as `callbacks.tracking.store` (flows plan M4):
  `initAR` dispatches `tracking/poseReceived` ONLY into the store handed in
  here, and the tracking-quality phase the placement trigger reads is
  derived from those dispatches. The viewer had mounted that slice since its
  creation and never fed it (the recorder's 2026-05-23 lesson, re-learned).
- `startTourArRuntime(store, deps): { ok: true } | { ok: false; error }` —
  deps: `{ getArWorldGroup, enableArWorldGroupAlignment,
startCameraFrameCapture, now }` (seam-injected).
- `endTourArRuntime(store, { stopCameraFrameCapture })` — the teardown
  counterpart, run on session end: stops capture, dispatches `endSession`
  AND `resetGpsSessionData` (core 1.20: drops the session's odometry↔GPS
  pairs and solved alignment, keeps the zero), and
  `resetCoordinatorState()`. Without it a RE-ENTRY (this entry is a
  toggle, not a single-shot demo) blended the dead session's odom-anchored
  GPS elements into the next session's alignment solve (PR #359 review;
  the store half closed via the M3 review #2 follow-up).

## Invariants & assumptions

- **Isolation flags are a plan decision, not a default** (QD-5/delta #7):
  `enableCameraAccess: true` + `enableCameraTextureAcquisition: true` in
  BOTH modes (QR detection needs camera frames everywhere), depth OFF in
  both (v1 authoring takes the printed size as input). These are the
  opposite of MinimalExample/AnchorStarter, which avoid the camera path's
  Chromium crash surface; this app needs it.
  - **The one exception: an entry the troubleshooting recording records**
    (authoring recording plan 2026-09-28-0953, decision D4). Its hooks carry
    `onDepthSample`, which sets `enableDepthSensingFeature: true` and passes
    `callbacks.depth` (the framework builds its depth sampler at initAR from
    that; `startDepthCapture` starts it once the session runs). Depth is an
    OPTIONAL session feature, and `requestDepth` (the controller's permission
    probe, which fails the whole entry on a denial) stays unset - a phone
    without depth starts AR all the same and records none.
- **`callbacks.cameraFrame` must ride into `initAR`** — the framework
  constructs the frame source there; `startCameraFrameCapture` without it
  warns-and-no-ops. It cannot be added after session start.
- **`startTourArRuntime` runs the whole on-running sequence or nothing**:
  `startSession` (contextTag `tour-viewer`) → alignment binding → camera
  capture. Without `startSession` the gps-event-coordinator silently drops
  every GPS fix (`isRecording` gate, no log) and alignment never computes —
  the framework's documented trap. A missing world group fails loud with
  nothing half-started.
- GPS fixes arriving between watch start and the `startSession` dispatch
  (a sub-second window during `enable()`) are dropped, as in MinimalExample;
  fixes are continuous, so the loss is immaterial.
- Hit-test only for a creator (`requestHitTest`, the placement reticle
  since M4); no depth permission: the QR flows anchor to detected codes
  and GPS positions, never to hit-test planes.

## Examples

```ts
const result = await controller.enable(
  buildArEnableConfig({ container, onFrame, onSessionEnd, ... }),
);
if (result.ok) {
  const runtime = startTourArRuntime(store, {
    getArWorldGroup, enableArWorldGroupAlignment,
    startCameraFrameCapture, now: Date.now,
  });
  if (!runtime.ok) showError(runtime.error);
}
```

## Tests

`ar-mode.test.ts` — the isolation-flag pin (and depth ON only with
`onDepthSample`, its samples reaching the hook, no permission probe),
camera-frame wiring at initAR-callback level, the real-recording-slice `startSession` proof, the
alignment/capture arguments, the loud world-group failure, and the full
button-view table. The composed boot is proven by
`playwright-tests/ar-mode.spec.js`.
