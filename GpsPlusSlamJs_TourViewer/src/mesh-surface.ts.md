# mesh-surface.ts

## Purpose

The surroundings as a mesh, for the creator's cursor (polish round M5, the owner's B3:
the ring should follow the surface, like the RecorderApp and the physics demo). A
creator's default since the owner's phone test of 2026-10-15 (Q-Mesh; `?mesh=0` turns it
off - mesh-cursor smoothing plan 2026-10-15-0944 in `GpsPlusSlamJs_Docs/docs/`). Depth samples in the store fold
into an occupancy grid, a mesher (off-thread when the app's worker loads) turns it into the
framework's occluder mesh under the world group - kept as a HIDDEN pick target, it occludes
nothing - and `pick()` casts the screen centre against it: the point the reticle sits on
(`startHitTestReticle`'s `surfacePick`), lying flat to the mesh around the hit
(`mesh-neighbourhood-normal.ts`) and easing toward each frame's point
(`surface-smoothing.ts`) - the owner's "a little bit more lerping ... average it a little
bit stronger on the rotation part".

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
  - `pick()` - the ring's point under the screen centre, or null (no mesh there): the
    raycast hit's world point with the neighbourhood's world normal
    (`neighbourhoodNormal` at its defaults, 0.3 m and 45 degrees; the face normal when
    it gives none), through the smoother (`createSurfaceSmoother` at its defaults,
    0.1 s / 0.2 s, snap at 0.3 x the hit's distance). The smoothing runs in the
    PARENT's own frame (`parent.matrixWorld`, as the raycast reads it), and the point
    comes back in world (r867 review #2). Its time step is the time since the last
    smoothed pick. A pick with no point (no camera, no mesh hit, bad input) resets the
    smoother (r867 review #4), so the mesh re-enters on its raw point after a hole -
    one frame or many - and its very first point lands exactly on the surface. Also
    notes the frame gap (one pick per frame). One `Raycaster` and one `Matrix4`, reused.
  - `stats()` - `{ frame: FrameTimesSummary | null, triangles }` (the sink handle's
    `triangleCount()`, and the framework's
    `createFrameTimes` over the last 120 gaps).
  - `reset()` - clears the grid, the mesh and the smoother (follow-up F11): after a
    WebXR origin reset their cells sit in a frame that no longer exists.
    The next samples build it anew; a worker response requested before
    the reset is dropped by the sink (the framework's `clear()`, PR #609
    review), so the old frame's mesh never comes back.
  - `dispose()` - stops the feed, frees the mesh and the worker (idempotent).
- `surfacePointFromHit(hit)` - a raycast hit as a world point and the face's world normal,
  or null.
- `meshSurfaceLine(stats)` - the readout line on the `?debug=1` panel while the mesh
  runs (the default): "mesh: N triangles · frame p50/p95/max ms" (the whole frame's gaps,
  not the mesh's share). With `?mesh=0` there is no mesh and so no line: a baseline frame
  line without the mesh is still open (follow-up F13).

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
- No mesh hit returns null, so the WebXR hit-test keeps driving the ring there (unsmoothed:
  the framework driver's own path; smoothing it too is filed as F25). The smoother is
  reset then: resuming from the mesh's last point after the driver drew the raw
  hit-test pose would jump the ring back for a frame and glide forward again. The pick
  reads last frame's mesh, so it can lag the
  hit-test by one re-mesh (filed, M5 review #8 / F10); the smoothing's time constant
  (0.1 s) is a deliberate lag of its own, several frames long.
- **Smoothed in the world group's frame, not in world** (r867 review #2): the mesh, the
  camera and the reticle all hang under `parent`, which the alignment lerper eases every
  frame. In world, each alignment step was a lag: the ring slid over a still surface
  (about 35 cm at 50 m from the pivot of a small turn). In the parent's frame a still
  surface under a still phone is a still target. Assumes `parent.matrixWorld` is rigid
  (the alignment is); a singular one turns the normal to zero, which the smoother takes as
  no sample (the hit-test then drives the ring).
- A placed pin goes where the ring is (the driver reads the reticle), so it lands on the
  smoothed point the creator sees.
- Per pick: the raycast plus one more pass over the triangles for the normal. Measured
  2026-10-15 on a desktop (i7-1185G7, Node 26, one-off, not a test), on noisy floors of
  0.15 m cells: the pass costs 0.09 / 0.19 - 0.23 / 0.36 - 0.44 / 0.70 - 0.84 ms at
  5k / 10k / 20k / 40k triangles, about 40 % of the raycast's 0.22 / 0.56 - 0.60 /
  0.83 - 1.14 / 1.75 - 2.25 ms. Below the 0.5 ms-at-10k bar the r867 review set, so no
  reduction (caching, every other frame) was built. The PHONE's cost is still unmeasured
  (F13's baseline without the mesh is still missing).
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
    hidden; after `reset()` nothing is picked, and a lower floor fed
    after it is picked at its own height (mutation-checked: without the
    grid's clear the old floor is hit); a floor meshed from noisy depth is picked at
    least 2.5 times flatter than the triangle hit at every depth spacing 5 / 10 / 15 cm
    and noise 2 / 5 cm (pinned; measured 3.0 - 3.8 times, the faces tilting only
    0.5 - 2.5 degrees);
  - the smoothing (mesh-cursor smoothing plan): eases toward a moved point and settles,
    jumps onto a table 1 m higher, lies flat over a bumped triangle, re-enters on its raw
    point after a one-frame hole and after a long one, then smooths again (seen red
    before the reset on a null pick), rides a moved and turned parent with no lag (seen
    red with world-frame smoothing: 16 cm behind), starts afresh after `reset()`
    (mutation-checked: without the smoother's reset the ring glides).
- `surface-smoothing*.test.ts`, `mesh-neighbourhood-normal.test.ts` - the two pieces on
  their own, with their sweeps.
- `ar-entry.test.ts` / `playwright-tests/ar-mode.spec.js` - the wiring (the default, and
  none with `?mesh=0`),
  including a throwing `startMeshSurface` that leaves the session running on the hit-test.
