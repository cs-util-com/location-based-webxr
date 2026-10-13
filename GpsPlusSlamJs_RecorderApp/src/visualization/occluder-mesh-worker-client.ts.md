# occluder-mesh-worker-client.ts

## Purpose

The recorder's occluder mesh worker: the framework's `createOccluderMeshWorker`
(`gps-plus-slam-app-framework/visualization/occluder-mesh-worker-client`, lifted there from
this file 2026-10-13, Tour Viewer polish round M5a, DEC-H3) over the recorder's own worker
file, `../workers/occlusion-mesher.worker.ts`. The worker is created here because its
`new URL(...)` resolves against this app's source.

## Public API

- `createOccluderMeshWorker(createWorker?) → { driver, dispose }` — the default factory is
  the recorder's module worker; tests inject a fake.

## Invariants & assumptions

- The synchronous fallback, error forwarding and termination are the framework's (its
  sidecar). See `2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`.

## Tests

- `occluder-mesh-worker-client.test.ts` — through this adapter; the framework's own test
  file pins the same behaviour.
