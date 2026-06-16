# demo-controller.ts

**Purpose:** The orchestration brain of the demo (Note 4). Per throttled/coalesced
frame: detect a QR → measure size from depth (`createQrSizeMeasurer` → per-marker
running median) → **once a size estimate exists (`estimateM !== null`)**, solve the
pose with the production PnP path (`solveQrPose`/`OpenCvPnpSquare`, injected as
`solvePose`) → on the N-consecutive-lock, record into `qrDetected` and glue the
axis + cube. Geo-less: never casts a GPS vote. The PnP conversion is Step 0 of the
[pose-stabilization next-steps](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-next-steps.md);
design in
[2026-06-16-qr-demo-pnp-conversion-plan.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-qr-demo-pnp-conversion-plan.md).

## Public API

- `createQrDemoController(deps): QrDemoController` — `{ offerFrame(image), status, reset() }`.
- `SolvePoseFn = (input: QrSolvePoseInput) => QrPoseSolution | null` — the injected
  PnP solve (production: `solveQrPose` + `OpenCvPnpSquare`; tests inject a fake).
- `QrDemoControllerDeps` — injected `detect`, `getDepthContext`, `solvePose`,
  `recordDetection`, `recordSize`, `updateScene`, optional `resolveStablePose`
  (windowed filtered pose for the overlay — e.g. `selectStableQrPose`),
  `onStatus`/`now`/ scheduler tuning.
- `DepthContext = { unprojector, depthAt(sx,sy), cameraPose, projectionMatrix }`
  — `projectionMatrix` (column-major XRView projection) is the source for
  `intrinsicsFromProjection(projectionMatrix, image.width, image.height)`.

## Invariants

- Built on the framework's generic `createDetectionScheduler` (throttle +
  coalesce + N-lock). `minIntervalMs` defaults to 0 (debug demo), `requiredLockCount` 2.
- **`depth → size → PnP` gate:** the solve is blocked only while NO size exists yet
  (`estimateM === null`), mirroring the production controller, which blocks on a
  `null` size. It does **not** wait for the vote-grade `estimated` lifecycle: that
  bar (≥8 quality-≥0.8 samples within a 1 cm spread) gates the high-weight GPS
  _vote_ (never cast by this geo-less demo), and on noisy device depth it is rarely
  met — gating the overlay on it left nothing ever glued (the bug fixed 2026-06-16).
  `SOLVEPNP_IPPE_SQUARE` rotation is size-invariant and translation scales with
  size, so the provisional running median (from the first accepted sample) is a
  valid size that refines as more samples land.
- **Size recorded every measured frame:** `recordSize` fires in `runDetect` (not
  only on a lock) so the HUD shows the running median + "N samples" progress
  independently of the lock.
- A detection whose quad fails `validateQuad` (mirrored / degenerate), a missing
  depth context, a corner with no depth read, **no size yet** (`estimateM` null),
  an **absent
  `solvePose`** (OpenCV not loaded → graceful degrade), or a `null` solve → treated
  as a miss (no record, no scene update). The early `validateQuad` mirrors
  `solveQrPose`'s own guard; it does NOT reorder corners (the detector's order
  carries the reading orientation — see the on-device follow-up §2.3).
- **Persistence (Note 3):** a miss does NOT clear the scene (objects keep their
  last pose). `qrPoseWorld`/`qrPoseInCamera`/`reprojectionErrorPx` now come from
  the PnP `QrPoseSolution` (a real reprojection metric, unlike the old depth-fit 0).
- **Stable-pose overlay (sliding-window stabilization):** on a lock the scene is
  rendered with `resolveStablePose(text)` when it has converged, else the raw PnP
  frame pose. `recordDetection` runs first, so the window already includes the
  current frame. The ring buffer keeps the RAW poses — the filtered pose is never
  written back. See
  [2026-06-16-followup-qr-pose-stabilization-sliding-window.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-followup-qr-pose-stabilization-sliding-window.md).
- Pose math is fully delegated to `solvePose` → unit-testable without WebXR /
  camera / depth / OpenCV.

## Tests

`demo-controller.test.ts` — size recorded every measured frame (HUD progression);
the lock fires as soon as a running-median size EXISTS (still `measuring`, not
`estimated`) and the locked scene uses the PnP pose (z = −1) and the provisional
size (the gate-regression guard); intrinsics derived from `projectionMatrix` + the
measured size are passed to `solvePose`; absent solver / null solve / no-depth /
no-corner-depth / no-detection / degenerate quad → stay scanning; stable-pose
override vs raw-PnP fallback; `reset` → idle.
