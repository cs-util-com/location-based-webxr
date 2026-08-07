# `sync-gps-anchored-meshes.ts`

## Purpose

Pure-function reconciler that keeps a `THREE.Scene` in sync with a list of
GPS-anchored marker items, reusing the same `THREE.Mesh` instance across
calls for items whose id is unchanged. Replaces the framework's old
stateful `GpsAnchoredMeshManager` class (see P2 in
[2026-05-07-csharp-features-not-yet-ported.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md)).

## Public API

- `interface GpsAnchoredItem` — `{ id, lat, lon, altitude? }`.
- `interface SyncGpsAnchoredMeshesOptions` — `{ zeroRef, color, radius?, namePrefix }`.
- `syncGpsAnchoredMeshes(scene, prevHandles, items, options) → Map<id, THREE.Mesh>`
  - Mutates `scene` (adds new meshes, removes meshes for ids no longer in
    `items`). Does **not** mutate `prevHandles`.
  - Returns the new handle map. The caller is responsible for persisting
    that map between successive calls.
- `__resetSharedSphereResourcesForTests()` — test-only helper that
  disposes and clears the module-level resource cache.

## Invariants & assumptions

- **Scene is passed in explicitly.** No `getScene()` call (recorder follows
  the P3 "explicit injection" rule for new code).
- **Shared GPU resources** (`SphereGeometry`, `MeshBasicMaterial`) live in
  a module-level `Map<"{color}|{radius}", { geometry, material }>`,
  allocated lazily on first use and **never disposed**. A `(color, radius)`
  pair represents a marker style; the program is expected to have a small
  finite number of these.
- **Id-based diff:** present-in-both → update `position` in place;
  new id → create mesh + `scene.add`; gone id → `scene.remove` (mesh is
  discarded but its geometry/material are kept alive via the cache).
- **Duplicate ids within `items` are deduplicated.** `items` may come from
  external/loaded data with no uniqueness guarantee (e.g.
  `displayPriorRefPoints`). A repeated id reuses the single mesh for that
  id (last occurrence's coords win) rather than allocating an untracked
  second mesh — avoiding a permanent scene/GPU leak.
- Mesh `name` is `${namePrefix}-${item.id}` for parity with the historical
  `GpsAnchoredMeshManager` output (so any DOM- or scene-traversal-based
  test that asserted on names continues to work).
- The caller is responsible for ordering: meaningless invocations with a
  missing `zeroRef` are simply not made (no internal warning path).

## Examples

```ts
import {
  syncGpsAnchoredMeshes,
  type GpsAnchoredItem,
} from './sync-gps-anchored-meshes';

let priorHandles = new Map<string, THREE.Mesh>();
function showPrior(items: GpsAnchoredItem[]) {
  priorHandles = syncGpsAnchoredMeshes(scene, priorHandles, items, {
    zeroRef,
    color: 0x00ff00,
    namePrefix: 'prior-ref',
  });
}
```

## Tests

See [sync-gps-anchored-meshes.test.ts](sync-gps-anchored-meshes.test.ts).
Coverage: create, replace, update-in-place, remove-gone-ids, shared
resources reused across calls, distinct resources per (color, radius),
empty-input cleanup, idempotent update on unchanged coords, and
duplicate-id deduplication (no orphaned meshes).

## Related docs

- [`ref-point-visualizer.ts`](ref-point-visualizer.ts.md) — the only
  current caller; rewritten to hold one handle map per colour.
- [survey § P2](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-07-csharp-features-not-yet-ported.md) —
  the design rationale for moving from stateful "manager" classes to
  reconcilers.
- [boundary analysis Iter 4+](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-03-appframework-vs-recorderapp-boundary-analysis.md) —
  why this lives in the recorder, not the framework.
- [GpsAnchor port plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-13-gps-anchor-port-plan.md) —
  the single-object counterpart for cases where the user cares about
  visual stability (`'snap-when-offscreen'` UX) rather than bulk-mesh
  efficiency.
