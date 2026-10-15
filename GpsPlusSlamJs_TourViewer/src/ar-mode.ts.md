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
  disabled (visitor while the request runs); running: "Exit AR" for a visitor; for a creator the session's ONE button (polish round M3, Q-Done, B6): "Done" (it finishes when a finish can start, else leaves - `ar-entry.ts`), "Saving…" disabled while the finish runs, "Close AR" after a failed finish (the optional fourth argument `finish: { running, failed }`) - enabled, the way
  out of AR, `ar-entry.ts` disables the session on that tap (UI round 1,
  U2, review F2; it used to sit disabled as "Tour running" / "Setting up in
  AR"); error: "Try again" (the cause is the status line's, in
  plain words, `visitor-status.ts`; it used to be "Retry - " plus the raw
  browser error, UI round 1, U1, review F5); unsupported: "Copy link",
  enabled, for a VISITOR (the owner's V4, polish round M4a: `ar-entry.ts`
  copies the page's link for a phone that has AR), "AR not supported on
  this device" disabled for a creator.
- `COPY_LINK_LABELS` - that button's idle / busy / done labels and the
  failure sentence (async-UI rule).
- `visitorStep(mode, state, location, hadLocationStep): string | null` -
  pure: the step marker V4's round button carries ("1 of 2" while a
  visitor's tap only asks for the location, "2 of 2" for the start once
  that was asked in this visit). Null for a creator, outside `ready`, and
  for a visitor whose location was already allowed (one tap, no steps).
- `buildArEnableConfig(hooks: ArEnableHooks): EnableGpsArConfig` -
  `hooks.requestHitTest` asks for the WebXR `hit-test` feature (the
  creator's reticle; without it the reticle never shows) - hooks:
  `{ container, requestHitTest, trackingStore, onFrame, onSessionEnd, onGpsPosition, onOrientation }`,
  and the optional `onDepthSample`, `onTrackingRestarted` and `location`
  (each below).
  `location: "none"` (QR-first M1b-1) is forwarded as the config's
  `location`: the framework's codes-only mode, for a visitor who declined
  location (`ar-entry.ts` passes it when `ctx.codesOnly` is set).
  `enable()` then asks for no location permission and starts no GPS watch,
  so `onGpsPosition` is never called for the session; the camera, the
  orientation and every other hook work as with location. Absent (every
  other entry): the framework's default, location required.
  `onFrame(frame: CapturedCameraFrame)` receives every throttled camera
  frame - top-left RGBA plus the camera pose and epoch-ms time of its capture
  (QR perf plan 2026-09-23 M4) - forwarded unchanged from
  `callbacks.cameraFrame.onFrame`.
  `trackingStore` rides in as `callbacks.tracking.store` (flows plan M4):
  `initAR` dispatches `tracking/poseReceived` ONLY into the store handed in
  here, and the tracking-quality phase the placement trigger reads is
  derived from those dispatches. The viewer had mounted that slice since its
  creation and never fed it (the recorder's 2026-05-23 lesson, re-learned).
  The optional `onTrackingRestarted()` becomes `callbacks.tracking.onRestarted`
  (follow-up F11): the framework calls it when WebXR reset its origin after
  a tracking loss. It only TELLS - the restart is not dispatched to the
  solver, which is the open decision of
  `../docs/2026-10-02-1929-viewer-odometry-restart-not-dispatched-followup.md`.
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
  BOTH modes (QR detection needs camera frames everywhere). The QR
  pipelines never need depth (v1 authoring takes the printed size as
  input). These are the opposite of MinimalExample/AnchorStarter, which
  avoid the camera path's Chromium crash surface; this app needs it.
  - **Depth only with `onDepthSample` - which every creator entry now has.**
    The mesh cursor is a creator default since 2026-10-15 (polish round M5,
    mesh-cursor smoothing plan 2026-10-15-0944; `?mesh=0` drops it), so a
    creator entry asks for depth at the mesh density (24 x 24 at 5 Hz), and
    an entry the troubleshooting recording records (a creator's, or a
    visitor's with `?debug=1`) asks at the recording's 16 x 16 / 1 Hz
    instead (authoring recording plan 2026-09-28-0953, decision D4). An
    unrecorded visitor entry, and a creator one with `?mesh=0` and no
    recording, ask for none. The hook sets `enableDepthSensingFeature: true`
    and passes `callbacks.depth` (the framework builds its depth sampler at
    initAR from that; `startDepthCapture` starts it once the session runs).
    Depth is an OPTIONAL session feature, and `requestDepth` (the
    controller's permission probe, which fails the whole entry on a denial)
    stays unset - a phone without depth starts AR all the same and records
    none.
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
- **In the codes-only mode (`location: "none"`) no watch starts at all**:
  no fix reaches `onGpsPosition` for the whole session, so the session's
  zero and alignment come from the scanned codes alone (`viewer-placement.ts`
  `zeroFromCode`), and nothing the viewer derives from device fixes (the
  moved-code check, the keep-alive's hand-over, the compass wait) has
  anything to work on. The runtime start is the same (`startSession`
  included): the codes' votes go through the same coordinator gate.
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
`onDepthSample`, its samples reaching the hook, no permission probe), the
codes-only `location` forwarded and the default left alone,
camera-frame wiring at initAR-callback level, the real-recording-slice `startSession` proof, the
alignment/capture arguments, the loud world-group failure, and the full
button-view table. The composed boot is proven by
`playwright-tests/ar-mode.spec.js`.
