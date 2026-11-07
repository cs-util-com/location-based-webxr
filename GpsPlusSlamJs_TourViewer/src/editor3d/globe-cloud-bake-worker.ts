/**
 * The globe editor's cloud bake worker: the Globe package's core
 * (`gps-plus-slam-globe/cloud-bake-worker`) with the worker's `postMessage`.
 * All logic lives in the core.
 *
 * Vite bundles this module when it is referenced as
 * `new Worker(new URL("./globe-cloud-bake-worker.ts", import.meta.url), { type: "module" })`
 * (`editor3d-globe.ts`).
 *
 * @see globe-cloud-bake-worker.ts.md
 */
import { createCloudBakeWorkerCore } from "gps-plus-slam-globe/cloud-bake-worker";

// `self` in a module worker is the DedicatedWorkerGlobalScope; type just the
// surface used so the file needs no WebWorker lib in the app tsconfig.
const ctx = self as unknown as {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer: ArrayBufferLike[]) => void;
};

const core = createCloudBakeWorkerCore((message, transfer) => {
  ctx.postMessage(message, [...transfer]);
});

ctx.onmessage = (event): void => {
  core.handle(event.data);
};
