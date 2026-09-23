# seams.ts

**Purpose:** The device boundary. `main.ts` composes the tested modules with the
device functions here; the Playwright e2e swaps a fake in via the DEV-only
`window.__qrDemoSeams` override. The PROD frame/depth source is the
**on-device-verified layer** (the §5 gate is manual — exactly as the parent QR
plan defers the Recorder's live camera wiring).

## Public API

- `getSeams(): QrDemoSeams` — real framework wiring unless a DEV override is
  present (inert in production + unit tests, see prod-inert note).
- `realSeams` — the production implementation.
- `QrDemoSeams` — `checkSupport`, `initAR`, `endARSession`, `getArWorldGroup`,
  `createDetect`, `getDepthContext`, `startFrameSource`.
- `createDetect({ copyPixels? })` — `copyPixels: true` builds the PRE-fix front
  end (a full frame copy per decode) for the `?qrperf=1&baseline=1` A/B run only;
  the default hands the owned buffer over as-is (framework default, M3).
- `FrameSourceOptions` — `{ intervalMs?, onCaptureTiming?, wantsFrame? }`, passed
  straight to `startCameraFrameCapture`.

## Invariants

- **Prod-inert:** the override is read only under
  `import.meta.env.DEV && !import.meta.env.VITEST` — Vite statically strips it
  from production; unit tests ignore it.
- PROD `getDepthContext` builds an unprojector + nearest-neighbour depth lookup +
  the view `projectionMatrix` from the latest `DepthSample`
  (the `depth` group passed to the framework `initAR`). The `projectionMatrix`
  feeds PnP intrinsics (`intrinsicsFromProjection`) in the controller. It no
  longer supplies a camera pose (QR perf plan 2026-09-23, M4): the depth sample
  arrives every 250 ms, so the solve uses each frame's own capture pose instead.
- PROD frames come from the framework's generic **camera-frame RGBA capture**
  (B2): the seam's `initAR` passes the framework `initAR` a
  `callbacks.cameraFrame` group (alongside the depth group — the framework's
  pre-init setters were folded into `initAR`) that forwards each throttled
  frame - a `CapturedCameraFrame`: **top-left RGBA** plus the camera pose and
  epoch-ms time of its capture (M4) - to the active consumer;
  `startFrameSource(onFrame: (frame: CapturedCameraFrame) => void, { intervalMs, onCaptureTiming, wantsFrame })` sets
  that consumer and calls `startCameraFrameCapture({ intervalMs, onCaptureTiming, wantsFrame })` — the source
  is the single cadence owner (Option A; the controller runs `minIntervalMs: 0`).
  `onCaptureTiming` is the opt-in `?qrperf` stage-timing hook (`qrperf/`); e2e
  fakes may ignore it.
  The old `OffscreenCanvas` JPEG decode (`decodeToRgba`) is gone.
  `startFrameSource` itself stays as the **e2e frame-injection seam** — only its
  PROD body changed.
- detect uses `createBarcodeDetectorFrontEnd`.

## Tests

`seams.test.ts` — `getSeams()` returns `realSeams` under VITEST; `realSeams`
exposes every function `main.ts` wires. The faked path is exercised by the e2e.
