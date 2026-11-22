# `frustum-visibility.ts`

## Purpose

Camera-frustum visibility predicates used by GPS-anchored components (Item 1
of [2026-05-07-csharp-features-not-yet-ported.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md))
and any other caller that needs to know whether a world-space point, sphere,
or `Object3D` is currently visible to a camera. `GpsAnchor`'s `'snap-when-offscreen'` mode used `isObjectInCameraFrustum`
until it joined the anchor set (`../ar/deferred-anchors.ts`), whose view
gate is `isAnchorInView` (`../ar/anchor-visibility.ts`); the predicates here
stay public for apps.

## Public API

- `buildCameraFrustum(camera, out?) → Frustum` — refreshes a Three.js
  `Frustum` from `camera.projectionMatrix × camera.matrixWorldInverse`.
  When `out` is provided, the frustum is written into it; otherwise the
  module-level scratch frustum is reused.
- `isPointInCameraFrustum(camera, point, frustum?) → boolean` — strict
  inside-all-planes check; uses `Frustum.containsPoint`.
- `isSphereInCameraFrustum(camera, sphere, frustum?) → boolean` —
  partial-overlap check; uses `Frustum.intersectsSphere`.
- `isObjectInCameraFrustum(camera, object, frustum?) → boolean` —
  partial-overlap check that resolves the object's world bounding volume
  in tiers (cheapest first) so each common Three.js type is gated by where
  it actually draws:
  1. **Sprite** (`isSprite`) — billboard with no representative world
     geometry; its world-space origin is tested as a point
     (`Frustum.containsPoint`).
  2. **Object-level `boundingSphere`** (`InstancedMesh`, `SkinnedMesh`,
     or any object that pre-populates one) — covers the instance spread
     / posed extent that the base geometry sphere does not; computed
     lazily via `computeBoundingSphere()` when missing.
  3. **Geometry bounding sphere** (`Mesh`, `Points`, `Line`, …) —
     geometry's local sphere × `matrixWorld`; the `geometry` property is
     read structurally rather than via a `Mesh` cast.
  4. **Container with children** (`Group`, `LOD`, …) — world-space union
     of descendant bounding boxes (`Box3.setFromObject`) converted to a
     sphere, so an off-screen container is correctly culled.
  5. **Truly empty / geometry-less object** — no bounding volume; treated
     as visible (`true`), the conservative default for visibility gating.
     It deliberately does NOT call `Frustum.intersectsObject`, which
     unconditionally dereferences `object.geometry.boundingSphere` and
     therefore throws a `TypeError` for geometry-less objects.

## Invariants & assumptions

- Three.js convention: `containsPoint` is strict, `intersectsSphere` /
  `intersectsObject` accept partial overlap. We follow that.
- Caller MUST have run `camera.updateMatrixWorld()` (and the equivalent on
  the object) before calling — normally already the case via
  `renderer.render`.
- The module-level scratch `Frustum`/`Matrix4` are not thread-safe (none
  of Three.js is). Callers doing many checks per frame should call
  `buildCameraFrustum` once and pass the returned `Frustum` to subsequent
  predicates via the optional `frustum` parameter.
- No allocations on the hot path: bounding-sphere computation lazily
  caches into `geometry.boundingSphere` on first use; the per-call
  world-space sphere is a single reused scratch.

## Examples

```ts
import {
  buildCameraFrustum,
  isObjectInCameraFrustum,
} from 'gps-plus-slam-app-framework/visualization';

// Cheapest pattern when checking many objects in one frame:
const frustum = buildCameraFrustum(camera);
for (const anchor of anchors) {
  if (!isObjectInCameraFrustum(camera, anchor.object3D, frustum)) {
    anchor.commitPendingPose();
  }
}
```

## Tests

- [frustum-visibility.test.ts](frustum-visibility.test.ts) — covers all
  three predicates, the inside/outside boundary, the
  injected-frustum-is-reused path (mutates camera, asserts stale frustum
  is honoured), the parent-transform case for `isObjectInCameraFrustum`,
  and the geometry-less `Group` case (asserts it does not throw and is
  treated as in-frustum). The tiered object resolution is pinned by:
  - non-`Mesh` renderables (`Points`, `Line`) via the geometry sphere;
  - Tier A containers — a `Group`/`LOD` whose only child is off-screen
    culls (proving the children-union box drives it, not the old
    "geometry-less ⇒ always true" default), an on-screen child is
    visible, multi-child union, and a truly empty nested container still
    defaults to visible;
  - Tier B object-level sphere — an `InstancedMesh` whose instance is
    off-screen culls even though its base geometry sphere would intersect
    (proving the instance-aware sphere wins), the on-screen instance is
    visible, and a pre-set `boundingSphere` (simulating a posed
    `SkinnedMesh`) is honoured;
  - Tier C sprites — in-front visible, behind/outside culled via the
    world-origin point test.
