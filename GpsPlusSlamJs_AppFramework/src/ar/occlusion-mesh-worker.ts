/**
 * Occlusion-mesh Web Worker protocol (framework-owned, reusable).
 *
 * The persistent occluder full-rebuilds the whole grid mesh every refresh —
 * O(total cells), 100s of ms at hundreds of metres (see
 * `2026-07-01-0733-occluder-worker-and-chunked-remesh-plan.md`). Moving
 * {@link meshOccupiedCells} to a Web Worker keeps rendering smooth regardless of
 * mesh time. This module holds the **pure, transfer-friendly** halves so a
 * consumer only needs a trivial worker *shell* (any app can copy ~5 lines):
 *
 * - {@link packMeshRequest} (main thread) — packs an occupied-cell snapshot (and,
 *   for the surface-hugging modes, the per-cell measured centroids) into
 *   **transferable** typed arrays.
 * - {@link runMeshRequest} (worker) — unpacks, runs `meshOccupiedCells`, and
 *   returns the geometry as transferable typed arrays.
 *
 * A `runMeshRequest(packMeshRequest(…))` round-trip is byte-identical to a direct
 * `meshOccupiedCells` call (centroids are carried at full f64 precision).
 */

import type { Vector3 } from 'gps-plus-slam-js';
import type { GridCell } from './bresenham3d';
import { packCellKey as packKey } from './cell-key';
import { meshOccupiedCells, type MeshMode } from './occupancy-mesher';

/** Main-thread → worker: an occupied-cell snapshot to mesh. */
export interface MeshWorkerRequest {
  /** Correlates a response with its request (the driver coalesces by newest id). */
  readonly id: number;
  /** Flat occupied cells `[x0,y0,z0, x1,y1,z1, …]`. */
  readonly cells: Int32Array;
  readonly cellSizeM: number;
  readonly mode: MeshMode;
  /**
   * Per-cell measured surface point, flat and parallel to `cells`
   * (`[cx,cy,cz, …]`), or `null` for the cube modes that ignore it. A `NaN`
   * triple marks a cell whose `getCellPoint` was `null` (geometric fallback).
   */
  readonly centroids: Float64Array | null;
}

/** Worker → main thread: the meshed geometry (typed arrays, transferable). */
export interface MeshWorkerResponse {
  readonly id: number;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** Only the surface-hugging modes read `getCellPoint`. */
function needsCentroids(mode: MeshMode): boolean {
  return mode === 'smooth' || mode === 'corner-fit';
}

// Numeric cell key for the worker's parallel-array centroid lookup — the
// shared implementation (`cell-key.ts`); only ever called for cells inside the
// mesher's HALF_LATTICE tier, so the keys are collision-free.

/**
 * Pack an occupied-cell snapshot into a transferable {@link MeshWorkerRequest}
 * (main thread). `transfer` is the list to pass as the second `postMessage` arg
 * so the buffers move (not copy) to the worker.
 *
 * `cells` may be the classic tuple array or an already-flat
 * `[x0,y0,z0, x1,y1,z1, …]` Int32Array (Step 1.3 of the 2026-07-03
 * long-session fps plan — `OccupancyGrid.getOccupiedCellsFlat` hands the
 * snapshot over flat, deleting the tuple intermediate this function used to
 * re-flatten). A flat snapshot is used **zero-copy**: its buffer lands in
 * `transfer` and is DETACHED after posting — callers must pass a fresh array
 * they do not reuse. Throws `RangeError` when a flat snapshot's length is not
 * a multiple of 3 (a truncated buffer must fail loudly, not mesh garbage).
 *
 * `getCellPoint` receives a **transient** cell tuple (a reused scratch on the
 * flat path — see `MeshOccupiedCellsOptions.getCellPoint` for the contract):
 * implementations must not retain the tuple beyond the call.
 */
export function packMeshRequest(
  id: number,
  cells: readonly GridCell[] | Int32Array,
  cellSizeM: number,
  mode: MeshMode,
  getCellPoint?: (cell: GridCell) => Vector3 | null
): { request: MeshWorkerRequest; transfer: ArrayBufferLike[] } {
  let flat: Int32Array;
  let n: number;
  if (cells instanceof Int32Array) {
    if (cells.length % 3 !== 0) {
      throw new RangeError(
        `flat cell snapshot length must be a multiple of 3, got ${cells.length}`
      );
    }
    flat = cells;
    n = cells.length / 3;
  } else {
    n = cells.length;
    flat = new Int32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = cells[i]!;
      flat[i * 3] = c[0];
      flat[i * 3 + 1] = c[1];
      flat[i * 3 + 2] = c[2];
    }
  }
  let centroids: Float64Array | null = null;
  if (needsCentroids(mode) && getCellPoint) {
    centroids = new Float64Array(n * 3);
    // One reusable lookup tuple for the flat path — getCellPoint implementations
    // key off the coordinates and never retain the tuple, so mutation is safe
    // and saves n short-lived allocations on the hot pack path.
    const scratch: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      let cell: GridCell;
      if (cells instanceof Int32Array) {
        scratch[0] = flat[i * 3]!;
        scratch[1] = flat[i * 3 + 1]!;
        scratch[2] = flat[i * 3 + 2]!;
        cell = scratch;
      } else {
        cell = cells[i]!;
      }
      const cp = getCellPoint(cell);
      if (cp) {
        centroids[i * 3] = cp[0];
        centroids[i * 3 + 1] = cp[1];
        centroids[i * 3 + 2] = cp[2];
      } else {
        centroids[i * 3] = NaN;
        centroids[i * 3 + 1] = NaN;
        centroids[i * 3 + 2] = NaN;
      }
    }
  }
  const request: MeshWorkerRequest = {
    id,
    cells: flat,
    cellSizeM,
    mode,
    centroids,
  };
  const transfer: ArrayBufferLike[] = [flat.buffer];
  if (centroids) {
    transfer.push(centroids.buffer);
  }
  return { request, transfer };
}

/**
 * Mesh a {@link MeshWorkerRequest} (worker side). Returns the geometry plus the
 * transfer list for posting back. Byte-identical to a direct `meshOccupiedCells`.
 */
export function runMeshRequest(request: MeshWorkerRequest): {
  response: MeshWorkerResponse;
  transfer: ArrayBufferLike[];
} {
  const { id, cells: flat, cellSizeM, mode, centroids } = request;
  const n = flat.length / 3;
  const cells: GridCell[] = [];
  for (let i = 0; i < n; i++) {
    cells.push([flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!]);
  }

  // 'smooth' consumes the wire-format centroids array DIRECTLY (input-order
  // aligned — exactly how this function receives it), deleting the per-cell
  // key-map + callback + result-tuple plumbing from the hottest re-mesh loop
  // (2026-07-17 perf loop, iteration 2). Other centroid-consuming modes
  // ('corner-fit') keep the callback adapter below.
  let getCellPoint: ((cell: GridCell) => Vector3 | null) | undefined;
  const pts = centroids;
  if (pts && mode !== 'smooth') {
    const indexByKey = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      indexByKey.set(
        packKey(flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!),
        i
      );
    }
    getCellPoint = (cell: GridCell): Vector3 | null => {
      const i = indexByKey.get(packKey(cell[0], cell[1], cell[2]));
      if (i === undefined) {
        return null;
      }
      const cx = pts[i * 3]!;
      if (Number.isNaN(cx)) {
        return null;
      }
      return [cx, pts[i * 3 + 1]!, pts[i * 3 + 2]!];
    };
  }

  // The worker response carries only geometry — skip the AABB list the
  // direct-call API builds (it was ~2 discarded allocations per cell here).
  const mesh = meshOccupiedCells(cells, cellSizeM, {
    mode,
    getCellPoint,
    centroids,
    includeAabbs: false,
  });
  const response: MeshWorkerResponse = {
    id,
    positions: mesh.positions,
    indices: mesh.indices,
  };
  return {
    response,
    transfer: [mesh.positions.buffer, mesh.indices.buffer],
  };
}
