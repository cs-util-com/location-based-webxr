# qr-pose.ts

**Purpose:** Pure, device-free, OpenCV-free pose math for QR-code 3D tracking —
Phase 1 of the [QR-code detection & tracking plan](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-15-0806-qr-code-detection-tracking-plan.md).
It turns the 4 detected QR corners (pixels) into the QR's rigid pose in
raw-WebXR/"odom" space, so every later phase (the GPS-vote bridge, the
occupancy self-check, the on-device verification gate) shares one set of
conventions.

## Public API

- `buildObjectPoints(sizeM): [Vector3,Vector3,Vector3,Vector3]` — the 4 corners
  of a centered planar square of side `sizeM`, QR-local frame (+x right, +y up,
  z = 0), ordered **TL, TR, BR, BL** (symbol reading order). Throws `RangeError`
  on non-positive / non-finite size.
- `intrinsicsFromProjection(projection, width, height): CameraIntrinsics` —
  pinhole `{fx,fy,cx,cy}` (pixels) from a column-major GL projection matrix for
  the **exact** detector-frame size. Throws on a malformed matrix or
  non-positive dimensions.
- `projectViewPoint(pointInCamera, intrinsics): Point2 | null` — pinhole
  projection in the WebXR camera frame (−z forward). `null` for points not in
  front of the camera or non-finite results.
- `qrInCameraFromOpenCv({rvec,tvec}): Pose` — convert a solved OpenCV pose
  (object→OpenCV-camera) into the QR pose in the WebXR camera frame via
  left-multiply by `Rx(π) = diag(1,−1,−1)`.
- `composePose(parent, child): Pose`, `invertPose(pose): Pose`,
  `transformPoint(point, pose): Vector3` — rigid-pose algebra (gl-matrix).
- `signedQuadArea(corners): number`, `validateQuad(corners, opts): QuadValidation`
  — winding/degeneracy guard. **Positive** signed area = front-facing
  (TL→TR→BR→BL clockwise on a y-down screen); negative = mirrored ⇒ rejected.
- `reprojectionErrorPx(objectPoints, imagePoints, qrPoseInCamera, intrinsics): number`
  — RMS pixel error; `Infinity` if any point falls behind the camera.
- `solveQrPose(input): QrPoseSolution | null` — the full pipeline: validate quad
  → `solver.solve` (injected `SolvePnpSquare`) → OpenCV→WebXR → compose with the
  camera pose → gate on `tvec.z > 0` and `reprojectionErrorPx ≤ maxReprojectionErrorPx`
  (default 4 px). Returns `null` on any rejection.

## Invariants & assumptions

- **Coordinate conventions** (single source of truth):
  - Pixels: top-left origin, x right, y **down** — matches `BarcodeDetector`,
    OpenCV, and `depth-unprojection.ts`.
  - QR-local object frame: +x right, +y **up**, +z out of the printed face;
    square on z = 0; corners TL, TR, BR, BL (carries reading orientation → yaw).
  - `solvePnP` maps object→camera in the OpenCV frame (+y down, +z forward):
    `p_cam = R·p_obj + t`. WebXR camera = `Rx(π)`·(OpenCV camera). `Rx(π)` is a
    **proper** rotation (det = +1), so the converted pose stays a rigid motion —
    a left-multiply, **not** a reflection/conjugation.
- **Intrinsics formula** (axis-aligned frustum, no skew):
  `fx = P[0]·W/2`, `fy = P[5]·H/2`, `cx = (1−P[8])·W/2`, `cy = (1+P[9])·H/2`.
  Verified against `gl-matrix` `perspective`/`frustum` in the property test, so
  the signs are **locked for this top-left-origin convention** — the only
  remaining on-device unknown (plan §5) is the render-view-vs-camera-image
  scale/crop, not the formula.
- **Float32**: gl-matrix uses `Float32Array`, so transforms carry ~1e-5 relative
  rounding; tests use matching tolerances. Do not tighten below ~1e-4 for
  composed poses.
- `solveQrPose` is **front-end agnostic**: corners may come from
  `BarcodeDetector` or OpenCV; both are normalized by `validateQuad` first. The
  heavy PnP is injected, so this module has **no OpenCV dependency**.

## Examples

```ts
const intr = intrinsicsFromProjection(depthSample.projectionMatrix, W, H);
const solution = solveQrPose({
  imagePoints: detectedCorners, // TL,TR,BR,BL in pixels
  sizeM: level.qr.physicalSizeM,
  intrinsics: intr,
  cameraPose: {
    position: depthSample.cameraPos,
    rotation: depthSample.cameraRot,
  },
  solver: new PlanarPnpSquare(), // pure-JS IPPE (planar-pnp.ts)
});
if (solution) placeUnderArWorldGroup(solution.qrPoseWorld);
```

## Precision note

- `rotateVectorByQuaternion` is the DOUBLE-precision rotation;
  `transformPoint` runs on gl-matrix's Float32Array backing (~2e-8
  relative loss — fine for odom points). Geo-side math (vote offsets,
  minting) must use the double variant.

## Tests

- `qr-pose.test.ts` — unit coverage of every export incl. mirror/degenerate
  rejection, reprojection gating, and the orchestration round-trip with a stub
  solver that inverts `qrInCameraFromOpenCv` (no OpenCV needed).
- `qr-pose.property.test.ts` — (1) intrinsics pinhole matches the GL projection
  for any frustum; (2) OpenCV↔WebXR projection agreement for any pose; (3)
  size↔distance linearity (the premise of the §7 occupancy self-check); (4) full
  `solveQrPose` round-trip recovers the synthetic world pose.

## Related

- Consumes the same projection-matrix source as
  [depth-unprojection.ts.md](../depth-unprojection.ts.md).
- The injected `SolvePnpSquare` is implemented by the pure-JS
  [planar-pnp.ts.md](planar-pnp.ts.md) (`PlanarPnpSquare`, IPPE) — synchronous,
  no OpenCV/WASM/worker.
- `qrPoseWorld` feeds the synthetic GPS-vote bridge (Phase 5) and the occupancy
  plausibility self-check (Phase 4).
