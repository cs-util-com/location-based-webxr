# `planar-pnp.ts` — pure-JS planar-square PnP (IPPE)

## Purpose

OpenCV-free implementation of `qr-pose.ts`'s injected `SolvePnpSquare` for a
centered planar square (the `SOLVEPNP_IPPE_SQUARE` case). Synchronous, no WASM,
no worker, no async load — the OpenCV-free `SolvePnpSquare` (it replaced the
removed `opencv-pnp.ts`). See the
plan: [`../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-2310-planar-pnp-homography-no-opencv-plan.md`](../../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-16-2310-planar-pnp-homography-no-opencv-plan.md).

## Public API

- `class PlanarPnpSquare implements SolvePnpSquare` — `solve(objectPoints,
imagePoints, intrinsics) → OpenCvPnpResult | null`. Stateless; construct once
  and reuse, or per call. Returns `null` for `<4` points, length mismatch,
  non-finite/invalid intrinsics, degenerate (collinear) correspondences, or a
  best candidate that lands behind the camera.
- `solveLinear(A, b) → number[] | null` — dense `n×n` solve (Gaussian
  elimination + partial pivoting). `A` is row-major length `n²`. `null` if
  singular or size-mismatched.
- `homographyFromCorrespondences(objectXY, imageXY) → Homography | null` — exact
  4-point DLT (8×8, `h₃₃ = 1`). `null` when degenerate.
- `ippePoseCandidates(H) → PoseCandidate[]` — the IPPE candidate generator (see
  below). Up to 4 chirality-valid candidates; `[]` when degenerate.
- `realIppeCandidates(H) → PoseCandidate[]` — the subset of
  `ippePoseCandidates` that can be the true pose: the smaller-depth root
  `τ = 1/σ_max`, both signs (the mirror-flip pair). The other root has
  `τ²·(G1 + G2) > 2`, so it needs a negative squared z-component that is
  clamped away, and is a rotation only because `nearestRotation3x3` forces
  it into one. Used by `qr-multi-view-pose.ts` for its starts;
  `PlanarPnpSquare` still picks among ALL candidates (owner decision, QR
  near-frontal pose plan 2026-09-23-2314 §10: removing the invalid root
  alone made the near-frontal median worse).
- `nearestRotation3x3(M) → Mat3` — projects a near-orthogonal matrix onto SO(3)
  via iterative polar decomposition (Higham), forcing `det = +1`.
- `rotationToRodrigues(R) → Vector3` — row-major rotation → axis·angle vector
  (handles the near-0 and near-180° cases), double-precision.
- Types: `Mat3` (row-major 3×3), `Homography` (= `Mat3`), `PoseCandidate`
  (`{ R: Mat3, t: Vector3 }`).

## Invariants & assumptions

- **Frames:** object frame is +x right, +y UP, z = 0 (from `buildObjectPoints`);
  image is pixels, top-left origin, y DOWN; output `R,t` are the OpenCV camera
  convention (`p_cam = R·p_obj + t`, +y down, +z forward) — exactly what
  `cv.solvePnP` produced, so `qrInCameraFromOpenCv` and the rest of `solveQrPose`
  are unchanged.
- **Row-major** 3×3 everywhere in this file (NOT gl-matrix's column-major) — see
  `mul3`/`transpose3`. Conversions to gl-matrix happen only in tests.
- **Double precision throughout.** gl-matrix's Float32 arrays are deliberately
  avoided in the solver core so the 4 px reprojection gate sees the true error.
- **IPPE math:** with `[r1 r2]` the first two columns of `R`, the first-order map
  at the model origin gives `M·[r1 r2] = t_z·J` (`M = [[1,0,-p],[0,1,-q]]`,
  `(p,q)` = origin's normalized image, `J` = 2×2 homography Jacobian there).
  Aligning the origin ray to +z (rotation `Rv`) reduces this to a 2×2 block
  `B = τ·g`; orthonormality of `[r1 r2]` then yields the biquadratic
  `D²·τ⁴ − S·τ² + 1 = 0` (`S = ‖g‖_F²`, `D = det g`). Its two `τ²` roots are the
  two planar poses (coincident fronto-parallel → no flip). Each root yields the
  in-plane axes' z-components up to a sign; both signs are emitted and the
  caller's reprojection pick + `solveQrPose`'s 4 px gate select the right one.
- **No SVD / eigensolver** — the 2×2 closed form and polar iteration are all that
  is needed (gl-matrix has neither).
- **Defensive:** every public function validates shape/finiteness and returns
  `null`/`[]` rather than throwing on bad input (except `buildObjectPoints`,
  which is in `qr-pose.ts`).

## Examples

```ts
import { PlanarPnpSquare } from './planar-pnp.js';
import { solveQrPose, buildObjectPoints } from './qr-pose.js';

const solver = new PlanarPnpSquare();
const solution = solveQrPose({
  imagePoints, // 4 detected corners TL,TR,BR,BL (detector-buffer pixels)
  sizeM, // printed side length
  intrinsics, // from intrinsicsFromProjection(detectorProjection, W, H)
  cameraPose, // capturing camera in raw-WebXR/odom space
  solver,
});
```

## Tests

- `planar-pnp.test.ts` — sub-kernels (linear solve incl. pivot-swap + singular,
  polar rotation incl. reflection→proper, Rodrigues incl. near-180°, degenerate
  homography), and `solve` on fronto-parallel/tilted/strong-tilt-flip plus the
  rejection paths (`<4` pts, non-finite, bad intrinsics).
- `qr-multi-view-pose.test.ts` — `realIppeCandidates` keeps exactly the
  smaller-depth root and it contains the true rotation (tilts 5-50°).
- `planar-pnp.property.test.ts` — random poses in a realistic viewing cone:
  reproject to ~0 px **and** recover ground-truth orientation (proves the flip
  disambiguation); a sub-pixel-noise variant asserts bounded graceful
  degradation.
- `qr-pose.property.test.ts` — an end-to-end block feeds the REAL
  `PlanarPnpSquare` (no stub) through `solveQrPose` and requires the recovered
  world pose to match ground truth.

## Known limitations / follow-ups

- The **tilt-flip is a fundamental planar ambiguity**: under heavy corner noise
  near fronto-parallel the reprojection pick can choose the wrong candidate. The
  sliding-window aggregation downstream and sub-pixel corner refinement (a
  separate follow-up) are the mitigations — not this solver. The joint solve
  over several views (`qr-multi-view-pose.ts`) is the one that removes it.
- Translation/scale accuracy depends on a correct printed size and intrinsics;
  reprojection error is size-invariant, so a wrong size shows up as a scaled
  `t`, not a rejected solve.
