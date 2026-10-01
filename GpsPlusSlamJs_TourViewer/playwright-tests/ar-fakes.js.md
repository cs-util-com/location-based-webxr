# ar-fakes.js

## Purpose

Fake device seams for the AR e2e specs: headless Chromium has no WebXR or
camera, so `installTourViewerArFakes(page)` installs
`window.__tourViewerSeams` (consulted by `src/seams.ts` in DEV only) via
`addInitScript` before any page script runs, plus the
`window.__tourViewerTest` control surface the specs read back.

## Public API

- `installTourViewerArFakes(page)` — call in `beforeEach`, before `goto`.
- `seedAlignment(page)` — dispatches the session zero and three consistent
  GPS fixes into the app store, so the mint gate and placement unlock.
  Shared by `ar-mode.spec.js`, `object-editing.spec.js` and
  `ar-layout.spec.js` (it was copied into the first two).
- Control surface `window.__tourViewerTest`: `initARCalls` (records
  `hasCameraFrame` + the isolation flags), `captureCalls`,
  `alignmentCalls`, `alignmentStore` (the real app store the alignment
  binding received — specs assert `recording.isRecording` through it),
  `stopCaptureCalls`, `endARSessionCalls`, `cameraFrameCallback`,
  `emitFrames(n)` (delivers fake frames - RGBA plus an identity capture pose
  and `capturedAtMs`, the framework's `CapturedCameraFrame` shape - through
  the initAR camera callback; there is no `getCameraPose` seam to fake), `sessionEndCallback` + `endXrSession()` (simulate a system
  session end), and `armQrDetection(text, position?)` + `nextDetection` /
  `nextSolution` — scripted device-level QR results for the author
  pipeline; the REAL controller, slice, stability gate and mint run over
  them — plus `fakeScene` (a scene-root stub the image planes land in);
  `getArWorldGroup`/`getScene` return null until initAR ran, pinning the
  production ordering; `locationPermission` / `locationOutcome` /
  `locationRequests` (the visitor screen's gate: what the permission
  query answers, what a location-only tap comes back with, how many taps
  were made); `downloads` + `saveOutcome` (the zips the setup offered
  for download - the fake `shareOrDownloadZip` captures the blob instead
  of saving, and reports `saveOutcome`, false meaning nothing left the
  page). The ROUTE is chosen by the installer's `{ shareRoute }` option
  rather than through `__tourViewerTest`, and deliberately so: the app
  reads the share capability once while wiring its buttons, so a spec
  flipping it after load would get the share copy under a download label.
  `endARSession` fires `sessionEndCallback({ requestedByApp: true })`
  like the real XR session's end event does, so an app-requested end runs
  the app's teardown in the specs too (the finish step relies on it).
  `reticleVisible` / `reticlePosition` / `reticleDisposals` and
  `encodedFrames` script the creator's placement layer (the hit-test
  reticle and the JPEG encoder fakes; `createLabel` returns a bare object
  in place of the canvas sprite); a tap in AR (authoring plan
  2026-09-28-0953 M4): `startHitTestReticle` keeps the app's select
  listener as `xrSelect`, `tapXr(selector?)` taps like the runtime does
  (with a null target ray, a screen-centre tap) -
  `beforexrselect` dispatched at the overlay element first, and NO select
  when it was cancelled (it returns whether the select fired) - and
  `pickObjectInView` returns the scripted `pickId` only when the app
  rendered that id (`pickTargets` records the ids it was offered; the stub
  scene has no geometry, the real raycast is `object-pick.test.ts`'s);
  `timers` + `fireTimers()` are the scan
  gate's escape clock (the `schedule` seam), so a spec fires the 45 s
  without waiting. The troubleshooting recording's depth (authoring
  recording plan 2026-09-28-0953, D4): `initARCalls` records `hasDepth`,
  `depthCaptureCalls` / `stopDepthCalls` count the depth seams, and
  `emitDepthSample()` feeds one sample through the initAR depth callback
  (`depthCallback`). The fake world group's `matrixWorld` and `worldToLocal`
  follow the store's alignment (the identity before one exists), as the real
  group's lerped matrix does: the creator's placement reads the reticle's
  odometry through it, and the authoring settle (authoring plan
  2026-09-28-0953 M2c) maps that back through the alignment - an identity
  group under a real alignment would move every settled pin by it.

## Invariants & assumptions

- The fake `initAR` inserts a window-sized canvas as the overlay root's
  first child, as the framework does - without it no spec could see a panel
  pushed below the screen by it (the owner's r750 field test).
  `installTourViewerArFakes(page, { printSizeM })` makes the print-size
  estimate report that size, one new independent window per call (the
  fakes' single camera pose carries no parallax), so the creator's size
  offer appears after three detections.
- The fake controller deps grant every permission and resolve `initAR`
  immediately, so the controller walks `checking → ready → running` — the
  specs prove the COMPOSED wiring, not the framework internals (those have
  their own unit suites).
- Nothing here ships: the seam override is statically stripped from
  production builds (see `src/seams.ts.md`).

## Tests

Consumed by `ar-mode.spec.js`, `ar-layout.spec.js` and
`object-editing.spec.js`. Not a test file itself; the prod-inert
guarantee it relies on is unit-tested in `src/seams.test.ts`.
