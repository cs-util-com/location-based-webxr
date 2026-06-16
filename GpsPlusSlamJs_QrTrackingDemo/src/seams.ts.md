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
  `createDetect`, `getDepthContext`, `loadSolvePose`, `startFrameSource`.

## Invariants

- **Prod-inert:** the override is read only under
  `import.meta.env.DEV && !import.meta.env.VITEST` — Vite statically strips it
  from production; unit tests ignore it.
- PROD `getDepthContext` builds an unprojector + nearest-neighbour depth lookup +
  camera pose + the sample's `projectionMatrix` (for PnP intrinsics) from the
  latest `DepthSample` (`setDepthCaptureCallback`); `null` when the sample lacks a
  projection matrix.
- PROD `loadSolvePose` loads opencv.js once (`opencv-loader.ts`), builds a reusable
  `OpenCvPnpSquare`, and returns a closure wrapping `solveQrPose` — the production
  PnP pose path (Step-0 conversion). Device-verified, like the frame/depth source;
  the e2e fakes it with a fixed `QrPoseSolution`. The solver lives for the session
  (not disposed — acceptable for a debug tool; per-solve Mats are freed internally).
- PROD frames come from the framework's generic **camera-frame RGBA capture**
  (B2): `initAR` registers `setCameraFrameCallback` (before the framework
  `initAR`, like the depth callback) to forward each throttled **top-left RGBA**
  frame to the active consumer; `startFrameSource(onImage, { intervalMs })` sets
  that consumer and calls `startCameraFrameCapture({ intervalMs })` — the source
  is the single cadence owner (Option A; the controller runs `minIntervalMs: 0`).
  The old `OffscreenCanvas` JPEG decode (`decodeToRgba`) is gone.
  `startFrameSource` itself stays as the **e2e frame-injection seam** — only its
  PROD body changed.
- detect uses `createBarcodeDetectorFrontEnd`.

## Tests

`seams.test.ts` — `getSeams()` returns `realSeams` under VITEST; `realSeams`
exposes every function `main.ts` wires. The faked path is exercised by the e2e.
