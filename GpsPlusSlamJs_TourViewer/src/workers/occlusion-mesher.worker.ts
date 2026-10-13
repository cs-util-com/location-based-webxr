/**
 * Occlusion-mesh Web Worker shell (the Tour Viewer's copy, polish round M5: the mesh cursor).
 *
 * All logic lives in the framework: this just wires the framework's
 * `runMeshRequest` into the worker's message loop. Any consumer app copies these
 * ~10 lines. Vite bundles this module when referenced via
 * `new Worker(new URL('./occlusion-mesher.worker.ts', import.meta.url), { type: 'module' })`.
 */

import {
  runMeshRequest,
  type MeshWorkerRequest,
} from "gps-plus-slam-app-framework/ar/occlusion-mesh-worker";

// `self` in a module worker is the DedicatedWorkerGlobalScope; type just the
// surface we use so the file needs no WebWorker lib in the app tsconfig.
const ctx = self as unknown as {
  onmessage: ((event: { data: MeshWorkerRequest }) => void) | null;
  postMessage: (message: unknown, transfer: ArrayBufferLike[]) => void;
};

ctx.onmessage = (event): void => {
  const { response, transfer } = runMeshRequest(event.data);
  ctx.postMessage(response, transfer);
};
