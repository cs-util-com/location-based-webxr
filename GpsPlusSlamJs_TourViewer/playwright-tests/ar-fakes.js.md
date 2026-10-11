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
- `standAt(page, north, east, second)` - one device fix with the phone
  `north`/`east` metres from the fakes' zero, its AR pose taken back through
  the store's current alignment, so the camera stands exactly there. Shared
  by `stations.spec.js` and `sample-tour.spec.js`.
- `openFixtureTour(page)` - opens the fixture tour on the creator's page
  (`?nocache=1`, range streaming) and opens step 4; `enterArAndMeasure(page)`
  enters AR, arms the fixture code, seeds the alignment and measures it, so
  placement unlocks. Moved out of `object-editing.spec.js` when
  `summary.spec.js` (authoring plan 2026-09-28-0953 M3b) needed the same
  steps.
- Control surface `window.__tourViewerTest`: `initARCalls` (records
  `hasCameraFrame` + the isolation flags), `captureCalls`,
  `alignmentCalls`, `alignmentStore` (the real app store the alignment
  binding received — specs assert `recording.isRecording` through it),
  `stopCaptureCalls`, `endARSessionCalls`, `cameraFrameCallback`,
  `emitFrames(n)` (delivers fake frames - RGBA plus an identity capture pose
  and `capturedAtMs`, the framework's `CapturedCameraFrame` shape - through
  the initAR camera callback; there is no `getCameraPose` seam to fake), `sessionEndCallback` + `endXrSession()` (simulate a system
  session end), `emitGps({ lat, lon, accuracy?, timestamp, arPosition })`
  (delivers one device fix through the GPS watch the session started -
  `gpsCallback`, kept by the fake `startGpsWatch` - paired with `arPose`,
  which the `getArPose` seam returns: the page's own path, coordinator,
  `recordDeviceFix` and the vote sink; the moved-code e2e, D20 M5c, needs
  it because the veto re-feeds the fixes the sink stored), and
  `armQrDetection(text, position?)` + `nextDetection` /
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
  page; the installer's `{ saveOutcome }` sets the first save's, since the
  Finish saves by itself before a spec can flip it). The ROUTE is chosen by
  the installer's `{ shareRoute }` option
  rather than through `__tourViewerTest`, and deliberately so: the app
  reads the share capability once while wiring its buttons, so a spec
  flipping it after load would get the share copy under a download label.
  `endARSession` fires `sessionEndCallback({ requestedByApp: true })`
  like the real XR session's end event does, so an app-requested end runs
  the app's teardown in the specs too (the finish step relies on it).
  `reticleVisible` / `reticlePosition` / `reticleDisposals` and
  `encodedFrames` script the creator's placement layer (the hit-test
  reticle and the JPEG encoder fakes; `createLabel` is deliberately NOT
  faked - Chromium has a canvas, so pin labels are the real text sprites,
  and a plain-object stand-in was refused by three's `Object3D.add` with
  only a console error); a tap in AR (authoring plan
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
  without waiting. The stations (tour kit plan K4): `createWayfindingHud`
  keeps the page's targets getter as `hud` (`{ getTargets, disposed }`)
  and counts `hudStarts`; `createAudioElement` returns a fake element
  that records every source it is asked to play in `audioPlays` and counts
  `audioElements`; `loadGlbModel` is NOT faked (the real GLTF loader
  parses the fixture's minimal `.glb`). The troubleshooting recording's depth (authoring
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

## The downloaded zip (shared since code book plan M6)

- `readZip(bytes)` returns `{ names, json }`: every entry name, and each
  JSON entry's text.
- `levelTexts(bytes)` returns the level files (`qr/*.json`) by entry name,
  as text.
- `downloadedZip(page, index)` returns the entry names, the manifest and
  the level files of the n-th download in the fakes' `downloads`.
- `finishAndDownload(page, index)` taps Finish, waits for THIS rebuild,
  then for the Finish's own save (field test 2, F4) to land as the
  `index`-th download. The result line keeps the Finish's sentences under
  the save's status.

These moved here from `object-editing.spec.js` so that
`code-auto-move.spec.js` shares them instead of copying them.
`ar-mode.spec.js` still has its own `readDownloadedZip` (a follow-up).
