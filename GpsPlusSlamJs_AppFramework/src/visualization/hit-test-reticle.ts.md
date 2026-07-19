# hit-test-reticle.ts

## Purpose

The shared hit-test reticle for the framework's example/starter apps — a
faithful port of the reticle from the stock three.js `webxr_ar_hittest` example.
It is the small, deterministic "reticle view-model": given the latest hit-test
pose (a column-major 4×4 transform) or `null`, it drives a Three.js mesh's
visibility + transform.

The per-frame XR plumbing (requesting the hit-test source, reading
`frame.getHitTestResults(...)`) lives in the framework's shared driver,
[ar/hit-test-reticle-driver](../ar/hit-test-reticle-driver.ts.md)
(`startHitTestReticle`, promoted 2026-07-18 from the app-local copies); the
logic here is unit-tested because it is what a porting developer is most likely
to get subtly wrong.

## Public API

- `type HitMatrix = Float32Array | number[]` — a column-major 16-element
  transform, as produced by `XRPose.transform.matrix`.
- `createReticleMesh(): Mesh` — builds a thin ring laid flat in the XZ plane.
  Returns a mesh with `matrixAutoUpdate = false` and `visible = false`.
- `updateReticle(reticle: Object3D, matrix: HitMatrix | null): void` — applies
  the pose:
  - non-null 16-element matrix → the reticle becomes visible and its **local**
    matrix is set to `WEBXR_TO_NUE · pose`. The hit pose arrives in the WebXR
    reference space (`X=East, Y=Up, Z=South`), but the reticle is parented under
    `arWorldGroup`, whose local space is NUE (`X=North, Y=Up, Z=East`). Applying
    the basis change makes the reticle's world pose
    `arWorldGroup.matrix · WEBXR_TO_NUE · pose` — the same chain the camera
    rides through the static `basisChangeNode` — so it stays pinned under the
    screen centre.
  - `null` → reticle is hidden.

Exported from `gps-plus-slam-app-framework/visualization`.

## Invariants & assumptions

- `matrixAutoUpdate` **must** stay `false` on the reticle: the world transform
  is written wholesale from the hit pose each frame, so letting Three.js
  recompose it from position/quaternion/scale would discard the pose. Because of
  this, `updateReticle` also sets `reticle.matrixWorldNeedsUpdate = true` after
  writing `reticle.matrix` — otherwise the render-time `updateMatrixWorld(force=false)`
  reuses a stale `matrixWorld` on frames where the parent `arWorldGroup` is
  unchanged (between ~1 Hz GPS-alignment updates), freezing the reticle at its
  previous surface.
- The mesh is parented under `getArWorldGroup()` (NUE local space) by the
  caller, **not** the GPS-aligned scene root — so the reticle rides the same
  lerped `arWorldGroup` alignment as the camera. Because the hit pose is in the
  **WebXR** reference space, `updateReticle` applies the `WEBXR_TO_NUE` basis
  change (`reticle.matrix = WEBXR_TO_NUE · pose`). Writing the WebXR pose into
  the NUE-frame local matrix directly (the previous behaviour) misread
  East/North as swapped: the Up axis matched but the reticle drifted sideways
  instead of tracking the screen centre.
- `updateReticle` operates on any `Object3D`, so it is testable without a WebGL
  context. It does not validate matrix length; callers pass the 16-element
  `XRPose.transform.matrix`.

## Examples

```ts
import {
  createReticleMesh,
  updateReticle,
} from 'gps-plus-slam-app-framework/visualization';

const reticle = createReticleMesh();
arWorldGroup.add(reticle);
// each XR frame:
updateReticle(reticle, hitPose ? hitPose.transform.matrix : null);
```

## Tests

[hit-test-reticle.test.ts](hit-test-reticle.test.ts) — pins: the mesh starts
hidden with manual matrix updates; a hit pose makes it visible and the
`WEBXR_TO_NUE` basis change is applied (`(x,y,z)_WebXR → (-z,y,x)_NUE`,
including a `Float32Array` pose); a `null` hit hides it (no stale reticle); and,
under an `arWorldGroup` parent, a pure-East WebXR hit (`+X`) lands on the NUE
East axis (`+Z`) not North (`+X`) — the screen-centre-drift / axis-swap
regression.

## Consumers

- `GpsPlusSlamJs_MinimalExample/src/main.ts` — tap-to-place reticle.
- `GpsPlusSlamJs_AnchorStarter/src/main.ts` — cache-miss placement reticle.
