# `user-heading.ts`

## Purpose

Compute the user's **absolute view-direction bearing** (degrees clockwise from
true geographic north) from the latest AR camera rotation plus the GPS+SLAM
alignment matrix. Feeds the live/replay map overlay's view-direction line
(Finding 2 of
[`2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md`](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-06-28-1822-map-rings-transparency-and-view-direction-user-feedback.md)).

## Public API

- `computeUserHeadingDeg(input): number | null`
  - `input.odometryRotation?: Quaternion | null` — latest NUE quaternion
    `[x,y,z,w]`, exactly as stored in `gpsEvents.odometryRotations`.
  - `input.alignmentMatrix?: Matrix4 | null` — column-major AR-NUE → world-NUE
    metres (the same matrix `computeFusedPath` applies to positions).
  - Returns a bearing in `[0, 360)`, or `null` when undefined.
- `UserHeadingInput` — the input interface above.

## Invariants & assumptions

- **Frame algebra** (pinned by `user-heading.test.ts`):
  - State stores rotations as NUE quaternions (`webxrQuaternionToNUE` in the
    library reducer). NUE = X-North, Y-Up, Z-East.
  - The camera-forward basis vector in the NUE-AR frame is **`[1,0,0]`**, because
    a WebXR camera looks down its own −Z and `webxrToNUE([0,0,-1]) = [1,0,0]`
    (an identity camera looks North).
  - Forward is rotated into world NUE by the alignment matrix's **linear part**
    (computed via a point-pair subtraction so translation cancels). The bearing
    is `atan2(East, North)` of that world direction.
- **Why not round-trip through `calcGpsCoords`?** lat/lon scale North and East by
  different metres-per-degree, so a bearing taken between two reconstructed
  lat/lng points is anisotropically distorted. The aligned NUE metres already
  carry the true bearing, so reading `atan2(East, North)` directly is simpler
  **and** undistorted.
- **Returns `null` when:** no rotation yet, no alignment matrix yet (before the
  first solve), the camera points within ~4.6° of straight up/down
  (`VERTICAL_GUARD = 0.08`; `horiz/len = sin(angle from vertical)` so the cutoff
  is `asin(0.08) ≈ 4.6°` — equivalently pitched more than ~85° from horizontal —
  mirroring the library's guard) where a 2D bearing is meaningless, **or any
  input is non-finite** — a `NaN`/`Infinity` quaternion or alignment-matrix
  component propagates into the derived `len`/`horiz`, whose finiteness is guarded
  so a bad sensor sample degrades to `null` instead of emitting a `NaN` bearing
  that would poison `headingUpQuat`. The guard is on the derived values (not a
  per-element input scan) to avoid a per-frame closure allocation at 30–60 Hz.
- **Zero-copy, read-only inputs (2026-07-04).** The caller's quaternion and
  alignment matrix are passed straight into gl-matrix (`Quaternion` satisfies
  `ReadonlyQuat`, `Matrix4` satisfies `ReadonlyMat4`) — no per-call
  `mat4.fromValues` copy on this 30–60 Hz path. The transforms only read them;
  the frozen-input test pins that contract (a write would throw under strict
  mode and fail the value comparison).
- **Position-independent.** The heading is a pure direction; the consumer draws
  the line only when it also has a user-position dot to anchor it to.
- **Lives in the app-framework, NOT the library's `orientation-heading.ts`** —
  that module is the _magnetic_ (AbsoluteOrientationSensor → ENU) path needing
  WMM declination correction; Finding 2's source is the alignment matrix → true
  geographic north, which rejects the magnetic sensor. Uses gl-matrix (already a
  framework dependency) rather than expanding the library's public surface.

## Examples

```ts
import { computeUserHeadingDeg } from './user-heading';

// Identity camera under identity alignment → looks North.
computeUserHeadingDeg({
  odometryRotation: [0, 0, 0, 1],
  alignmentMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
}); // → 0

// Before the first alignment solve.
computeUserHeadingDeg({
  odometryRotation: [0, 0, 0, 1],
  alignmentMatrix: null,
}); // → null
```

## Tests

- [`user-heading.test.ts`](user-heading.test.ts) — cardinal-direction bearings,
  alignment-rotation application, camera+alignment composition, null cases
  (no rotation / no matrix / near-vertical), non-finite-input degradation to
  `null` (NaN/±Infinity in the quaternion or matrix, incl. the translation
  column), plus property tests (range `[0,360)` and yaw-equivariance).
- Consumed via `buildMapData` ([`map-data.test.ts`](../visualization/map-data.test.ts))
  and rendered via `drawMapData`
  ([`map-overlay-draw.test.ts`](../visualization/map-overlay-draw.test.ts)).
