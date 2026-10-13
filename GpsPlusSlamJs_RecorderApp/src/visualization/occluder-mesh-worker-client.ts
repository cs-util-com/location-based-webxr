/**
 * The recorder's occluder mesh worker: the framework's
 * `createOccluderMeshWorker` (lifted there from this file 2026-10-13, Tour
 * Viewer polish round M5a, DEC-H3) over the recorder's own worker file - its
 * `new URL(...)` resolves against this app's source, which is why the worker
 * is created here and not in the framework. See
 * `2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`.
 */

import { createOccluderMeshWorker as createFrameworkMeshWorker } from 'gps-plus-slam-app-framework/visualization/occluder-mesh-worker-client';
import type { OccluderMeshDriver } from 'gps-plus-slam-app-framework/visualization/occluder-mesh-driver';

/** Default factory — the real module worker (Vite bundles it from the URL). */
function defaultCreateWorker(): Worker {
  return new Worker(
    new URL('../workers/occlusion-mesher.worker.ts', import.meta.url),
    { type: 'module' }
  );
}

/**
 * Create an {@link OccluderMeshDriver} that meshes off the main thread, with
 * the synchronous fallback when the worker cannot be created.
 *
 * @param createWorker injectable for tests; defaults to the real module worker.
 */
export function createOccluderMeshWorker(
  createWorker: () => Worker = defaultCreateWorker
): { driver: OccluderMeshDriver; dispose: () => void } {
  return createFrameworkMeshWorker(createWorker);
}
