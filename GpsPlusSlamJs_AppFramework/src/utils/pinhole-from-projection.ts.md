# pinhole-from-projection.ts

## Purpose

PINHOLE camera intrinsics `(fx, fy, cx, cy)` from a recording's WebXR/ARCore
projection matrix. One implementation for every reader of a recording's
lens: the Recorder's COLMAP export (`colmap/colmap-zip-contributor.ts`) and
the Tour Viewer's splat trainer reader (`splat-trainer/recording-reader.ts`).
It moved here from the Recorder's `colmap-conversions.ts`, so the two apps
cannot drift apart on the principal point.

Deep-imported (`gps-plus-slam-app-framework/utils/pinhole-from-projection`),
never through the `utils` barrel.

## Public API

- `pinholeFromProjection(projectionMatrix: Matrix4, width, height): PinholeIntrinsics`
  - Input: a column-major WebXR/ARCore projection matrix and the **JPEG
    frame's pixel dimensions** (after any `resolutionDivisor`).
  - Output: `{ fx, fy, cx, cy }` in pixels.
  - Throws `RangeError` on a non-16/non-finite matrix, non-positive `width`/
    `height`, or a recovered non-positive focal length (degenerate /
    non-forward-facing matrix).
- `PinholeIntrinsics` - the result type.

## Derivation

For a column-major OpenGL-style perspective matrix `m` (`m[col*4+row]`),
projecting a view point and mapping NDC to pixels (top-left origin, y down):

- `fx = 0.5·W·m[0]`, `fy = 0.5·H·m[5]`
- `cx = 0.5·W·(1 − m[8])`, `cy = 0.5·H·(1 + m[9])`

## Invariants & assumptions

- **Continuous pixel convention.** The image spans `[0, W]` with pixel
  centres at half-integers, so a symmetric frustum gives exactly `W/2, H/2`.
  This is the convention 3DGS trainers render with. A caller must not add
  a second step (the integer-centre `W/2 - 0.5`): that shifts every
  principal point by half a pixel.
- **Principal-point caveat:** the `cx`/`cy` formulas are derived (and
  verified against a symmetric frustum), but their off-centre sign
  convention against _real_ ARCore matrices rests on the COLMAP export's
  on-device check. `fx`/`fy` are well established.
- Pure: no I/O, no allocation beyond the result.

## Examples

```ts
import { pinholeFromProjection } from 'gps-plus-slam-app-framework/utils/pinhole-from-projection';

const intr = pinholeFromProjection(view.projectionMatrix, 1280, 960);
// e.g. { fx: 1000, fy: 1100, cx: 640, cy: 480 } for a symmetric frustum
```

## Tests

- `pinhole-from-projection.test.ts` - a symmetric-frustum fixture, the
  continuous convention on an odd-sized frame (exactly `W/2`), and every
  error path.
- `pinhole-from-projection.property.test.ts` - round-trip recovery from a
  synthetic perspective matrix (500 runs over focal length, resolution and
  principal point).
