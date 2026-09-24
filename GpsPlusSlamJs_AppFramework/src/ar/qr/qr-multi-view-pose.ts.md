# qr-multi-view-pose.ts

## Purpose

Solves one static QR code's **world rotation** jointly over several
detections of it from different camera poses. A single frame of a small,
near-frontal code barely constrains its tilt, and the mirror-flipped pose
fits that frame almost as well as the truth. Views from different places,
whose camera poses SLAM supplies, constrain both. (QR near-frontal pose plan
2026-09-23-2314, M3a; the formulation was chosen by the M0 walk sweeps.)

## Public API

- `solveQrPoseMultiView(views, sizeM, options?) → QrMultiViewPoseResult | null`
  - `views: QrViewObservation[]`, each `{ corners, cameraPose, intrinsics }`:
    the 4 corners in symbol order (TL, TR, BR, BL, pixels, y down), the
    capturing camera's world (raw-WebXR/odom) pose, and the intrinsics of
    the exact buffer the corners came from.
  - `sizeM`: the printed side length, metres.
  - `options.robustScalePx` (default 1): corner errors beyond it count
    linearly, not squared. `Infinity` = plain least squares.
  - `options.maxIterations` (default 30): the cap per start.
  - `options.maxStarts` (default 3): how many starts are refined.
  - Result:
    - `rotation`: the code's world rotation, `[x, y, z, w]`;
    - `position`: the mean of the views' own code positions;
    - `costPx`: the RMS corner error over all views;
    - `views`: the number of views used;
    - `tiltSigmaDeg`: the tilt's FORMAL 1-sigma for 1 px of corner noise,
      along its worst direction (`Infinity` when undetermined). Relative
      and optimistic: see "Tilt uncertainty" below before using it;
    - `starts`: distinct starts refined; `iterations`: accepted
      Gauss-Newton steps summed over them (rejected damping tries, the
      ranking pass and the uncertainty's Jacobian are extra work).
  - `null` when:
    - there is no view, or `sizeM` is not a positive finite number;
    - an option is out of range (`robustScalePx <= 0`, `maxStarts < 1`,
      `maxIterations < 1` or NaN);
    - any view is unusable: not 4 finite corners in front-facing winding
      (`validateQuad`), bad intrinsics, a non-finite camera pose or one
      whose quaternion norm is more than 1e-3 from 1, or no single-frame
      solve or real candidate. ONE such view nulls the whole window: the
      caller filters views first (M3b uses `validateQuad`, as the raw path
      already does);
    - no start converges.

## How it works

- **Formulation `rotSharedFixedT`.** One rotation is shared by all views
  (3 unknowns). Each view's code position is fixed at its own single-frame
  solve (`PlanarPnpSquare`, the lowest reprojection error over all IPPE
  candidates). The per-view positions absorb SLAM's per-frame pose error.
  - **Why not one shared position.** Measured (plan §12): with a perfect
    SLAM pose the TRUE position would cut p95 by a quarter to a half. But with 0.2°/5 mm of
    SLAM noise a fixed world position (true or mean) is worse at every
    distance measured: p95 10.6° vs 1.1° at 0.8 m, and about level at 2.5 m.
  - **Why the pick's position, not the real root's.** Measured over noise
    0.25-2 px, 0.8-2.5 m and SLAM noise 0-0.5°/10 mm: the real root's
    position was never better, and at close range worse (p95 1.55° vs 1.26°
    at 0.8 m and 0.5 px).
- **Starts.** Every view's REAL IPPE candidates (`realIppeCandidates`: the
  true pose and its mirror flip), converted to world rotations, are
  de-duplicated within 2°. They are then ranked by their robust cost over all
  views, and the cheapest `maxStarts` are refined; the lowest final cost
  wins. A view's flip fits the other views badly, so it ranks low.
  - **Why 3.** Measured over 360 noisy walks (plan §12) and 18 cells of the
    milestone review (§13): 3 starts give the same answer as refining all
    13-16 (none differs by more than 0.1°), at about a fifth of the time.
    2 did not hold in one-sided near-frontal windows.
- **Refinement.** Damped Gauss-Newton on the corners' pixel error with a
  robust loss: per-corner weight 1 inside `robustScalePx`, `scale / error`
  outside. The Jacobian is numeric (central differences, 1e-6 rad) and the
  perturbation is local (`q · exp(δ)`). A start converges when the step is
  below 1e-8 rad or the cost falls by less than 1e-9 of itself. A looser
  1e-6 or 1e-4 changed answers in the sweep, so it was not taken. Still
  windows at 1-2 m and 1 px of noise still reach the 30-step cap on some
  starts (up to 90 accepted steps per solve), costing at most 0.035° (§13).
- **Tilt uncertainty.** The inverse of `JᵀWJ` at the solution. Its 2x2 block
  on the code-local x and y axes (the ones that tilt the normal) gives the
  larger eigenvalue, whose square root in degrees is `tiltSigmaDeg`.
  - **It is NOT calibrated.** It treats each view's position as exact,
    though the position comes from the same corners. Measured by the
    milestone review (§13): it under-reads the real tilt error by
    1.3-1.45x on arcs, 1.3-3.4x for still windows (worse far away) and up
    to 4.3x from one spot 10° off the normal. It also separates still from
    arc less than reality does. Use it to rank windows, not as a threshold
    in degrees, until M3b calibrates it.

## Invariants & assumptions

- All maths in double precision. This is why it does not use `composePose`
  or `transformPoint`, which are Float32 through gl-matrix.
- Frames:
  - world: WebXR, y up;
  - camera: WebXR (−z forward);
  - IPPE candidates: OpenCV frame, converted by `Rx(π) = diag(1, −1, −1)`.
- A window of views from ONE spot (a still phone) is solved, but its tilt is
  only as good as one frame's. `tiltSigmaDeg` points that way (about 2°
  per px, against about 1° from an arc), but see its calibration above.
- **Known limitation.** Under corner noise with near-frontal views, the
  lowest-cost minimum is sometimes the mirror flip. How often is not
  settled: a single start had a better tail than the global minimum in one
  sweep and a worse one in another cell (§12, §13). The mounting prior
  (plan M3b) is the tie-breaker meant for it; this module has none.

## Examples

```ts
import { solveQrPoseMultiView } from 'gps-plus-slam-app-framework/ar';

const res = solveQrPoseMultiView(
  window.map((d) => ({
    corners: d.corners,
    cameraPose: d.cameraPose,
    intrinsics: d.intrinsics,
  })),
  0.16
);
if (res && res.costPx < 2) useRotation(res.rotation);
```

## Tests

- `qr-multi-view-pose.test.ts` covers:
  - `realIppeCandidates` keeps the smaller-depth root, which contains the
    truth;
  - exact recovery (rotation and position);
  - no mirror flip, both across the normal and all on one side of it
    near-frontal;
  - a single oblique view;
  - the capped pull of one bad corner (10/25/50 px);
  - `tiltSigmaDeg` ordering (still vs arc);
  - invalid input and options, including a non-unit camera quaternion and a
    window with one bad view among good ones;
  - under noise, the joint rotation beats a single frame by a wide margin,
    and with one start the CHEAPEST is refined;
  - planted bugs (2026-09-24): a refinement that returns its start, a
    reversed ranking, `every` -> `some` on the views, a wrong mean and the
    old norm check each fail at least one test;
  - agreement with the M0 prototype (`test-utils/qr-multiview-prototype.ts`)
    on 36 noisy walks, centred and one-sided, at 1.2 and 2.5 m;
  - a deterministic work bound (starts, iterations) on a window of 8;
  - a seeded property test over random code rotations, walks and
    obliqueness (`offsetDeg` ±40°).
- The walk sweeps in `qr-zxing.sweep.test.ts` measure it on rendered frames
  (opt-in `QR_SWEEP=1`, not in the gate), as the `prod` column.
