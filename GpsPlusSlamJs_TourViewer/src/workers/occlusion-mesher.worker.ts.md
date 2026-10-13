# occlusion-mesher.worker.ts

## Purpose

The **entire app-side worker code** for the occluder mesh offload — a ~10-line shell that wires the framework's `runMeshRequest` into the Web Worker message loop. All logic lives in `gps-plus-slam-app-framework/ar/occlusion-mesh-worker`; any consumer app copies this file verbatim.

## How it works

- Vite bundles this module when referenced as `new Worker(new URL('./occlusion-mesher.worker.ts', import.meta.url), { type: 'module' })` (see `../seams.ts`, `startMeshSurface`).
- On each message it runs `runMeshRequest(event.data)` and posts the geometry back with its transfer list (zero-copy).
- `self` is typed as a minimal `{ onmessage, postMessage }` shape so the file needs no WebWorker lib in the app tsconfig.

## Invariants & assumptions

- Pure pass-through: no state, no DOM, no THREE — only `meshOccupiedCells` (via `runMeshRequest`) runs here.
- Must be a **dist entry** in the framework (`occlusion-mesh-worker.ts`) for the deep import to resolve at runtime — see `config/tsdown.config.ts`.

## Tests

- Exercised indirectly via `../visualization/occluder-mesh-worker-client.test.ts` (a fake worker stands in) and the framework's `occlusion-mesh-worker.test.ts` (the `runMeshRequest` it calls). The real worker runs only on-device / in a browser.
