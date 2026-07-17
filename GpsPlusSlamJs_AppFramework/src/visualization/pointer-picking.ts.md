# pointer-picking.ts

## Purpose

An engine-free desktop raycast helper (2026-07-15 replay-as-dev-harness Part B).
The shipped tap-to-place uses the WebXR hit-test API, which does not exist on
desktop; this module lets a desktop-replay (or any non-WebXR) consumer turn a
pointer position into a world-space hit against real geometry — typically the
reconstructed occlusion mesh (`OcclusionMesh.getMesh()`) — using a plain
`THREE.Raycaster`. No physics engine required. A physics consumer may
additionally cast through its own collider for guaranteed collider-consistency;
that path stays in the consumer, never here.

## Public API

- **`pointerToNdc(clientX, clientY, rect): Ndc`** — convert a pointer client
  position to normalized device coordinates in [-1, 1], +Y up (the inverse of
  screen Y). `rect` is the subset of `DOMRect` needed (`left/top/width/height`,
  e.g. `canvas.getBoundingClientRect()`). A degenerate zero-size rect maps to the
  centre `(0, 0)` rather than dividing by zero (never returns `NaN`).
- **`raycastPointer(camera, ndc, objects, raycaster?): THREE.Intersection | null`**
  — the nearest ray/geometry intersection from `camera` through `ndc`, recursing
  into children, or `null` on a miss. Pass a reused `raycaster` in a hot loop to
  avoid per-call allocation.
- **`pickWorldPoint(camera, ndc, objects, raycaster?): THREE.Vector3 | null`** —
  convenience returning just the world-space hit point (`intersection.point`).

## Invariants & assumptions

- **Caller owns world matrices.** The camera's and objects' `matrixWorld` must be
  current (they are after a render; call `updateMatrixWorld()` otherwise).
- **Depth-only geometry is raycastable.** The occlusion mesh's `colorWrite:false`
  invisibility does not affect `THREE.Raycaster` (a test pins this), and its
  `frustumCulled:false` is fine for raycasting.
- **Pure/engine-free.** Only depends on `three`. No physics, no WebXR, no global
  state.

## Examples

```ts
import {
  pointerToNdc,
  pickWorldPoint,
} from 'gps-plus-slam-app-framework/visualization';

canvas.addEventListener('pointerdown', (e) => {
  const ndc = pointerToNdc(
    e.clientX,
    e.clientY,
    canvas.getBoundingClientRect()
  );
  const hit = pickWorldPoint(camera, ndc, [occlusionMesh.getMesh()]);
  if (hit) spawnAt(hit); // click a real surface → world point
});
```

## Tests

- `pointer-picking.test.ts` — NDC mapping (centre → (0,0), corners with Y flip,
  non-zero rect offset, zero-size rect → finite centre); a centre ray hits a box
  front face at the expected WORLD point from a non-origin camera (a dropped world
  transform would move the hit); `pickWorldPoint` agrees; a corner ray misses →
  `null`; and a hit still lands against a `colorWrite:false` (depth-only) mesh.
