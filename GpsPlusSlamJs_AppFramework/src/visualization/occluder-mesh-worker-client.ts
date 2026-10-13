/**
 * Occluder mesh worker client — builds the {@link OccluderMeshDriver} backed by
 * an app's mesh worker (a ~10-line shell over `runMeshRequest`). Lifted from
 * the RecorderApp 2026-10-13 (Tour Viewer polish round M5a, DEC-H3).
 *
 * The app passes the factory that creates its `Worker` (its URL resolves
 * against the app's source); this adapts it to the driver's
 * {@link MeshWorkerPoster} seam, and
 * degrades to the driver's **synchronous fallback** if a worker can't be
 * constructed (unsupported env / test). See
 * `2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`.
 */

import type { MeshWorkerResponse } from '../ar/occlusion-mesh-worker';
import { createLogger } from '../utils/logger';
import {
  OccluderMeshDriver,
  type MeshWorkerPoster,
} from './occluder-mesh-driver';

const log = createLogger('OccluderMeshWorker');

/**
 * Create an {@link OccluderMeshDriver} that meshes off the main thread. Returns
 * the driver plus a `dispose` that also terminates the worker. If the worker
 * can't be created (no support, or `createWorker` throws), the driver falls back
 * to synchronous main-thread meshing — the occluder still works, just on-thread.
 *
 * @param createWorker the app's worker (e.g. `new Worker(new URL(
 *   './occlusion-mesher.worker.ts', import.meta.url), { type: 'module' })`).
 */
export function createOccluderMeshWorker(createWorker: () => Worker): {
  driver: OccluderMeshDriver;
  dispose: () => void;
} {
  const { worker, poster } = tryCreateWorker(createWorker);
  const driver = new OccluderMeshDriver(poster, {
    // A worker error means the in-flight job never replies; the driver clears
    // the wedge and retries the next snapshot, so the occluder stays a beat
    // staler at worst instead of freezing.
    onError: (err) => log.warn('Occluder mesh worker job failed', err),
    // The worker errored before ever meshing (a module load failure): the driver
    // has switched to synchronous meshing — terminate the dead worker.
    onWorkerUnusable: () => {
      log.warn('Occluder mesh worker unusable; meshing synchronously');
      worker?.terminate();
    },
    // Freshness instrumentation for the Phase-2 gate (see the plan's §"Next
    // step"): one debug line per completed mesh so the on-device walk can read
    // the occluder's refresh latency + grid size off the log panel instead of
    // estimating by feel. The settled-skip suppresses refreshes on an unchanged
    // grid, so this only logs while new surface is actually being meshed.
    onMeshStats: (s) =>
      log.debug(
        `Meshed ${s.cellCount} cells (${s.mode}) in ${Math.round(s.durationMs)} ms${
          s.synchronous ? ' [sync]' : ''
        }`
      ),
  });
  return {
    driver,
    dispose: () => {
      driver.dispose();
      worker?.terminate();
    },
  };
}

/** Create the worker + its poster adapter, or `{null, null}` on any failure. */
function tryCreateWorker(createWorker: () => Worker): {
  worker: Worker | null;
  poster: MeshWorkerPoster | null;
} {
  try {
    const worker = createWorker();
    const poster: MeshWorkerPoster = {
      postMessage: (message, transfer) =>
        worker.postMessage(message, transfer as Transferable[]),
      onmessage: null,
      onerror: null,
    };
    worker.onmessage = (event: MessageEvent): void => {
      poster.onmessage?.({ data: event.data as MeshWorkerResponse });
    };
    // Forward worker errors to the driver so it can recover the in-flight job
    // (clear the wedge, retry the latest snapshot, or fall back to synchronous
    // meshing on a load failure) instead of freezing. Logging happens in the
    // driver's onError.
    worker.onerror = (event: ErrorEvent): void => {
      poster.onerror?.(event.message ?? event);
    };
    worker.onmessageerror = (event): void => {
      poster.onerror?.(event);
    };
    return { worker, poster };
  } catch (err) {
    log.warn('Occluder mesh worker unavailable; meshing synchronously', err);
    return { worker: null, poster: null };
  }
}
