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
  MeshChunk,
  CellExplanation,
  GeoEvent,
  LatLng,
  MeshData,
  PoiMarker,
  TreePlacement,
} from "gps-plus-slam-osm";

import type { DemoSnapshot } from "../demo-pipeline.js";
import type { GeoEventStats } from "../geo-event-stats.js";
import type { HeightfieldData } from "../heightfield.js";

/**
 * A built mesh plus the counters the status line reports.
 *
 * Trees cross as `TreePlacement` — the package's own ENU form — rather than as
 * scene coordinates. The ENU→scene reflection is a real trap (`+y` north becomes
 * `-z` north, and getting it wrong renders a forest 100 m from the buildings it
 * stands beside), but the package's own `packInstances` applies it — and that is
 * where its test lives. Converting here would drag the reflection into a module
 * that must not import `three` and would separate it from its test for no gain.
 */
export interface TransferableMesh {
  /**
   * Buildings, batched into spatial CHUNKS rather than one merged mesh (W20).
   *
   * three frustum-culls per `Object3D`, so one mesh spanning a 2.8 km tile is
   * all-or-nothing: distance and frustum culling were unavailable by
   * construction, which is what R4-16 saw as geometry kilometres away still
   * being drawn. A list of chunks is a list of things that can be culled.
   */
  readonly buildings: readonly MeshChunk[];
  readonly trees: readonly TreePlacement[];
  /**
   * Ground areas, CHUNKED like the buildings and for the same reason (W20).
   *
   * This said "one merged mesh" until PR #239, which is what it was before W20:
   * a working set has hundreds of small areas and a draw call each would
   * dominate the frame, so they were merged into one. W20 reversed exactly that
   * rationale — one mesh is one cull unit, so a merged tile could not be culled
   * at all. Chunks trade a handful of draw calls back for the ability to drop
   * the ones off screen.
   */
  readonly plates: readonly MeshChunk[];
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
   * Roads (W13), CHUNKED like the plates and for the same reason (W20).
   *
   * Also said "one merged mesh" until PR #239. See `plates` above: merging was
   * right when a draw call per way was the cost that mattered, and wrong once
   * the cost that mattered was drawing a kilometre of road behind the camera.
   */
  readonly roads: readonly MeshChunk[];
  readonly roadCount: number;
  /**
   * The below-surface features' outlines, in ENU, packed x,y per point.
   *
   * HERE RATHER THAN IN THE SNAPSHOT because the frame lives in the worker, as
   * it does for every other piece of scene geometry. A page converting lat/lng
   * for itself would need a second copy of the frame — and `recentre`
   * invalidates every ENU coordinate, so that copy goes stale exactly when the
   * user moves.
   *
   * EMPTY UNLESS THE LAYER IS ON. Like the cell array, this is a diagnostic that
   * is off by default and should not be built or transferred for nobody.
   */
  readonly underground: readonly Float32Array[];
  /**
   * Merged affordance regions as slabs (W14), one entry per region.
   *
   * ONE ENTRY PER REGION, and NOT chunked like the plates and the roads. The
   * reason is the colour: every region is drawn in the shade of its own
   * `medianScore`, so batching them would need per-vertex colours computed
   * against a scale the worker does not have. There are a handful of regions per
   * working set, not hundreds, so a draw call each is affordable — but note
   * that means a very large region is still one uncullable object (F27).
   *
   * The score rides along UNCOLOURED on purpose — see `region-slabs.ts.md`.
   */
  readonly regions: readonly RegionSlabData[];
  readonly volumes: number;
  readonly parts: number;
  readonly guessedHeights: number;
  readonly approximateRoofs: number;
  /**
   * Solid barriers drawn (DEC-R11-2).
   *
   * **Counted because DEC-R11-11 gave up the other way of checking.** Barriers
   * draw with the buildings, with no toggle and no distinct colour, so there is
   * no way to isolate them on screen — the count is what tells a walled site
   * apart from one where the barrier builder silently produced nothing.
   */
  readonly barriers: number;
}

/**
 * One region's slab, with the score the main thread colours it by.
 *
 * Not exported: it is reachable as `TransferableMesh["regions"][number]`, which
 * is how every other consumer in this demo names a member of a transferred
 * array, and knip is right that a second public name earns nothing.
 */
interface RegionSlabData {
  readonly medianScore: number;
  /** So a click on the slab resolves back to the region it draws (DEC-R7b-3a). */
  readonly id: string;
  readonly mesh: MeshData;
}

/** What the worker reports once its rule table is loaded. */
interface InitResult {
  readonly categories: readonly string[];
  readonly tier: string;
  readonly degradedBecause?: string;
}

/**
 * What one pass contributes to the geometry (W6, finding R3-3).
 *
 * AN EXPLICIT `kind` RATHER THAN AN OPTIONAL `mesh`. Progressive scoring runs
 * three passes per click and only the region slabs change between them — the
 * buildings, trees, POI markers, roads and plates are identical, because they
 * depend on the features, the terrain and the ENU frame origin, none of which a
 * widening ring touches. Rebuilding the whole city three times was most of the
 * per-click cost the round-3 notes reported as "the calculation just takes
 * longer".
 *
 * An optional field would read as "sometimes missing"; this is "deliberately not
 * resent", and a consumer that fails to handle it should fail at compile time
 * rather than draw nothing.
 */
export type MeshUpdate =
  | { readonly kind: "full"; readonly mesh: TransferableMesh }
  | {
      readonly kind: "regions";
      readonly regions: readonly RegionSlabData[];
      /**
       * The below-surface outlines, carried on the CHEAP reply as well.
       *
       * They belong here for the same reason the region slabs do: both change
       * without the features, the terrain or the frame origin changing, so a
       * reply that omitted them would leave the layer empty until something
       * unrelated forced a full rebuild. Toggling the layer does exactly that —
       * it refreshes at the SAME position, which is precisely when
       * `needsFullBuild` says no.
       */
      readonly underground: readonly Float32Array[];
    };

/** One finished data cycle. */
export interface UpdateResult {
  readonly snapshot: DemoSnapshot;
  readonly mesh: MeshUpdate;
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
  /**
   * Where the window was sampled, in the scene's frame — **reported even when
   * `field` is `undefined`.**
   *
   * A failed load still has to say WHERE it was asked to look. The ground plane
   * follows this centre, and the plane is finite: it reaches `TERRAIN_EXTENT_M`
   * and stops. Leaving it where it was during an outage means a user who walks
   * past that ends up off the edge of it with no ground beneath them — and the
   * 5 km re-anchor threshold puts that well inside one anchor. Raised in review
   * on #269, where the code returned early instead: that fixed the appearance
   * (moving a flat plane is invisible) and missed the coverage.
   */
  readonly centreEnu: { readonly x: number; readonly y: number };
}

/** Payload shape per request kind, and the result each one produces. */
export interface WorkerCalls {
  readonly init: {
    readonly request: Record<string, never>;
    readonly result: InitResult;
  };
  readonly update: {
    readonly request: {
      readonly position: LatLng;
      /**
       * Where the scene's ENU frame is anchored.
       *
       * **SEPARATE FROM `position`, and that separation is the point.** The
       * frame used to be derived from `position` on every publish, so every
       * vertex in the scene moved whenever the user did — which no AR content
       * can live with, because the framework's own origin is set once per
       * session and never again.
       *
       * `position` still says where the user is and therefore what to fetch and
       * what to clip to; this says what the coordinates MEAN. Conflating them
       * is the defect. See `scene-anchor.ts`.
       *
       * Omitted falls back to `position`, so a caller that has not adopted an
       * anchor yet behaves exactly as before.
       */
      readonly frameOrigin?: LatLng;
      readonly category: string;
      /**
       * Rings of chunks to score (W16). Omitted means the first pass's radius.
       *
       * The progressive path is repeated `update` calls with a growing radius
       * rather than one call that streams — the RPC is request/response, and a
       * streaming reply would need a second channel plus its own ordering and
       * abort semantics. Repeated calls get all of that from `latestOnly` for
       * free, and a superseded ring is simply a call that never happens.
       */
      readonly radius?: number;
      /**
       * Whether the cell array travels back (round 10, stage B).
       *
       * Omitted means yes, so nothing that does not opt out changes. The demo
       * passes `false` whenever the `cells` layer is off -- the default -- and
       * the page then reads `heatMax` and `cellCount` instead of deriving them
       * from ~24 000 cells it does not draw.
       */
      readonly includeCells?: boolean;
      /**
       * Whether the underground outlines are built and transferred.
       *
       * Omitted means NO, unlike `includeCells` — this layer has never been on
       * by default, so nothing existing expects the data.
       */
      readonly includeUnderground?: boolean;
    };
    readonly result: UpdateResult;
  };
  /**
   * The affordance grid's buffers (W8, R4-13).
   *
   * WHY THIS IS A CALL RATHER THAN PART OF `update`. The grid depends on
   * presentation state — the category, the threshold, the heat scale and the
   * below-threshold switch — and three of those change with NO new snapshot
   * behind them. Folding it into `update` would make a checkbox trigger a
   * refetch; a call of its own makes it exactly as expensive as it needs to be.
   *
   * WHY IT MOVED OFF THE MAIN THREAD AT ALL. `buildCellMesh` calls
   * `cellToBoundary` once per drawn cell — an H3 library call, thousands of
   * times, on the thread that also has to stay responsive — and then fills three
   * typed arrays. It is pure arithmetic over cell ids and the output is
   * transferable, so it is the one piece of R4-13's "could this happen in the
   * background" that genuinely could.
   *
   * The CELLS come with the request rather than being read from the worker's own
   * scoring state, and that is deliberate: the demo draws the snapshot it holds,
   * and a grid built from whatever the worker happened to score last would be a
   * second source of truth for what is on screen.
   */
  readonly cellMesh: {
    readonly request: {
      readonly cells: readonly {
        readonly cell: string;
        readonly score: number;
      }[];
      readonly centre: LatLng;
      /**
       * Where the scene's ENU frame is anchored.
       *
       * The grid is the fourth thing built through `meshOptions`, and it was
       * missed when the frame was fixed — so the cell overlay stayed anchored on
       * the user while the buildings underneath it moved to the scene's anchor.
       * Optional and falling back to `centre`, exactly as the `update` and
       * `terrain` requests are.
       */
      readonly frameOrigin?: LatLng;
      readonly threshold: number;
      readonly scale: { readonly threshold: number; readonly max: number };
      readonly showBelowThreshold: boolean;
      /**
       * The look preset’s two geometry axes (§3, DEC-R6-9).
       *
       * Only the two that change the VERTEX BUFFERS cross the boundary.
       * Opacity, fog and the lift are material and transform settings the view
       * applies on its own, and sending them here would make every cosmetic
       * keypress wait on a worker republish.
       */
      readonly extrude?: boolean;
      readonly heightByScore?: boolean;
    };
    readonly result: TransferableCellMesh;
  };
  readonly explain: {
    readonly request: { readonly cell: string; readonly category: string };
    /** `undefined` when the cell is not in the current snapshot. */
    readonly result: CellExplanation | undefined;
  };
  /**
   * The geo-event for a moment and a place (round 9).
   *
   * IT RUNS IN THE WORKER, and it has to: the index is private inside
   * DemoPipeline inside the worker, the climb reads it through SYNCHRONOUS
   * callbacks that cannot cross a structured clone, and the ensure step needs
   * the same fetch machinery updates use. Only the finished result crosses.
   */
  readonly geoEvent: {
    readonly request: {
      readonly position: LatLng;
      readonly category: string;
      /**
       * Epoch ms. Passed in so a test can pin a quarter-hour — and, since W6,
       * so the user can: the picker sends the instant it was given rather than
       * "now".
       */
      readonly now: number;
      /**
       * The C#'s handover window, in minutes. Defaults to the production five.
       *
       * **THE PICKER SENDS ZERO, and that is the whole reason this crosses the
       * boundary.** The overlap models "I am arriving now, do not send me to a
       * spawn that is about to move", so it is applied BEFORE the rounding —
       * which means asking for exactly 18:00 resolves to 18:15. That is right
       * for a live search and wrong for an explicit pick, where "show me 18:00"
       * is a request for that slot. Without this the dialog would answer every
       * question with the quarter after the one asked.
       */
      readonly overlapMinutes?: number;
    };
    /**
     * The event AND what finding it cost (W7).
     *
     * A PAIR RATHER THAN JUST THE EVENT, because the cost is only observable
     * here: the counters live on the index and the phase timings on the pipeline,
     * both private inside the worker. Returning them is what makes DEC-G7's
     * "benchmark first" possible without a second RPC that would measure a
     * different search.
     */
    readonly result: {
      readonly event: GeoEvent;
      readonly stats: GeoEventStats;
    };
  };
  readonly terrain: {
    readonly request: {
      /** Where the user is — what the sampled window is FOR. */
      readonly centre: LatLng;
      /**
       * Where the scene's ENU frame is anchored — what the heights MEAN.
       *
       * Optional, falling back to `centre`, so a caller that has not adopted an
       * anchor keeps the pre-5B behaviour rather than silently getting a frame
       * it did not ask for. `main.ts` always sends it.
       */
      readonly frameOrigin?: LatLng;
      readonly extentM: number;
      readonly spacingM: number;
    };
    readonly result: TerrainResult;
  };
}

/**
 * The grid, as buffers.
 *
 * Structurally `CellMesh` minus nothing — it is re-declared here rather than
 * imported so `protocol.ts` stays the single statement of what crosses the
 * boundary, and so a field added to `CellMesh` that is NOT transferable fails
 * here rather than at runtime.
 */
/* NOT exported: nothing outside this file names it — the demo side works in
 * `CellMesh`, which this is the transferable statement of. Exporting it would be
 * a second name for the same shape, and knip is right to say so. */
interface TransferableCellMesh {
  readonly cells: readonly string[];
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  /** Per-vertex normals carrying the faked rim bevel (DEC-S2). */
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly cellForTriangle: readonly string[];
  readonly linePositions: Float32Array;
  readonly lineColors: Float32Array;
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
  "geoEvent",
  "terrain",
  "cellMesh",
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
