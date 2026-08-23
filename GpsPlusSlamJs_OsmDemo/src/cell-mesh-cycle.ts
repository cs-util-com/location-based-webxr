/**
 * The affordance grid's build, moved off the main thread and coalesced (W8).
 *
 * WHY IT MOVED (R4-13, DEC-R4-4). `buildCellMesh` calls `cellToBoundary` once
 * per drawn cell — an H3 library call, thousands of times — and then fills three
 * typed arrays. That ran on the thread that also has to stay responsive, on
 * every publish, three publishes per click. It is pure arithmetic over cell ids
 * whose output is transferable, which makes it the one piece of the notes'
 * _"gibt's noch Sachen, die im Vordergrund berechnen, die eher im Hintergrund
 * passieren könnten"_ that genuinely could move. The rest — Leaflet's SVG and
 * three's uploads — needs the DOM and the GL context and cannot.
 *
 * WHY IT NEEDS COALESCING, and why that is not optional. The grid is rebuilt by
 * FIVE different triggers: a new snapshot, a category change, the
 * below-threshold switch, a layer toggle, and the scale moving underneath it.
 * Three of those are a checkbox — a user can produce two in a hundred
 * milliseconds — and an RPC has no ordering guarantee, so without `latestOnly`
 * the older build can land last and paint a grid the store no longer describes.
 * That is exactly the class of defect R3-5 was: an async result arriving after
 * the state it belonged to.
 *
 * WHY IT REPORTS THROUGH A CALLBACK. The caller draws the result into a view
 * that must never show a grid from a different snapshot than the map does; an
 * `apply` makes "the grid and everything it was built from move together" the
 * shape of the code rather than a rule to remember.
 *
 * WHAT HAPPENS ON FAILURE: nothing is drawn and nothing is cleared. A grid that
 * could not be rebuilt is not evidence that the previous one was wrong — and
 * blanking on a superseded call is precisely the bug DEC-R3-12 removed.
 *
 * @see cell-mesh-cycle.ts.md
 */

import type { LatLng } from "gps-plus-slam-osm";

import type { CellMesh } from "./cell-mesh.js";
import { latestOnly, type LatestOnly } from "./latest-only.js";
import type { WorkerCalls } from "./worker/protocol.js";

/** What one grid build needs. Everything here is plain, cloneable data. */
export interface CellMeshRequest {
  readonly cells: readonly { readonly cell: string; readonly score: number }[];
  /** Where the user is — what the grid is drawn AROUND. */
  readonly centre: LatLng;
  /**
   * Where the scene's ENU frame is anchored — what the grid's coordinates MEAN.
   *
   * The grid is the fourth thing built through the worker's `meshOptions`, and
   * the one missed when the frame was fixed: the overlay stayed anchored on the
   * user while the buildings under it moved to the scene's anchor, so the two
   * slid apart by the walked distance. Optional, falling back to `centre`, so a
   * caller that has not adopted an anchor keeps the old behaviour rather than
   * silently getting a frame it did not ask for.
   */
  readonly frameOrigin?: LatLng;
  readonly threshold: number;
  readonly scale: { readonly threshold: number; readonly max: number };
  readonly showBelowThreshold: boolean;
  /**
   * The look preset's two GEOMETRY axes (§3, DEC-R6-9).
   *
   * Only the axes that change the vertex buffers travel to the worker. Opacity,
   * fog and the lift are a material and a transform, applied by the view — and
   * routing them through here would make every cosmetic keypress wait on a
   * republish over up to ~6 223 cells.
   */
  readonly extrude?: boolean;
  readonly heightByScore?: boolean;
}

export interface CellMeshCycleOptions {
  /**
   * Narrowed to the one call this needs.
   *
   * A structural type rather than `RpcClient`, so a test can drive the cycle
   * with a stub instead of a worker — the same reason `terrain-cycle.ts` does it.
   */
  readonly worker: {
    call(
      kind: "cellMesh",
      payload: WorkerCalls["cellMesh"]["request"],
      options?: { readonly signal?: AbortSignal },
    ): Promise<WorkerCalls["cellMesh"]["result"]>;
  };
  /** Called with a finished grid. Never called for a superseded build. */
  readonly apply: (mesh: CellMesh) => void;
}

export type CellMeshCycle = LatestOnly<CellMeshRequest>;

export function createCellMeshCycle(
  options: CellMeshCycleOptions,
): CellMeshCycle {
  return latestOnly(async (request: CellMeshRequest, signal: AbortSignal) => {
    const built = await options.worker.call("cellMesh", request, { signal });
    // Checked AFTER the await as well as being handed the signal: a build that
    // was superseded while in flight must not paint, and `latestOnly` can only
    // stop the CALL, not a reply already on its way.
    if (signal.aborted) return;
    options.apply(built);
  });
}
