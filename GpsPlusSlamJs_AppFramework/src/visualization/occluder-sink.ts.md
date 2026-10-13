# occluder-sink.ts

## Purpose

The ONE persistent-occluder wiring: the RecorderApp's live AR and replay, and the Tour
Viewer's mesh cursor. Lifted here from the RecorderApp 2026-10-13 (Tour Viewer polish round
M5a, DEC-H3), with plain options in place of the recorder's option group and the worker
supplied by the app. Extracted in the RecorderApp 2026-07-04 (code-health plan step 5) from two
structurally identical ~40-line blocks that had to be edited in lockstep — the review log
repeatedly flagged "keep both sites parallel", which was the tell that they should be one
site. Owns the resource trio (depth-only `OcclusionMesh`, off-thread mesh worker, the
grid-facing sink) **and their teardown**: one `dispose()` replaces the old "null two module
variables in every teardown path" pattern that produced several leak-class review findings.

## Public API

- `createOccluderSink(parent, options, deps) → OccluderSinkHandle` — build the trio for one
  session. The caller decides WHETHER; this factory owns HOW, from `OccluderSinkOptions`:
  `meshMode`, `debugStyle`, `radiusM` (0: unbounded), `minConfidence`, and `occlude`
  (default true; false keeps the mesh as a hidden pick target - the raycaster still hits it).
- `OccluderSinkDeps` — `createWorker` (required: the app's
  `createOccluderMeshWorker(() => new Worker(new URL(...)))`, because the worker file's URL
  resolves against the app's source) and an optional `createMesh` (tests).
- `OccluderMeshWorker` — `{ driver, dispose() }`, what `createWorker` returns.
- `OccluderSinkHandle` — `{ sink, mesh(), dispose() }`. `mesh()` is the depth-only
  mesh, for a raycast (the Tour Viewer's mesh cursor; `colorWrite: false` does not stop the
  raycaster). `dispose()` releases worker + mesh and turns
  the sink callbacks into no-ops; **idempotent**, safe from any teardown path.
- `OccluderSink` — `{ refresh(grid, pose?), clear() }`, the shape
  `wireOccupancyGridSubscribers`' `occluder` option drives.

## Invariants & assumptions

- **Meshing policy (unchanged from the two originals):** flat `Int32Array` snapshot into the
  transferable pack path (Step 1.3, 2026-07-03 fps plan); camera-local window when
  `radiusM > 0` and the pose is finite, unbounded fallback otherwise (a
  tracking-glitch pose degrades gracefully, never blanks the occluder); `getCellPoint` read
  only by the surface-hugging modes; same `minConfidence` floor as cubes/COLMAP.
- **Teardown safety by flag, not module variables:** the sink callbacks run asynchronously
  (throttled refreshes, worker responses) and no-op once disposed — including a **late
  worker response**, which must not resurrect the disposed mesh (pinned by test).
- The factory never checks `persistentOcclusion` — callers gate construction on it.

## Examples

```ts
// The app supplies its worker: the worker file's URL resolves against the app's source.
const createWorker = () =>
  createOccluderMeshWorker(
    () =>
      new Worker(
        new URL('../workers/occlusion-mesher.worker.ts', import.meta.url),
        {
          type: 'module',
        }
      )
  );
let handle: OccluderSinkHandle | null = null;
if (persistentOcclusion) {
  handle = createOccluderSink(
    arWorldGroup,
    {
      meshMode: 'corner-fit',
      debugStyle: 'off',
      radiusM: 12,
      minConfidence: 2,
    },
    { createWorker }
  );
}
wireOccupancyGridSubscribers({ /* ... */ occluder: handle?.sink });
// teardown (any path):
handle?.dispose();
handle = null;
```

The Tour Viewer's mesh cursor passes `occlude: false` and casts against `handle.mesh()`.

## Tests

- `occluder-sink.test.ts` - construction knobs (mode/debug style/parent, `occlude: false`
  hides the mesh), unbounded vs windowed snapshot selection, non-finite-pose degradation,
  geometry application + clear, and the dispose contract (idempotent; post-dispose
  refresh/clear/late-response no-ops).
- The RecorderApp's live/replay integration stays covered by its
  `main.occupancy-cubes-wiring.test.ts`, which mocks only the app's worker client
  (`./visualization/occluder-mesh-worker-client`); the framework mesh and this factory run
  for real there since the lift.
- The Tour Viewer's `mesh-surface.test.ts` composes it for real (grid, sink, synchronous
  mesher, subscriber) and picks a fed floor.

## Related

- [occluder-mesh-worker-client.ts.md](occluder-mesh-worker-client.ts.md) - the worker the
  sink drives; [occlusion-mesh.ts.md](occlusion-mesh.ts.md) - the mesh it owns; the
  RecorderApp's
  [wire-occupancy-grid-subscribers.ts.md](../../../GpsPlusSlamJs_RecorderApp/src/visualization/wire-occupancy-grid-subscribers.ts.md)
  - the throttled driver of `refresh`.
