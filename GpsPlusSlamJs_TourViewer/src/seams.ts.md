# seams.ts

## Purpose

Device seam (DEV-overridable) for the AR modes: resolves the framework's
device functions in production and lets the Playwright e2e swap fakes in via
`window.__tourViewerSeams` — the QrTrackingDemo/AnchorStarter pattern.
Keeps `main.ts` glue-only.

## Public API

- `interface TourViewerSeams { controllerDeps; getArWorldGroup;
enableArWorldGroupAlignment; startCameraFrameCapture;
stopCameraFrameCapture; createQrFrontEnd; solveQrPose; getCameraPose;
getIntrinsics; createQrDebugView; getScene; queryGeolocationPermission;
requestLocationOnce; shareOrDownloadZip; canShareZip; downloadPdf;
startHitTestReticle; encodeFrameJpeg;
createLabel; schedule }` - the placement layer (M4: the framework's hit-test
  reticle under the world group; the camera frame → JPEG encoder, which is
  the framework's `rgbaImageToJpegBlob` behind an opacity guard, async
  throughout; the framework text sprite for a pin's label at a 2:1
  canvas/scale with a transparent pill) and the
  one-shot clock behind the scan gate's escape (M5; the e2e fires it instead
  of waiting) - `controllerDeps` is a
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
  `shareOrDownloadZip` is the framework's `shareOrDownloadBlob`: the
  device share sheet where the browser can share FILES, else the
  picker-or-anchor download (the e2e fake captures the blob). It answers
  two things - which route ran, and whether anything left the page - and
  the app needs both, because the copy after a share cannot promise the
  hosted link is unchanged. `canShareZip` is the same capability asked
  WITHOUT a file, for labelling the button at wire time. The
  QR quartet (M3) is the author pipeline's device layer: BarcodeDetector
  front end (or `null` — desktop has no fallback by design), the pure-JS
  planar-PnP solver, the current XR-frame pose as tuples (raw WebXR/odom),
  and PnP intrinsics from the in-session camera projection scaled to the
  DETECTOR buffer's dimensions (depth is OFF in this app, so the projection
  matrix is the only source).
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
