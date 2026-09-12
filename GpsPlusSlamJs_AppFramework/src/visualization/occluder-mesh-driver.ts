/**
 * Occluder mesh driver — main-thread orchestration for the Web Worker offload.
 *
 * Drives {@link packMeshRequest} / {@link runMeshRequest} (see
 * `2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`): the occluder wiring
 * calls {@link OccluderMeshDriver.request} on each refresh with the occupied-cell
 * snapshot; the driver packs it, posts it to a worker, and invokes a callback
 * with the meshed geometry when it returns — so the expensive mesh runs
 * off-thread and never stalls the render.
 *
 * Policy (locked 2026-07-01):
 * - **Coalesce to latest** — at most one job in flight; a request made while busy
 *   is remembered (newest wins) and posted when the current one returns, so work
 *   never queues up behind a growing grid.
 * - **Synchronous fallback** — constructed with `poster = null` (no worker
 *   support), it meshes inline and calls back immediately (today's behaviour).
 * - **Error recovery (2026-07-01 Phase 1 gap fix)** — a worker that never replies
 *   (an uncaught throw in `runMeshRequest`, or a module that fails to load) must
 *   not wedge the in-flight slot forever. On a worker error the driver clears the
 *   slot and re-posts the pending snapshot (or lets the next refresh post) so the
 *   occluder never silently freezes. If the worker errors **before ever producing
 *   a mesh** — almost always a load failure — the driver declares it unusable
 *   ({@link OccluderMeshDriverOptions.onWorkerUnusable}) and switches to
 *   synchronous main-thread meshing, since further posts would vanish into a dead
 *   worker.
 *
 * Framework-owned + THREE-free: a consumer supplies a {@link MeshWorkerPoster}
 * adapting a real `Worker`, and applies the result (e.g. `OcclusionMesh.applyMeshData`).
 */

import {
  packMeshRequest,
  runMeshRequest,
  type MeshWorkerRequest,
  type MeshWorkerResponse,
} from '../ar/occlusion-mesh-worker.js';
import type { MeshMode } from '../ar/occupancy-mesher.js';
import type { GridCell } from '../ar/bresenham3d.js';
import type { Vector3 } from 'gps-plus-slam-js';

/** Called with the meshed geometry (typed arrays) when a job completes. */
export type OnMesh = (positions: Float32Array, indices: Uint32Array) => void;

/**
 * Timing/size stats for one completed mesh job — the freshness instrumentation
 * for the Phase-2 gate (see the plan's §"Next step"): `durationMs` is the
 * wall-clock time from posting the job (including packing already done by then)
 * to receiving its geometry, i.e. the occluder's current refresh latency.
 * Failed jobs report nothing (they surface via
 * {@link OccluderMeshDriverOptions.onError}).
 */
export interface OccluderMeshStats {
  /** Wall-clock ms from post to delivered geometry (inline time on the sync path). */
  readonly durationMs: number;
  /** Number of occupied cells the mesh was built from. */
  readonly cellCount: number;
  readonly mode: MeshMode;
  /** True when meshed inline on the main thread (fallback), false when off-thread. */
  readonly synchronous: boolean;
}

/**
 * The minimal `Worker`-like surface the driver needs. A consumer adapts a real
 * `Worker`: forwards `worker.onmessage` → `poster.onmessage` and
 * `worker.onerror` / `worker.onmessageerror` → `poster.onerror` (so the driver
 * can recover from a worker that never replies).
 */
export interface MeshWorkerPoster {
  postMessage(message: MeshWorkerRequest, transfer: ArrayBufferLike[]): void;
  onmessage: ((event: { data: MeshWorkerResponse }) => void) | null;
  /** Fired when the worker errors (uncaught throw or module load failure). */
  onerror: ((error?: unknown) => void) | null;
}

/** Optional driver callbacks (logging + worker-teardown seams). */
export interface OccluderMeshDriverOptions {
  /**
   * Called once when the driver gives up on the worker and switches to
   * synchronous meshing (the worker errored before ever producing a mesh —
   * almost always a module that failed to load). The consumer should terminate
   * the now-dead worker.
   */
  onWorkerUnusable?: () => void;
  /**
   * Called with any error that aborts a job — a worker error event, or a throw
   * from synchronous meshing — so the consumer can log it. Optional; if absent
   * the error is swallowed (the frame is dropped, the driver stays healthy).
   */
  onError?: (error: unknown) => void;
  /**
   * Called with {@link OccluderMeshStats} each time a job completes (fires just
   * before the job's geometry callback). Optional logging seam so the consumer
   * can surface mesh duration + input size per refresh.
   */
  onMeshStats?: (stats: OccluderMeshStats) => void;
  /**
   * Injectable monotonic clock in ms for {@link OccluderMeshStats.durationMs}
   * (tests); defaults to `performance.now()`.
   */
  now?: () => number;
}

interface Job {
  /** Tuple snapshot, or the flat Int32Array from `getOccupiedCellsFlat` (Step 1.3). */
  readonly cells: readonly GridCell[] | Int32Array;
  readonly cellSizeM: number;
  readonly mode: MeshMode;
  readonly getCellPoint?: ((cell: GridCell) => Vector3 | null) | undefined;
  readonly onMesh: OnMesh;
}

/** Cell count of a snapshot in either representation. */
function cellCountOf(cells: readonly GridCell[] | Int32Array): number {
  return cells instanceof Int32Array ? cells.length / 3 : cells.length;
}

export class OccluderMeshDriver {
  private readonly poster: MeshWorkerPoster | null;
  private readonly onWorkerUnusable?: (() => void) | undefined;
  private readonly onError?: ((error: unknown) => void) | undefined;
  private readonly onMeshStats?:
    ((stats: OccluderMeshStats) => void) | undefined;
  private readonly now: () => number;
  private nextId = 1;
  private inFlightId: number | null = null;
  private inFlightCallback: OnMesh | null = null;
  /** Timing/size context of the in-flight job; cleared on completion/failure. */
  private inFlightStats:
    | (Omit<OccluderMeshStats, 'durationMs'> & {
        readonly startedMs: number;
      })
    | null = null;
  private pending: Job | null = null;
  private disposed = false;
  /** True ⇒ mesh inline (no worker, or the worker was declared unusable). */
  private syncMode: boolean;
  /** Set once the worker returns a mesh — distinguishes a transient error from a load failure. */
  private hasSucceeded = false;

  /**
   * @param poster a worker adapter, or `null` for synchronous main-thread meshing.
   * @param options optional {@link OccluderMeshDriverOptions.onWorkerUnusable} /
   *   {@link OccluderMeshDriverOptions.onError} callbacks.
   */
  constructor(
    poster: MeshWorkerPoster | null,
    options: OccluderMeshDriverOptions = {}
  ) {
    this.poster = poster;
    this.syncMode = poster === null;
    this.onWorkerUnusable = options.onWorkerUnusable;
    this.onError = options.onError;
    this.onMeshStats = options.onMeshStats;
    this.now = options.now ?? ((): number => performance.now());
    if (poster) {
      poster.onmessage = (event) => this.handleResponse(event.data);
      poster.onerror = (error) => this.handleWorkerError(error);
    }
  }

  /** True while a mesh job is being computed (worker path only). */
  get busy(): boolean {
    return this.inFlightId !== null;
  }

  /**
   * Request a mesh of `cells` (tuple array, or a flat Int32Array snapshot —
   * see `packMeshRequest`; a flat snapshot's buffer is transferred/detached,
   * so pass a fresh array). If a job is already in flight, this becomes the
   * (single) pending job — the newest request wins; intermediates are dropped.
   * `getCellPoint` is invoked with a transient cell tuple that may be a reused
   * scratch — it must not retain the tuple beyond the call (see
   * `MeshOccupiedCellsOptions.getCellPoint`).
   */
  request(
    cells: readonly GridCell[] | Int32Array,
    cellSizeM: number,
    mode: MeshMode,
    getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined,
    onMesh: OnMesh
  ): void {
    if (this.disposed) {
      return;
    }
    const job: Job = { cells, cellSizeM, mode, getCellPoint, onMesh };
    if (this.inFlightId !== null) {
      this.pending = job; // coalesce to latest
      return;
    }
    this.post(job);
  }

  private post(job: Job): void {
    const id = this.nextId++;
    this.inFlightId = id;
    this.inFlightCallback = job.onMesh;
    // `syncMode` cannot change while this job is in flight (it only flips on a
    // failure, which also clears this record), so capturing it here is safe.
    this.inFlightStats = {
      startedMs: this.now(),
      cellCount: cellCountOf(job.cells),
      mode: job.mode,
      synchronous: this.syncMode || this.poster === null,
    };
    // Packing runs the caller's `getCellPoint` per cell (surface modes) and can
    // throw on an invalid flat snapshot — and the slot was already marked
    // in-flight above, so an unguarded throw would wedge the driver exactly
    // like the two guarded sites below. Unlike those, a pack-time throw happens
    // on the main thread BEFORE the worker is involved, so it must not condemn
    // a (possibly healthy) worker to the synchronous fallback.
    let packed: ReturnType<typeof packMeshRequest>;
    try {
      packed = packMeshRequest(
        id,
        job.cells,
        job.cellSizeM,
        job.mode,
        job.getCellPoint
      );
    } catch (error) {
      this.failInFlight(id, error, { workerAtFault: false });
      return;
    }
    const { request, transfer } = packed;
    if (this.poster && !this.syncMode) {
      // `Worker.postMessage` can throw SYNCHRONOUSLY (a `DataCloneError` for a
      // non-cloneable payload, or an already-detached/invalid transferable).
      // The slot was marked in-flight above, so an unguarded throw would leave
      // `inFlightId` set forever and wedge the driver (every later request just
      // overwrites `pending` and never posts). Mirror the synchronous path:
      // clear the slot via `failInFlight` — a post that throws before the
      // worker ever meshed is treated as an unusable worker (→ sync fallback).
      try {
        this.poster.postMessage(request, transfer);
      } catch (error) {
        this.failInFlight(id, error);
      }
    } else {
      // Synchronous meshing (no worker, or the worker was declared unusable).
      // A throw here (e.g. an invalid cellSizeM) must not wedge the slot: clear
      // it, report, and drop the frame — the next refresh re-meshes a fresh
      // snapshot.
      try {
        const { response } = runMeshRequest(request);
        this.handleResponse(response);
      } catch (error) {
        if (this.inFlightId === id) {
          this.failInFlight(id, error);
        } else {
          // The slot is no longer ours ⇒ handleResponse completed the job
          // (its finally cleared the slot / drained pending) and the throw
          // came from the CONSUMER callback, not the mesh. Report it — the
          // worker path at least surfaces such throws as uncaught errors
          // from Worker.onmessage; swallowing them here hid consumer bugs.
          this.onError?.(error);
        }
      }
    }
  }

  private handleResponse(response: MeshWorkerResponse): void {
    if (this.disposed || response.id !== this.inFlightId) {
      return; // stale (e.g. a response after dispose)
    }
    this.hasSucceeded = true;
    const callback = this.inFlightCallback;
    const stats = this.inFlightStats;
    // Invoke the consumer callbacks while the slot is STILL reserved, so a
    // synchronously reentrant `request()` from either callback coalesces into
    // `pending` (the documented newest-wins policy) instead of posting
    // immediately and then racing the drain below into a double-post whose
    // reentrant response would be dropped as stale (PR #147 review). The clear
    // + drain sit in a `finally` so a THROWING callback cannot wedge the slot
    // or strand the pending job.
    try {
      if (stats && this.onMeshStats) {
        const { startedMs, ...rest } = stats;
        this.onMeshStats({ ...rest, durationMs: this.now() - startedMs });
      }
      callback?.(response.positions, response.indices);
    } finally {
      this.inFlightId = null;
      this.inFlightCallback = null;
      this.inFlightStats = null;
      // Post the coalesced latest, if one arrived while we were busy.
      if (!this.disposed && this.pending) {
        const next = this.pending;
        this.pending = null;
        this.post(next);
      }
    }
  }

  /**
   * A worker error event. If a job is in flight, recover it (only one ever is).
   * If none is — the realistic ordering for a **module-load failure**, which
   * errors within a few ms of construction, before the first (throttled)
   * `request` posts anything — the worker is dead: posting to it would be
   * silently dropped (no second error) and wedge the in-flight slot forever. So
   * a pre-first-post error on a worker that has **never** succeeded is treated as
   * a load failure right here — declare it unusable and switch to synchronous
   * meshing so the first `request` never touches the dead worker. A stray/late
   * error on a worker that has already meshed once is transient — kept, ignored.
   */
  private handleWorkerError(error?: unknown): void {
    if (this.disposed) {
      return;
    }
    if (this.inFlightId !== null) {
      this.failInFlight(this.inFlightId, error);
      return;
    }
    if (!this.syncMode && !this.hasSucceeded) {
      if (error !== undefined) {
        this.onError?.(error);
      }
      this.syncMode = true;
      this.onWorkerUnusable?.();
    }
  }

  /**
   * Clear a failed in-flight job so the driver never wedges. If the worker had
   * never produced a mesh (almost always a module load failure) fall back to
   * synchronous meshing — unless `workerAtFault` is false (a pack-time error in
   * the caller's `getCellPoint`, which never reached the worker). Then re-post
   * the pending snapshot if one is queued. We deliberately do NOT re-post the
   * *failed* job: if it failed on deterministic bad data, re-posting would
   * loop — the next refresh brings a fresh snapshot.
   */
  private failInFlight(
    id: number,
    error?: unknown,
    options: { workerAtFault?: boolean } = {}
  ): void {
    if (this.disposed || id !== this.inFlightId) {
      return; // stale
    }
    // Mirror of handleResponse: `onError` runs with the slot still reserved so
    // a consumer that reacts to a failure by re-requesting coalesces into
    // `pending` (newest-wins) instead of double-posting; the clear + fallback
    // decision + drain sit in a `finally` so a throwing `onError` cannot wedge.
    try {
      if (error !== undefined) {
        this.onError?.(error);
      }
    } finally {
      this.inFlightId = null;
      this.inFlightCallback = null;
      this.inFlightStats = null; // failed jobs report no stats (onError covers them)
      if (
        (options.workerAtFault ?? true) &&
        !this.syncMode &&
        !this.hasSucceeded
      ) {
        // The worker errored before ever meshing — treat it as unusable (we
        // will not get a second error to act on, and further posts would vanish
        // into a dead worker). Switch to synchronous main-thread meshing.
        this.syncMode = true;
        this.onWorkerUnusable?.();
      }
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this.post(next);
      }
    }
  }

  /** Stop delivering results (detaches the worker handlers; drops any pending). */
  dispose(): void {
    this.disposed = true;
    this.pending = null;
    this.inFlightCallback = null;
    this.inFlightId = null;
    this.inFlightStats = null;
    if (this.poster) {
      this.poster.onmessage = null;
      this.poster.onerror = null;
    }
  }
}
