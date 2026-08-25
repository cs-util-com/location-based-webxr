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
getIntrinsics }` — `controllerDeps` is a
  `Partial<EnableGpsArDeps>` injected into `createEnableGpsArController`
  (empty in production; the e2e fake supplies the full dep set there). The
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
