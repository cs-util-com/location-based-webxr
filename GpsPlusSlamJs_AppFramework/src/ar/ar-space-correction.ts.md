# ar-space-correction.ts

## Purpose

The pure math of the AR-space correction: the rigid jump `D` an ARCore relocalization makes, the correction `Delta(e)` of every older observation epoch, the epoch of an item from its capture time, and the shown local matrix of an object. No three.js, no store; every value here is derived from raw observations and is never dispatched or recorded.

## Frames

- **R:** the raw WebXR frame. **O:** the odometry NUE frame of the AR world group, `O = B * R` with `B` the WebXR-to-NUE basis (`webxrToNUE`, `webxrQuaternionToNUE` from `gps-plus-slam-js`).
- **D_j:** the jump of observation `j`, in O. A point at `x` in the old frame is at `D * x` in the new one.
- **Delta(e):** the correction of epoch `e`: the product of every `D_j` with `j >= e`, the most recent on the left. The reference frame is "now", so `Delta(n) = I` for `n` observations.
- **P:** the transform from an object's parent into O (identity for a direct child of the group).

## Public API

- `RelocalizationJump`: `{ t, tLast, lastPose, tPrev, prevPose, newPose }`, raw WebXR camera poses (`Pose` from `qr/qr-pose.ts`) and epoch-ms XR-clock times. `tPrev` and `prevPose` are both `null` when no earlier frame exists.
- `CompensationMode`: `'guarded' | 'always' | 'off'`; `CAMERA_MOTION_COMPENSATION = 'guarded'`, `COMPENSATION_MIN_STEP_M = 0.005`, `COMPENSATION_MIN_TURN_DEG = 0.25`, `MAX_COMPENSATION_GAP_MS = 500` (see Parameters).
- `compensationVerdict(jump, mode?)`: `{ compensated, reason, stepM, turnDeg }`. `reason` is `moving` or `always` when compensated, else `still`, `off`, `no-earlier-frame`, `no-rate` (`tPrev` not before `tLast`) or `gap` (`t - tLast` over `MAX_COMPENSATION_GAP_MS`). `stepM` and `turnDeg` are the camera's measured step and turn between `prevPose` and `lastPose` (`null` without an earlier frame); the feed logs them, which is how a field recording measures the phone's noise floor.
- `IDENTITY_POSE` (frozen).
- `composeRigid(a, b)` (`a ∘ b`: first `b`, then `a`); `invertRigid(a)`: the inverse rigid transform.
- `poseToMatrix4(p)`: column-major 4x4 (three.js `fromArray` order); `multiplyMatrix4(a, b)`: `a * b`.
- Internal `extrapolatePose(prev, tPrev, last, tLast, t)` (used by `jumpTransform`): the camera pose at `t` at constant rates (position linear, orientation at a constant angular rate: `q = (q_last q_prev^-1)^s q_last`, `s = (t - tLast) / (tLast - tPrev)`); frame-invariant.
- `jumpTransform(jump, mode?: CompensationMode)`: `D`. Uncompensated `D = B * P_a * P_b^-1 * B^-1` (`P_a = newPose`, `P_b = lastPose`); compensated, `P_b` is replaced by the camera pose extrapolated to `t`. Which one is used is `compensationVerdict`'s call. A gap over 500 ms (ratio 15 at 30 Hz, 30 at 60 Hz, 45 at 90 Hz) falls back to the uncompensated form in every mode: an observation is never refused for it, so a replayed one that breaks the feed's gap rule keeps its jump.
- `correctionTrack(jumps)`: `Delta(0..n)`, computed backwards (`Delta(e) = Delta(e+1) ∘ D_e`).
- `epochAt(times, capturedAt)`: the number of times `<= capturedAt` (binary search; an item at exactly `t` belongs to the new segment). Throws `TypeError` for a NaN or non-number capture time; `Infinity` gives `n`.
- `shownLocalMatrix(delta, parentToGroup, xRaw)`: `P^-1 * Delta * P * X_raw`. Throws `RangeError` for a non-invertible `P`.

## Invariants & assumptions

- **Double precision throughout:** every product writes into `Float64Array`s. gl-matrix's default outputs are Float32 (about 1e-7 relative), which `qr-pose.ts`'s `composePose` uses, so it is not reused here: a 3 m jump must survive to 1e-9.
- `quaternionPower` uses `atan2`, not `acos`: `acos(w)` loses half the digits near `w = 1`, which is where a one-frame rotation step lives.
- Quaternions are normalised on entry; validation (finite, near unit, time order) is the slice's job (`state/ar-space-correction-slice.ts`).
- `times` passed to `epochAt` must be non-decreasing; the slice guarantees it.

## Parameters

- **`CAMERA_MOTION_COMPENSATION = 'guarded'`: compensate only a camera that measurably moved.** Between the last frame before the jump and the jump frame the camera itself moves; uncompensated, that motion is read as part of the jump and moves every corrected object by it. Measured in `ar-space-correction.test.ts` on a user walking at 1.4 m/s and turning the head about a neck pivot 0.1 m behind the lens (not exactly the compensation's model: the lens runs on an arc), with a fixed 3 m, 4 deg yaw, 1 deg tilt frame switch. Largest residual within 10 m and 50 m of the camera:
  - dt 33 ms, 10 deg/s: compensated 3.3e-6 m; uncompensated 0.10 m at 10 m, 0.33 m at 50 m.
  - dt 33 ms, 30 deg/s: compensated 3.0e-5 m; uncompensated 0.22 m, 0.91 m.
  - dt 100 ms, 10 deg/s: compensated 3.1e-5 m; uncompensated 0.32 m, 1.01 m.
  - dt 100 ms, 30 deg/s: compensated 2.7e-4 m; uncompensated 0.66 m, 2.76 m.
  - dt 200 ms, 10 deg/s: compensated 1.2e-4 m; uncompensated 0.63 m, 2.03 m.
  - dt 200 ms, 30 deg/s: compensated 1.1e-3 m; uncompensated 1.32 m, 5.51 m.
  - dt 500 ms, 10 deg/s: compensated 7.6e-4 m; uncompensated 1.58 m, 5.06 m.
  - dt 500 ms, 30 deg/s: compensated 6.8e-3 m; uncompensated 3.28 m, 13.72 m.
  - Verdict across the whole range: the compensation wins at every point, and stays under 0.05 m. The compensated residual is the same at both radii because the yaw is exact under a constant rate; only the arc-versus-line position error remains. What would reverse it: strong angular acceleration within one frame interval (not modelled). A static camera gives the same `D` either way (property test).
- **No cap on the extrapolation ratio `(t - tLast) / (tLast - tPrev)` yet.** A first version fell back to the uncompensated `D` past a ratio of 4, on the reasoning that one short interval's velocity, stretched over a long gap, amplifies its pose noise. Measured instead (`ar-space-correction.test.ts`, "extrapolation ratio sweep"): 300 seeded runs per cell, Gaussian pose noise on all three camera poses, residual at 10 m from the camera, p50 in metres (compensated versus uncompensated). Ratios 1 to 15 use a 33 ms measured interval (30 Hz); ratio 30 uses 16.7 ms (60 Hz) and ratio 45 uses 11.1 ms (90 Hz), so those and ratio 15 are each a 500 ms gap, the longest the feed may hand over:
  - still user, noise 1 mm and 0.05 deg: ratio 1: 0.035 versus 0.020; ratio 4: 0.087 versus 0.019; ratio 10: 0.208 versus 0.019; ratio 15: 0.294 versus 0.020; ratio 30 (60 Hz): 0.601 versus 0.021; ratio 45 (90 Hz): 0.850 versus 0.020.
  - walking 1.4 m/s and turning 10 deg/s, noise 1 mm and 0.05 deg: ratio 6: 0.125 versus 0.624; ratio 10: 0.209 versus 1.039; ratio 30 (60 Hz): 0.601 versus 1.575; ratio 45 (90 Hz): 0.849 versus 1.574.
  - walking and turning 10 deg/s, noise 3 mm and 0.2 deg: about equal at ratio 1 (0.134 versus 0.129); compensated better from ratio 4 to 15 at 30 Hz (ratio 10: 0.815 versus 1.043; ratio 15: 1.196 versus 1.564); **plain better at a 500 ms gap at 60 and 90 Hz** (ratio 30: 2.226 versus 1.575, p95 4.386 versus 1.663; ratio 45: 3.576 versus 1.573, p95 5.901 versus 1.672).
  - walking and turning 30 deg/s: compensated better at every ratio at noise up to 1 mm and 0.05 deg (ratio 10: 0.209 versus 2.175; ratio 45 at 90 Hz: 0.846 versus 3.288). At 3 mm and 0.2 deg: ratio 30 at 60 Hz 2.215 versus 3.288 (but p95 4.358 versus 3.375); ratio 45 at 90 Hz plain better, 3.575 versus 3.286.
  - Verdict: for pose noise up to 1 mm and 0.05 deg the camera's motion, not the ratio, separates the cases: the compensation wins for every walker at every ratio above 4 and loses for every still user, so a ratio cap would only hurt. At 3 mm and 0.2 deg the ratio matters too: a 500 ms gap measured over one 60 or 90 Hz frame amplifies the noise past what the walker's own motion costs. The noise level that reverses the walker's verdict lies between 1 mm / 0.05 deg and 3 mm / 0.2 deg.
  - **The guard, built from this:** the verdict above says the camera's motion separates the cases, so `guarded` compensates when the step between `prevPose` and `lastPose` exceeds `COMPENSATION_MIN_STEP_M = 0.005` m or the turn exceeds `COMPENSATION_MIN_TURN_DEG = 0.25` deg, and uses the plain `D` otherwise. Guarded sweep (`ar-space-correction.test.ts`, "guarded sweep"; 300 seeds, p50 at 10 m; still user, slow walker 0.3 m/s and 3 deg/s, walker 1.4 m/s and 10 deg/s; ratio 1 and 10 at 33 ms): at noise 0.5 mm / 0.01 deg and 1 mm / 0.05 deg the guarded result is within 25 % plus 1 cm of the better of plain and compensated in every cell (pinned): the still user gets the plain `D`, both walkers the compensated one. At 3 mm / 0.2 deg a still phone's noise alone passes the thresholds and the guard compensates (still user, ratio 1: 0.139 versus plain 0.077; ratio 10: 0.777 versus 0.075): reported, not pinned. **The thresholds are provisional** until the real phone's noise floor is measured; the feed logs `stepM` and `turnDeg` of every observation for that. The value that reverses the still user's verdict is a per-frame noise above the thresholds (about 3 mm / 0.2 deg).
  - **The measured case that motivated the guard**: walking 1.4 m/s and turning 10 deg/s, noise 3 mm and 0.2 deg, a 500 ms gap at 60 Hz (ratio 30) or 90 Hz (ratio 45): the compensated `D` is 2.2 to 3.6 m off at 10 m, the plain one 1.6 m. The candidates are a rule on the camera's measured speed against the noise, or measuring the rate over a longer window than one frame; a plain ratio cap is wrong for low noise (see above). Requirement on the feed meanwhile: `t - tLast` at most 500 ms. The guard leaves this case as it was: the walker passes the thresholds, so it is compensated (2.2 to 3.6 m against the plain 1.6 m); a ratio-aware rule is still open.

## Examples

```ts
const d = jumpTransform(observation); // D in O
const track = correctionTrack(observations.map((o) => jumpTransform(o)));
const e = epochAt(
  observations.map((o) => o.t),
  tile.capturedAt
);
const local = shownLocalMatrix(track[e], parentToGroup, xRaw);
```

## Tests

- `ar-space-correction.property.test.ts` (three.js as the oracle): `D` for a still camera (1e-9); for a moving and turning camera with the compensation, with the gap `t - tLast` drawn apart from the measured interval (ratio 0.5 to 4, gap at most `MAX_COMPENSATION_GAP_MS`; 1e-8); static camera equality; composition order over random jumps; `epochAt` against a linear count.
- `ar-space-correction.test.ts`: the default (`guarded`), the guard's threshold cells on both axes, the gap fallback in every mode, the named reasons, the guarded sweep (above), the compensation sweep and the ratio sweep at matched frame rates (tables above, verdict per cell pinned; set `AR_SPACE_SWEEP_OUT` to a file path to have them written there), the exact ratio `(t - tLast) / (tLast - tPrev)` against its inverse, the fallback when `tPrev` is not before `tLast`, two jumps in order, `epochAt` edge cases, `shownLocalMatrix` against three.js.
- `ar-space-correction.structure.test.ts`: no three.js, no store import.
- **Mutation pass** (44 hand-written mutants, run in a separate copy against `ar-space-correction*.test.ts`, `state/ar-space*` and the registry tests): 40 killed. The four survivors are equivalent within floating-point rounding:
  - `composeRigid` without its final normalise: both inputs pass through `unit`, so the product is unit to rounding, and every later use normalises again.
  - `extrapolatePose` without normalising the step `q_last q_prev^-1`: `quaternionPower` is independent of the quaternion's length (`atan2(n, w)` and `sin(half) / n` both scale out).
  - `extrapolatePose` without normalising the result: a product of two unit quaternions (the power keeps unit length).
  - `quaternionPower` choosing the hemisphere with `w <= 0` instead of `w < 0`: differs only at `w = 0` exactly, a 180 deg step, where both hemispheres are valid answers.
