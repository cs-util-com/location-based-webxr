# seams.ts

## Purpose

Device seam (DEV-overridable) for the AR modes: resolves the framework's
device functions in production and lets the Playwright e2e swap fakes in via
`window.__tourViewerSeams` — the QrTrackingDemo/AnchorStarter pattern.
Keeps `main.ts` glue-only.

## Public API

- `getArPose()` - the framework's `getCurrentArPose`: the pose each device
  GPS fix is paired with. A seam (D20 M5c) so the e2e, which has no XR
  frames, can send GPS fixes through the page's real path
  (`createGpsPositionHandler` -> `recordDeviceFix` -> the vote sink).

- `interface TourViewerSeams { controllerDeps; getArWorldGroup;
enableArWorldGroupAlignment; startCameraFrameCapture;
stopCameraFrameCapture; startDepthCapture; stopDepthCapture; createQrFrontEnd; solveQrPose; estimateQrPrintSize;
getIntrinsics; createQrDebugView; getScene; getArPose;
queryGeolocationPermission;
requestLocationOnce; shareOrDownloadZip; downloadZip; canShareZip; downloadPdf;
startHitTestReticle; pickObjectInView; encodeFrameJpeg;
createLabel; schedule; createWayfindingHud; loadGlbModel;
createAudioElement }`
  - `createWayfindingHud({ getTargets })` (tour kit plan K4) - the
    framework's wayfinding HUD over the session camera (`getCamera()`),
    null while there is none; the station targets carry their own arrival
    band, and the HUD-level band is `station-bands.ts`'s floors (1.5 m /
    3.0 m). The e2e fake records the targets getter instead.
  - `loadGlbModel(blob)` (K4) - three's `GLTFLoader`, imported on first
    use (a visitor without a model never downloads it), `parseAsync` with
    no path, no DRACO, KTX2 or meshopt decoder: the tour session already
    refused external URIs and decoder extensions (`checkGlbInert`, K0).
    Not faked in the e2e: the fixture's minimal `.glb` goes through the
    real loader.
  - `createAudioElement()` (K4) - `new Audio()`: the page's ONE element
    for the stories (`scene-audio.ts`). The e2e fake records what plays.
  - `startHitTestReticle(arWorldGroup, onSelect?)` - `onSelect` hears
    every XR `select` the DOM overlay did not cancel (a tap in AR,
    authoring plan 2026-09-28-0953 M4), through the framework driver's own
    `onSelect` option, with where the tap pointed: the driver's second
    argument (`SelectTargetRay`, the target ray relative to the viewer),
    or null (M4 review #4).
  - `pickObjectInView(targets, tap)` - the object id under the tap:
    `object-pick.ts`'s camera-ray raycast with the framework camera,
    through `ndcOfTargetRay(camera, tap.targetRayInViewer)` - the screen
    centre when `tap` is null or its ray has no screen point - with the
    angular tolerance (`PICK_TOLERANCE_DEG`); null without a camera. A seam because the e2e scene is a stub with no
    geometry, so the fake names the id a spec scripts. - the placement layer (M4: the framework's hit-test
    reticle under the world group; the camera frame → JPEG encoder, which is
    the framework's `rgbaImageToJpegBlob` behind an opacity guard, async
    throughout; the framework text sprite for a pin's label at a 2:1
    canvas/scale with a transparent pill) and the
    one-shot clock behind the scan gate's escape (M5; the e2e fires it instead
    of waiting); `startDepthCapture` / `stopDepthCapture` are the framework's
    depth sampler controls, used only by an entry the troubleshooting
    recording records (authoring recording plan 2026-09-28-0953, D4; the e2e
    fake counts the calls) - `controllerDeps` is a
    `Partial<EnableGpsArDeps>` injected into `createEnableGpsArController`
    (empty in production; the e2e fake supplies the full dep set there). The
    `queryGeolocationPermission` / `requestLocationOnce` are the visitor
    screen's location gate (guided-setup plan DEC-N2): the Permissions API
    state, and one `getCurrentPosition` on its own tap resolving
    "granted" | "denied" (error code 1) | "unavailable" (any other failure).
    `downloadPdf` is the same picker-or-anchor path with a PDF filter
    instead of a zip one (the printable sheet of numbered codes); it is its
    own seam so the picker offers the right file type and so the e2e
    captures the bytes rather than the browser writing a file.
    `downloadZip` is the framework's `downloadBlob` for a zip - a SAVE, never
    a share: a Drive tour's route (Drive replace plan §2 decision 4).
    `shareOrDownloadZip` is the framework's `shareOrDownloadBlob`: the
    device share sheet where the browser can share FILES, else the
    picker-or-anchor download (the e2e fake captures the blob). It answers
    two things - which route ran, and whether anything left the page - and
    the app needs both, because the copy after a share cannot promise the
    hosted link is unchanged. `canShareZip` is the same capability asked
    WITHOUT a file, for labelling the button at wire time. The
    QR trio (M3; a quartet until the QR perf plan 2026-09-23 M4 removed
    `getCameraPose`) is the author pipeline's device layer: BarcodeDetector
    front end (or `null` — desktop has no fallback by design), the pure-JS
    planar-PnP solver, and PnP intrinsics from the in-session camera projection scaled to the
    DETECTOR buffer's dimensions (depth is OFF in this app, so the projection
    matrix is the only source). There is no camera-pose seam: every camera
    frame arrives as a `CapturedCameraFrame` carrying the pose of the XR frame
    it was captured in, and the QR controllers and the photo placement read
    that (`frame.cameraPose`).
- `realSeams: TourViewerSeams` — the unmodified framework wiring.
- `getSeams(): TourViewerSeams` — real seams unless the DEV-only override is
  present.

## Invariants & assumptions

- **PROD-INERT:** the override is consulted only under
  `import.meta.env.DEV && !import.meta.env.VITEST`; a production build
  statically strips the branch, unit tests ignore it.
- `enableArWorldGroupAlignment` is DEEP-imported
  (`.../visualization/ar-world-group-alignment`) on purpose: the
  `/visualization` barrel pulls the leaflet map modules, which crash in a
  windowless unit-test environment.

## Examples

```ts
const seams = getSeams();
const controller = createEnableGpsArController(seams.controllerDeps);
```

## Tests

`seams.test.ts` — override inert under VITEST; every device function
`main.ts` wires is present. The override path is exercised by
`playwright-tests/ar-fakes.js` + `ar-mode.spec.js`.
