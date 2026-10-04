# main.ts

**Purpose:** Application entry point (glue — "framework wiring, don't touch").
Composes the tested seams into the demo flow: capability-gate → Start gesture →
boot store + AR session + debug view + controller → per-frame
`controller.offerFrame` + HUD render.

## Behaviour

- Capability-gates on `getSeams().checkSupport()`; a WebXR gap blocks, a depth
  gap only warns.
- `startAr()` boots the store (with `qrDetected`), `initAR`, the debug view under
  `arWorldGroup`, and the controller; wires `recordDetection`/`recordSize` to
  store dispatches, `updateScene` to the debug view (skips until a size exists),
  and `startFrameSource` to `offerFrame`. `failStart` rolls the UI back on a boot
  error.
- **Sets the capture cadence** here: `DETECT_INTERVAL_MS` is `?interval=<ms>`
  (`interval-param.ts`, within the framework's QR capture bounds) or the
  framework default `DEFAULT_QR_CAPTURE_INTERVAL_MS` (125 ms ≈ 8 Hz). It drives
  the framework `CameraFrameSource`, the single throttle; the controller detects
  every delivered frame (`minIntervalMs: 0`).
- Maintains an on-screen **debug log** (`debug-log.ts`): every lock appends a
  line with the Δt since the previous lock (cadence/tuning aid), and status
  transitions are logged too.
- **The overlay shows the FUSED pose** (QR near-frontal pose plan M3b b5):
  `resolveStablePose` is the framework's `createFusedQrPoseSource` (`ar/qr/qr-fused-pose-source.ts`) - the joint rotation over the
  window of current-epoch detections, once its gate opens; the controller
  falls back to the raw frame pose until then (it read today's averaged
  stable pose before). `initAR` gets `onFrameChanged`, which dispatches
  `qrFrameChanged()` after an odometry restart (`restart-tracking.ts`).
- HUD re-renders on store change and status change; its `pose` row
  (`hud-view.ts` `poseLabel`) shows the fused result, re-evaluated on each
  render (cached) so a restart shows at once. With `?qrperf`, each lock's
  fused result is also tallied (`qrperf/fused-tally.ts`) with the code's size
  state then, and each NEW fused/motion evaluation is timed as the `fused`
  stage through the framework's `createFusedQrPoseSource` (`ar/qr/qr-fused-pose-source.ts`)'s `onEvaluated` hook (plan §30).
  Each lock also feeds the **size section** (`qrperf/size-tally.ts`; QR size
  consensus plan S2, log only): the framework's `estimateQrSizeFromParallax`
  over the code's current-epoch entries beside the depth size - skipped (and
  counted) while the motion detector reads the code as turning, since
  parallax assumes a still code.
- The motion mode (plan §26): the HUD's motion row (`motionLabel`, coloured
  by `motionColor`) and a ~2 s trail of the active code's raw positions
  (`motion-trail.ts`, drawn by `motion-trail-view.ts` in the same colour).
  The trail is cleared on a restart (`onFrameChanged`), on another code and
  on a failed start, and disposed on `beforeunload` with the debug view.
- **`?qrperf` instrument** (plan 2026-09-23 M2): `mountQrPerf(parseQrPerfParams(location.search), …)`
  returns `null` when the flag is absent, and then nothing below changes. When
  set, `detect` and the default pose solve (`createDefaultSolvePose()`) are
  wrapped with timings, `onCaptureTiming` goes to `startFrameSource`, and the
  report renders into `#qrperf-log`. See `qrperf/*.md`.
- **Capture veto:** the frame source gets `wantsFrame: () => !controller.isBusy()`
  (no GPU readback while the detector is busy). `?qrperf=1&baseline=1` turns the
  veto off and restores the per-decode pixel copy - the pre-fix pipeline, in the
  same build, for the on-phone A/B (plan DEC-Q7).

## Verification

Not unit-tested (pure logic lives in the sibling modules). Verified via the
faked Playwright e2e (`playwright-tests/qr-demo.spec.js`) and manually on an AR
device (`pnpm dev`) — the §5 axis-overlay gate.
