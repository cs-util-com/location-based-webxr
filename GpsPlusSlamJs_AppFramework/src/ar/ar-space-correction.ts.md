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
- `COMPENSATE_CAMERA_MOTION = true` (see Parameters).
- `IDENTITY_POSE` (frozen).
- `composeRigid(a, b)` (`a ∘ b`: first `b`, then `a`).
- `poseToMatrix4(p)`: column-major 4x4 (three.js `fromArray` order); `multiplyMatrix4(a, b)`: `a * b`.
- Internal `extrapolatePose(prev, tPrev, last, tLast, t)` (used by `jumpTransform`): the camera pose at `t` at constant rates (position linear, orientation at a constant angular rate: `q = (q_last q_prev^-1)^s q_last`, `s = (t - tLast) / (tLast - tPrev)`); frame-invariant.
- `jumpTransform(jump, compensate?)`: `D`. Uncompensated `D = B * P_a * P_b^-1 * B^-1` (`P_a = newPose`, `P_b = lastPose`); compensated, `P_b` is replaced by the camera pose extrapolated to `t`. Without an earlier frame, or with `tPrev` not before `tLast`, the uncompensated form is used.
- `correctionTrack(jumps)`: `Delta(0..n)`, computed backwards (`Delta(e) = Delta(e+1) ∘ D_e`).
- `epochAt(times, capturedAt)`: the number of times `<= capturedAt` (binary search; an item at exactly `t` belongs to the new segment). Throws `TypeError` for a NaN or non-number capture time; `Infinity` gives `n`.
- `shownLocalMatrix(delta, parentToGroup, xRaw)`: `P^-1 * Delta * P * X_raw`. Throws `RangeError` for a non-invertible `P`.

## Invariants & assumptions

- **Double precision throughout:** every product writes into `Float64Array`s. gl-matrix's default outputs are Float32 (about 1e-7 relative), which `qr-pose.ts`'s `composePose` uses, so it is not reused here: a 3 m jump must survive to 1e-9.
- `quaternionPower` uses `atan2`, not `acos`: `acos(w)` loses half the digits near `w = 1`, which is where a one-frame rotation step lives.
- Quaternions are normalised on entry; validation (finite, near unit, time order) is the slice's job (`state/ar-space-correction-slice.ts`).
- `times` passed to `epochAt` must be non-decreasing; the slice guarantees it.

## Parameters

- **`COMPENSATE_CAMERA_MOTION = true`.** Between the last frame before the jump and the jump frame the camera itself moves; uncompensated, that motion is read as part of the jump and moves every corrected object by it. Measured in `ar-space-correction.test.ts` on a user walking at 1.4 m/s and turning the head about a neck pivot 0.1 m behind the lens (not exactly the compensation's model: the lens runs on an arc), with a fixed 3 m, 4 deg yaw, 1 deg tilt frame switch. Largest residual within 10 m and 50 m of the camera:
  - dt 33 ms, 10 deg/s: compensated 3.3e-6 m; uncompensated 0.10 m at 10 m, 0.33 m at 50 m.
  - dt 33 ms, 30 deg/s: compensated 3.0e-5 m; uncompensated 0.22 m, 0.91 m.
  - dt 100 ms, 10 deg/s: compensated 3.1e-5 m; uncompensated 0.32 m, 1.01 m.
  - dt 100 ms, 30 deg/s: compensated 2.7e-4 m; uncompensated 0.66 m, 2.76 m.
  - dt 200 ms, 10 deg/s: compensated 1.2e-4 m; uncompensated 0.63 m, 2.03 m.
  - dt 200 ms, 30 deg/s: compensated 1.1e-3 m; uncompensated 1.32 m, 5.51 m.
  - dt 500 ms, 10 deg/s: compensated 7.6e-4 m; uncompensated 1.58 m, 5.06 m.
  - dt 500 ms, 30 deg/s: compensated 6.8e-3 m; uncompensated 3.28 m, 13.72 m.
  - Verdict across the whole range: the compensation wins at every point, and stays under 0.05 m. The compensated residual is the same at both radii because the yaw is exact under a constant rate; only the arc-versus-line position error remains. What would reverse it: strong angular acceleration within one frame interval (not modelled). A static camera gives the same `D` either way (property test).
- **No cap on the extrapolation ratio `(t - tLast) / (tLast - tPrev)`.** A first version fell back to the uncompensated `D` past a ratio of 4, on the reasoning that one short interval's velocity, stretched over a long gap, amplifies its pose noise. Measured instead (`ar-space-correction.test.ts`, "extrapolation ratio sweep"): 300 seeded runs per cell, a 33 ms measured interval, Gaussian pose noise on all three camera poses, residual at 10 m from the camera, p50 in metres (compensated versus uncompensated):
  - still user, noise 1 mm and 0.05 deg: ratio 1: 0.035 versus 0.020; ratio 4: 0.087 versus 0.019; ratio 10: 0.208 versus 0.019; ratio 15: 0.294 versus 0.020.
  - walking 1.4 m/s and turning 10 deg/s, noise 1 mm and 0.05 deg: ratio 6: 0.125 versus 0.624; ratio 10: 0.209 versus 1.039.
  - walking and turning 10 deg/s, noise 3 mm and 0.2 deg: about equal at ratio 1 (0.134 versus 0.129); compensated better past 4 (ratio 10: 0.815 versus 1.043).
  - walking and turning 30 deg/s: compensated better at every ratio (ratio 10, noise 1 mm and 0.05 deg: 0.209 versus 2.175).
  - Verdict: the ratio does not separate the cases where the compensation helps from those where it hurts; the camera's own motion does. A ratio cap made the walking user worse at every ratio above it, so it was removed (less code). The feed's 500 ms gap rule still bounds the absolute gap. What would reverse it: field data showing jumps mostly while the camera stands still with long frame gaps; the answer then is a motion-aware rule (compensate only above a measured speed), not a ratio cap.

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

- `ar-space-correction.property.test.ts` (three.js as the oracle): `D` for a still camera (1e-9); for a moving and turning camera with the compensation, with the gap `t - tLast` drawn apart from the measured interval (ratio 0.5 to 4; 1e-8); static camera equality; composition order over random jumps; `epochAt` against a linear count.
- `ar-space-correction.test.ts`: the default, the compensation sweep and the ratio sweep (tables above; set `AR_SPACE_SWEEP_OUT` to a file path to have them written there), the exact ratio `(t - tLast) / (tLast - tPrev)` against its inverse, the fallback when `tPrev` is not before `tLast`, two jumps in order, `epochAt` edge cases, `shownLocalMatrix` against three.js.
- `ar-space-correction.structure.test.ts`: no three.js, no store import.
