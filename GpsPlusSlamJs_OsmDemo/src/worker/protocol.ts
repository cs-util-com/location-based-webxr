/**
 * The demo's main-thread ↔ worker contract, as data.
 *
 * WHY A WORKER AT ALL. Everything expensive in this demo ran on the UI thread:
 * an Overpass response measured at 28–68 MB of JSON to parse, a 19-chunk scoring
 * pass, a mesh build, and (since the terrain extent grew) ~55 000 DEM samples.
 * `gps-plus-slam-osm` was designed for this from the start — it documents itself
 * as worker-safe in six places, its public types are deliberately
 * structured-cloneable, and its mesh output is `Float32Array` specifically so it
 * can **transfer** rather than copy — but no consumer had ever exercised any of
 * it. This is the first one, so treat every claim here as newly tested rather
 * than long-established.
 *
 * WHY THE PROTOCOL IS ITS OWN MODULE. It is the one part of the boundary that is
 * pure data and can be checked without a worker, a browser or a GPU. The client
 * (`rpc-client.ts`) is tested against an in-process fake transport, and the
 * worker entry (`demo-worker.ts`) is the only file that needs a real one.
 *
 * WHAT MUST NOT BE PUT IN HERE. Anything non-cloneable: class instances,
 * functions, `Map`/`Set` of non-cloneable values, getters. A `Heightfield`
 * exposes a **method** (`heightAt`), so it cannot cross — the transferable form
 * carries the posts plus the geometry needed to rebuild the sampler on the other
 * side. Getting this wrong throws `DataCloneError` at runtime and never at
 * compile time, which is why `worker-round-trip.test.ts` exists.
 *
 * @see protocol.ts.md
 */

import type {
  CellExplanation,
  LatLng,
  MeshData,
  PoiMarker,
  TreePlacement,
} from "gps-plus-slam-osm";

import type { DemoSnapshot } from "../demo-pipeline.js";
import type { HeightfieldData } from "../heightfield.js";

/**
 * A built mesh plus the counters the status line reports.
 *
 * Trees cross as `TreePlacement` — the package's own ENU form — rather than as
 * scene coordinates. The ENU→scene reflection is a real trap (`+y` north becomes
 * `-z` north, and getting it wrong renders a forest 100 m from the buildings it
 * stands beside), but `treeConePosition` is the one part of the draw loop that is
 * provable without a GPU and it is already unit-tested where it lives. Moving it
 * here to save a conversion would drag it into a module that must not import
 * `three` and would separate it from its test for no benefit.
 */
export interface TransferableMesh {
  readonly buildings: MeshData;
  readonly trees: readonly TreePlacement[];
  /**
   * Ground areas, one merged mesh.
   *
   * MERGED rather than one mesh per plate: a working set has hundreds of small
   * areas, and a draw call each would dominate the frame. The buildings take the
   * same trade for the same reason.
   */
  readonly plates: MeshData;
  readonly plateCount: number;
  /**
   * POI markers (W12), as placements for the same reason trees are.
   *
   * They carry `feature`, `kind` and `label` as well as a position, because a
   * marker the app cannot name is a dot — and naming it is the entire feature.
   * Deriving the label again on this side from tags the worker still holds would
   * be a second source of truth for what a POI is called.
   */
  readonly poi: readonly PoiMarker[];
  /**
   * Roads, one merged mesh (W13).
   *
   * MERGED like the plates and for the same reason: a working set has hundreds
   * of ways and a draw call each would dominate the frame.
   */
  readonly roads: MeshData;
  readonly roadCount: number;
  readonly volumes: number;
  readonly parts: number;
  readonly guessedHeights: number;
  readonly approximateRoofs: number;
}

/** What the worker reports once its rule table is loaded. */
interface InitResult {
  readonly categories: readonly string[];
  readonly tier: string;
  readonly degradedBecause?: string;
}

/** One finished data cycle. */
export interface UpdateResult {
  readonly snapshot: DemoSnapshot;
  readonly mesh: TransferableMesh;
}

export interface TerrainResult {
  /**
   * `undefined` when the ground stays FLAT — never a sea-level field.
   *
   * `HeightfieldData` rather than `Heightfield`: the latter exposes `heightAt` as
   * a **method**, and structured clone drops methods silently, leaving an object
   * that looks right until the first call. The main thread rebuilds the sampler
   * with `heightfieldFrom`.
   */
  readonly field: HeightfieldData | undefined;
  /** One phrase for the status line, never empty. */
  readonly note: string;
}

/** Payload shape per request kind, and the result each one produces. */
export interface WorkerCalls {
  readonly init: {
    readonly request: Record<string, never>;
    readonly result: InitResult;
  };
  readonly update: {
    readonly request: { readonly position: LatLng; readonly category: string };
    readonly result: UpdateResult;
  };
  readonly explain: {
    readonly request: { readonly cell: string; readonly category: string };
    /** `undefined` when the cell is not in the current snapshot. */
    readonly result: CellExplanation | undefined;
  };
  readonly terrain: {
    readonly request: {
      readonly centre: LatLng;
      readonly extentM: number;
      readonly spacingM: number;
    };
    readonly result: TerrainResult;
  };
}

export type WorkerCallKind = keyof WorkerCalls;

/** What the main thread posts. `abort` carries the id it is cancelling. */
export type WorkerEnvelope =
  | {
      readonly id: number;
      readonly kind: WorkerCallKind;
      readonly payload: unknown;
    }
  | { readonly id: number; readonly kind: "abort"; readonly target: number };

/**
 * What the worker posts back.
 *
 * Deliberately a discriminated result rather than a thrown error: an exception
 * inside a worker does not reject anything on the main thread, so a failure that
 * is not turned into a message is a promise that never settles. A hung demo is
 * strictly worse than a reported failure, and it is the default outcome if this
 * shape is not respected.
 */
export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly message: string };

/** True for a value shaped like a reply. Guards the `message` event. */
export function isWorkerReply(value: unknown): value is WorkerReply {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkerReply>;
  if (typeof candidate.id !== "number") return false;
  return typeof candidate.ok === "boolean";
}

/** Every kind the worker accepts, as a runtime-checkable set. */
const CALL_KINDS = new Set<string>([
  "init",
  "update",
  "explain",
  "terrain",
] satisfies WorkerCallKind[]);

/**
 * True for a value shaped like a request. Guards the worker's `message` event.
 *
 * The `satisfies` above is what keeps this honest: adding a kind to
 * {@link WorkerCalls} without adding it here would be a request the worker
 * silently ignores — a promise that never settles rather than a type error — so
 * the set is checked against the union at compile time.
 */
export function isWorkerEnvelope(value: unknown): value is WorkerEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkerEnvelope & { target: unknown }>;
  if (typeof candidate.id !== "number") return false;
  if (typeof candidate.kind !== "string") return false;
  if (candidate.kind === "abort") return typeof candidate.target === "number";
  return CALL_KINDS.has(candidate.kind);
}
