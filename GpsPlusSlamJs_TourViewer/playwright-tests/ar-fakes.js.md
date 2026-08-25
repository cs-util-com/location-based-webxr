# ar-fakes.js

## Purpose

Fake device seams for the AR e2e specs: headless Chromium has no WebXR or
camera, so `installTourViewerArFakes(page)` installs
`window.__tourViewerSeams` (consulted by `src/seams.ts` in DEV only) via
`addInitScript` before any page script runs, plus the
`window.__tourViewerTest` control surface the specs read back.

## Public API

- `installTourViewerArFakes(page)` — call in `beforeEach`, before `goto`.
- Control surface `window.__tourViewerTest`: `initARCalls` (records
  `hasCameraFrame` + the isolation flags), `captureCalls`,
  `alignmentCalls`, `alignmentStore` (the real app store the alignment
  binding received — specs assert `recording.isRecording` through it),
  `stopCaptureCalls`, `endARSessionCalls`, `cameraFrameCallback`,
  `emitFrames(n)` (delivers fake RGBA frames through the initAR camera
  callback), `sessionEndCallback` + `endXrSession()` (simulate a system
  session end), and `armQrDetection(text, position?)` + `nextDetection` /
  `nextSolution` — scripted device-level QR results for the author
  pipeline; the REAL controller, slice, stability gate and mint run over
  them.

## Invariants & assumptions

- The fake controller deps grant every permission and resolve `initAR`
  immediately, so the controller walks `checking → ready → running` — the
  specs prove the COMPOSED wiring, not the framework internals (those have
  their own unit suites).
- Nothing here ships: the seam override is statically stripped from
  production builds (see `src/seams.ts.md`).

## Tests

Consumed by `ar-mode.spec.js`. Not a test file itself; the prod-inert
guarantee it relies on is unit-tested in `src/seams.test.ts`.
