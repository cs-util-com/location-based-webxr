# occluder-sink.ts

## Purpose

The recorder's persistent occluder for live AR (`main.ts`) and replay
(`replay/replay-mode.ts`): the framework's `createOccluderSink`
(`gps-plus-slam-app-framework/visualization/occluder-sink`, lifted there from this file
2026-10-13, Tour Viewer polish round M5a, DEC-H3) fed from the recorder's validated
`occupancy` option group, with the recorder's own mesh worker. The policy, teardown and
invariants are the framework module's (its sidecar).

## Public API

- `createOccluderSink(parent, occupancy, deps?) → OccluderSinkHandle` — maps
  `occluderMeshMode`, `occluderDebugStyle`, `occluderRadiusM` and `minConfidence` to the
  framework's options. The caller decides WHETHER (the `occupancy.persistentOcclusion`
  flag).
- `OccluderSinkDeps` — optional `createMesh` / `createWorker` (tests only); the default
  worker is `createOccluderMeshWorker()` (`occluder-mesh-worker-client.ts`).
- `OccluderSink`, `OccluderSinkHandle` — re-exported from the framework.

## Invariants & assumptions

- The recorder's mesh modes are a subset of the framework's `MeshMode`; an injected
  `createMesh` receives the recorder's own mode.
- Everything else (flat snapshot, camera window, degrade-on-bad-pose, idempotent
  dispose, late responses never resurrect a disposed mesh) is the framework's.

## Examples

```ts
const handle = createOccluderSink(arWorldGroup, options.occupancy);
// … handle.sink.refresh(grid, pose) …
handle.dispose();
```

## Tests

- `occluder-sink.test.ts` — the policy through this adapter (the recorder's option
  names); the framework's own `occluder-sink.test.ts` pins it with plain options.
