# mesh-surface.ts

## Purpose

The surroundings as a mesh, for the creator's cursor (polish round M5, the owner's B3:
the ring should follow the surface, like the RecorderApp and the physics demo). Behind
`?mesh=1` until the owner likes it on the phone (Q-Mesh). Depth samples in the store fold
into an occupancy grid, a mesher (off-thread when the app's worker loads) turns it into the
framework's occluder mesh under the world group - kept as a HIDDEN pick target, it occludes
nothing - and `pick()` casts the screen centre against it: the point the reticle sits on
(`startHitTestReticle`'s `surfacePick`).

## Public API

- `MESH_DEPTH` - the depth this needs: the framework's reconstruction density
  (`DEFAULT_RECONSTRUCTION_DEPTH_*`, 24 x 24 at 5 Hz, as the RecorderApp and the physics
  demo use it); the troubleshooting recording's 16 x 16 at 1 Hz is too sparse for a mesh.
- `createMeshSurface({ parent, store, getCamera, createWorker?, createSink?, subscribe?,
now? }) → MeshSurface` - composes the framework's pieces:
  - `OccupancyGrid` at the framework's defaults (`DEFAULT_OCCUPANCY_CELL_SIZE_M`), with
    carving guarded at `DEFAULT_OCCUPANCY_MIN_OBSERVATIONS` like every other app's grid;
  - `createOccluderSink`: `smooth` mesh (vertices on the measured points), confidence
    floor `DEFAULT_OCCUPANCY_MIN_OBSERVATIONS`, a 6 m window around the camera,
    `occlude: false` (hidden);
  - `createOccluderMeshWorker(createWorker)`; without `createWorker` a throwing factory, so
    the driver meshes on the main thread;
  - `subscribeReplayOccupancy` on the store's `recording.latestDepthSample`, re-meshing at
    most once a second, a sample that fails to fold logged as a warning.
  - `pick()` - the surface point under the screen centre (world point and world normal),
    or null; also notes the frame gap (one pick per frame). One `Raycaster`, reused.
  - `stats()` - `{ frame: FrameTimesSummary | null, triangles }` (the framework's
    `createFrameTimes` over the last 120 gaps).
  - `dispose()` - stops the feed, frees the mesh and the worker (idempotent).
- `surfacePointFromHit(hit)` - a raycast hit as a world point and the face's world normal,
  or null.
- `meshSurfaceLine(stats)` - the readout line on the `?debug=1` panel while `?mesh=1` is
  on: "mesh: N triangles · frame p50/p95/max ms" (the whole frame's gaps, not the mesh's
  share; the owner compares with and without the flag).

## Invariants & assumptions

- **Why these settings** (M5 review, recorded in the polish-round plan):
  - smooth, not corner-fit: corner-fit keeps the cube's thickness, so its top sat half a
    cell (7.5 cm) above a floor; smooth lands within 3 cm (pinned by the real-composition
    test);
  - guarded carving: unguarded, one noisy ray carved real cells and left floating
    fragments for the ring to snap to;
  - 6 m and 1 Hz: the pick is a brute-force raycast every frame against the whole mesh;
    beyond 6 m the hit-test drives the ring anyway;
  - hidden: a depth-only mesh still writes depth and would hide the pins behind it.
- Without a worker (`createWorker` absent, or one that fails to load) the framework driver
  meshes on the main thread - slower, never broken.
- No mesh hit returns null, so the WebXR hit-test keeps driving the ring there. The pick
  reads last frame's mesh, so it can lag the hit-test by one re-mesh (filed, M5 review #8).
- The frame gaps are measured between picks, which the reticle asks once per XR frame.

## Examples

```ts
const surface = createMeshSurface({
  parent: worldGroup,
  store,
  getCamera,
  createWorker: () =>
    new Worker(
      new URL("./workers/occlusion-mesher.worker.ts", import.meta.url),
      {
        type: "module",
      },
    ),
});
startHitTestReticle({
  arWorldGroup: worldGroup,
  surfacePick: () => surface.pick(),
});
// … at the session end:
surface.dispose();
```

## Tests

- `mesh-surface.test.ts`:
  - a hit's world point and normal under a turned group, plus a property (any turn keeps
    the point and a unit normal); no hit, no face;
  - the pick against a floor mesh from a camera looking down; no mesh, no pick;
  - the frame-time readout; dispose once; `MESH_DEPTH`;
  - composed for real (grid, sink, synchronous mesher, subscriber): a floor fed twice
    through the store is picked within 3 cm of its height, facing up, and every mesh is
    hidden.
- `ar-entry.test.ts` / `playwright-tests/ar-mode.spec.js` - the wiring behind `?mesh=1`,
  including a throwing `startMeshSurface` that leaves the session running on the hit-test.
