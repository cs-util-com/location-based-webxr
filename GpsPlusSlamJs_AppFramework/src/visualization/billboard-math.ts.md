# billboard-math.ts

## Purpose

Pure cylindrical-billboard math: the single Y-axis rotation that turns a
plane toward the camera horizontally while never pitching or rolling. Unlike
`THREE.Sprite` (which fully faces the camera, tilting and rolling with it),
this gives an upright AR marker that only ever yaws.

## Public API

- **`HorizontalPoint`** — `{ x, z }`, a horizontal position; height (`y`) is
  irrelevant to yaw and intentionally excluded from the type.
- **`computeBillboardYaw(billboard: HorizontalPoint, camera: HorizontalPoint, fallback = 0): number`**
  — the Y rotation (radians) that turns a `+Z`-facing plane at `billboard` to
  face `camera` in the XZ plane. Returns `fallback` when the camera is
  directly above/below the billboard (no horizontal direction exists), so the
  marker holds its last orientation instead of snapping.

## Invariants & assumptions

- Convention: the plane's local **+Z** axis is its front (image) face —
  `PlaneGeometry`'s front face has normal +Z, so yawing +Z toward the camera
  shows the texture to the user.
- Pure. No dependencies. The caller applies the result as
  `mesh.rotation.set(0, yaw, 0)`, which is what guarantees pitch/roll stay
  exactly 0 (they are never written).

## Examples

```ts
import { computeBillboardYaw } from 'gps-plus-slam-app-framework/visualization';

const yaw = computeBillboardYaw(
  { x: 0, z: 0 }, // billboard position
  { x: 2, z: 2 } // camera position
);
group.rotation.set(0, yaw, 0);
```

## Tests

- `billboard-math.test.ts` — yaw toward cardinal/diagonal camera positions,
  and the directly-overhead/underneath case returning `fallback`.
