# alignment-lerper.ts

## Purpose

Smoothly interpolates `arWorldGroup.matrix` toward a target alignment matrix each frame, eliminating visual jumps when the alignment solver produces a new alignment (~1 Hz). Mirrors the `camera-follower.ts` pattern.

## Public API

### `createAlignmentLerper(arWorldGroup, lerpRate?): AlignmentLerper`

| Param          | Type             | Default | Description                                        |
| -------------- | ---------------- | ------- | -------------------------------------------------- |
| `arWorldGroup` | `THREE.Object3D` | —       | The group whose `.matrix` is interpolated.         |
| `lerpRate`     | `number`         | `8`     | Lerp speed multiplier. Higher = faster convergence |

Returns an `AlignmentLerper` with:

| Method                        | Description                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setTarget(matrix, options?)` | Store a new 16-element column-major target matrix. Decomposed into position + quaternion + scale. `{ instant: true }` lands it exactly on the next `update`. |
| `update(dt)`                  | Advance interpolation by `dt` seconds. Lerps position, slerps quaternion, composes result, writes back.                                                      |
| `dispose()`                   | No-op (lerper does not own arWorldGroup).                                                                                                                    |

## Invariants & Assumptions

- **First target is applied instantly** (no lerp from identity) — prevents meaningless animation on session start.
- **An instant target is applied exactly on the next update**, even mid-ease; the targets after it ease again. The caller decides what is a correction (`ar-world-group-alignment.ts` marks one).
- **Subsequent targets lerp**: position via `Vector3.lerp`, rotation via `Quaternion.slerp`, scale via `Vector3.lerp`.
- **Alpha clamped**: `alpha = min(lerpRate × dt, 1.0)` — prevents overshoot on large dt.
- **`updateMatrixWorld(true)`** called after every update to propagate to children (cyan fused spheres, etc.).
- **No-op when no target set** — safe to call `update()` before any `setTarget()`.

## Examples

```typescript
import { createAlignmentLerper } from './alignment-lerper.js';

const lerper = createAlignmentLerper(arWorldGroup);

// Store subscriber calls this on alignment change:
lerper.setTarget(alignmentMatrix); // 16-element column-major array

// Per-frame render loop:
lerper.update(dt); // dt in seconds

// Cleanup:
lerper.dispose();
```

## Tests

- `alignment-lerper.test.ts` — 13 unit tests covering:
  - First-target instant apply
  - Instant targets (after a first target, mid-ease), then easing again
  - Position lerp and quaternion slerp convergence
  - No overshoot with large dt
  - Scale preservation
  - Combined translation + rotation
  - `updateMatrixWorld` propagation to children
  - Multiple rapid `setTarget` calls
  - No-op before first target
  - Custom lerpRate
  - Dispose safety
