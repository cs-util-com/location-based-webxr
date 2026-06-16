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
  store dispatches, `updateScene` to the debug view, `resolveStablePose` to
  `selectStableQrPose`, and `startFrameSource` to `offerFrame`. `failStart` rolls
  the UI back on a boot error.
- **Loads the PnP pose solver** in the background (`seams.loadSolvePose()` →
  opencv.js): the resolved closure is captured in `pnpSolve` and the controller's
  `solvePose` lazily reads it, returning `null` (stays scanning) until the load
  completes. The strict `depth → size → PnP` gate means the first lock is seconds
  away (size must converge first), comfortably covering the WASM load. A load
  failure is logged; the demo degrades to "scanning" rather than crashing.
- **Sets the detection throttle** here: `minIntervalMs = DETECT_INTERVAL_MS`
  (125 ms ≈ 8 Hz, plan §9) — the controller's own default is 0 (no throttle) so
  unit tests stay fast; production cadence is a wiring decision, set in `main`.
- Maintains an on-screen **debug log** (`debug-log.ts`): every lock appends a
  line with the Δt since the previous lock (cadence/tuning aid), and status
  transitions are logged too.
- HUD re-renders on store change and status change.

## Verification

Not unit-tested (pure logic lives in the sibling modules). Verified via the
faked Playwright e2e (`playwright-tests/qr-demo.spec.js`) and manually on an AR
device (`pnpm dev`) — the §5 axis-overlay gate.
