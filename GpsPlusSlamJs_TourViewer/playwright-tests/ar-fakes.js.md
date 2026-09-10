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
  them — plus `fakeScene` (a scene-root stub the image planes land in);
  `getArWorldGroup`/`getScene` return null until initAR ran, pinning the
  production ordering; `locationPermission` / `locationOutcome` /
  `locationRequests` (the visitor screen's gate: what the permission
  query answers, what a location-only tap comes back with, how many taps
  were made); `downloads` + `saveOutcome` (the zips the setup offered
  for download - the fake `downloadZip` captures the blob instead of
  saving, and reports `saveOutcome`, false meaning a dismissed picker).
  `endARSession` fires `sessionEndCallback({ requestedByApp: true })`
  like the real XR session's end event does, so an app-requested end runs
  the app's teardown in the specs too (the finish step relies on it).
  `reticleVisible` / `reticlePosition` / `reticleDisposals` and
  `encodedFrames` script the creator's placement layer (the hit-test
  reticle and the JPEG encoder fakes; `createLabel` returns a bare object
  in place of the canvas sprite); `timers` + `fireTimers()` are the scan
  gate's escape clock (the `schedule` seam), so a spec fires the 45 s
  without waiting.

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
