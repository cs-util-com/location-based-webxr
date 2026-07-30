/**
 * The worker: everything expensive in the demo, off the UI thread.
 *
 * WHAT LIVES HERE AND WHY. All four of the demo's costly operations, because all
 * four blocked the UI before this existed:
 *
 * - **Fetch and parse.** An Overpass response for one res-7 tile is 28–68 MB of
 *   JSON. `resolutions.ts` said outright that "it is why parsing belongs in a
 *   worker" — this is that worker.
 * - **Scoring.** 19 res-11 chunks, 931 res-13 cells, one synchronous pass.
 * - **The mesh build.** Its output is `Float32Array`/`Uint32Array` precisely so it
 *   can **transfer** rather than copy (`mesh/extrude.ts` says so), which only
 *   pays off across a boundary like this one.
 * - **DEM sampling.** ~55 000 posts once the terrain covers the rendered extent.
 *
 * THIS IS THE FIRST CONSUMER TO EXERCISE ANY OF IT. `gps-plus-slam-osm`
 * documents itself as worker-safe in six places and shapes its public types
 * around the constraint (structured-cloneable only, no class instances crossing),
 * and until now nothing had ever tested that. Treat the claim as newly verified.
 *
 * WHY THE HEIGHTFIELD IS HELD HERE rather than passed in with each mesh request.
 * The buildings, the trees and (later) the ground layers all have to stand on the
 * SAME surface, and the surface is per-position while the mesh is rebuilt per
 * category change too. Holding it worker-side means one owner and no possibility
 * of the main thread sending a stale field back — which is the exact class of bug
 * `terrain-cycle.ts` was written to prevent when both lived on the main thread.
 *
 * WHY OPFS STILL WORKS. `navigator.storage.getDirectory()` is available in
 * workers, so the tile cache moves here with the fetching rather than staying
 * behind — and a worker is the better home for it, since OPFS offers synchronous
 * access handles only off the main thread.
 *
 * @see demo-worker.ts.md
 */

import {
  CachingSource,
  MemoryBlobStore,
  OverpassSource,
  TerrariumProvider,
  browserPngDecoder,
  buildAreaPlates,
  buildBuildings,
  buildTrees,
  enuFrameAt,
  explainCell,
  loadRuleTable,
  mergeMeshes,
  type LatLng,
  type OsmFeature,
  type RuleTable,
} from "gps-plus-slam-osm";
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
} from "gps-plus-slam-app-framework/osm-bridge";

import { DemoPipeline } from "../demo-pipeline.js";
import { describeTerrain } from "../terrain-note.js";
import { heightfieldFrom, type HeightfieldData } from "../heightfield.js";
import { createTerrainField, type TerrainField } from "../terrain-field.js";
import {
  isWorkerEnvelope,
  type TransferableMesh,
  type WorkerCallKind,
  type UpdateResult,
  type WorkerCalls,
} from "./protocol.js";

/**
 * OPFS where available, memory otherwise.
 *
 * OPFS is the point — a cached res-7 tile is tens of MB and refetching it on
 * every reload would be an abuse of donated infrastructure. But the demo must
 * still run in a browser without it rather than refusing to start.
 */
async function makeStore() {
  try {
    const root = await navigator.storage.getDirectory();
    return new OpfsOsmBlobStore({
      directory: await openOsmStoreDirectory(root),
    });
  } catch {
    return new MemoryBlobStore();
  }
}

/** Everything the worker owns, built once on `init`. */
interface WorkerState {
  readonly pipeline: DemoPipeline;
  readonly table: RuleTable;
  /**
   * The terrain cache, built once and grown for the whole session (DEC-R2-21).
   *
   * Session-scoped rather than per-request: that IS the change. A post fetched
   * for one position is reused for every later one nearby, so walking costs only
   * the new edge instead of re-sampling the whole square.
   */
  readonly terrainField: TerrainField;
}

let state: WorkerState | undefined;

/**
 * The terrain under the current position, as data.
 *
 * Held rather than returned-and-forgotten because the mesh build needs it and is
 * triggered by a different request (a category change rebuilds the mesh without
 * moving the user). One owner, so the surface the buildings stand on and the
 * surface the ground plane draws cannot disagree.
 */
let terrain: HeightfieldData | undefined;

/** Builds the scene geometry for the current features, on the current terrain. */
function buildMesh(
  features: Iterable<OsmFeature>,
  centre: LatLng,
): TransferableMesh {
  const frame = enuFrameAt(centre);
  const all = [...features];

  // ONE sample per building, taken at its anchor, and one per tree — so a long
  // building across a slope still cuts into the hill at one end. That is a
  // property of the mesh layer, not of this call.
  const field = terrain === undefined ? undefined : heightfieldFrom(terrain);
  const groundHeightM =
    field === undefined
      ? undefined
      : (position: LatLng) => field.heightAt(frame.toEnu(position));
  const options =
    groundHeightM === undefined ? { frame } : { frame, groundHeightM };

  const volumes = buildBuildings(all, options);
  const trees = buildTrees(all, options);
  // PER-VERTEX terrain for plates, unlike buildings: a 30 m car park sampled once
  // would cut into the ground at one end and float at the other, which is exactly
  // the artefact the building change removed. The same option name carries both
  // because the builders call it differently, which is where the difference belongs.
  const plates = buildAreaPlates(all, options);
  // ONE merged geometry: this view shows one working set at a time and is always
  // wholly on screen, so a single batch is right here even though the package's
  // general guidance is to batch per res-8/res-9 cell.
  const buildings = mergeMeshes(volumes.map((volume) => volume.mesh));

  return {
    buildings,
    trees,
    plates: mergeMeshes(plates.map((plate) => plate.mesh)),
    plateCount: plates.length,
    volumes: volumes.length,
    parts: volumes.filter((v) => v.parentFeature !== undefined).length,
    guessedHeights: volumes.filter((v) => v.heights.heightIsGuessed).length,
    // THE REAL FLAG, not a proxy: a gabled roof on an actual rectangle is EXACT,
    // and that is the common case the approximation trade rests on.
    approximateRoofs: volumes.filter((v) => v.roofIsApproximate).length,
  };
}

/** The state, or a clear error rather than a confusing `undefined` dereference. */
function requireState(): WorkerState {
  if (state === undefined) {
    throw new Error("The worker received a request before `init`");
  }
  return state;
}

async function handle<K extends WorkerCallKind>(
  kind: K,
  payload: WorkerCalls[K]["request"],
  signal: AbortSignal,
): Promise<unknown> {
  switch (kind) {
    case "init": {
      const loaded = await loadRuleTable({});
      const source = new CachingSource(
        new OverpassSource({
          userAgent: "gps-plus-slam-osm-demo (github.com/cs-util-com)",
        }),
        await makeStore(),
      );
      state = {
        pipeline: new DemoPipeline({ source, table: loaded.table }),
        table: loaded.table,
        terrainField: createTerrainField({
          provider: new TerrariumProvider({ decodePng: browserPngDecoder() }),
        }),
      };
      return {
        categories: loaded.table.categories,
        tier: loaded.tier,
        ...(loaded.degradedBecause === undefined
          ? {}
          : { degradedBecause: loaded.degradedBecause }),
      };
    }

    case "update": {
      const { position, category } =
        payload as WorkerCalls["update"]["request"];
      const { pipeline } = requireState();
      const snapshot = await pipeline.update(position, category, signal);
      return {
        snapshot,
        mesh: buildMesh(pipeline.features().values(), snapshot.position),
      };
    }

    case "terrain": {
      const { centre, extentM, spacingM } =
        payload as WorkerCalls["terrain"]["request"];
      const { terrainField } = requireState();
      // GROW the cache to cover the view, then RENDER a bounded grid from it.
      // The split is the whole point: the growth is incremental and permanent,
      // while what crosses the boundary stays a fixed-shape grid.
      await terrainField.ensureAround(centre, extentM * Math.SQRT2);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const field = terrainField.sampleGrid({
        frame: enuFrameAt(centre),
        extentM,
        spacingM,
      });
      // Stored even when empty, so a later mesh build cannot stand on the
      // PREVIOUS position's relief after a DEM outage at this one.
      //
      // A SUPERSEDED LOAD CANNOT REACH THIS LINE, and the reason is worth stating
      // because it is not obvious: the `signal.aborted` throw above is the last
      // `await` boundary in this handler, so everything from that check to this
      // assignment runs in one synchronous turn. An `abort` message can only be
      // delivered between turns, so it cannot land in the gap.
      //
      // That matters because the alternative is the exact failure this file's
      // header says holding the field worker-side prevents: two overlapping loads
      // where the OLDER one writes last, leaving the mesh built on one position's
      // relief while the main thread's ground plane draws another's. Raised in
      // review against the commit before the terrain cache landed, where there was
      // no check here at all and the hole was real.
      terrain = field.hasData ? field : undefined;
      return {
        field: terrain,
        note: describeTerrain(field),
      };
    }

    case "explain": {
      const { cell, category } = payload as WorkerCalls["explain"]["request"];
      const { pipeline, table } = requireState();
      const scored = pipeline.scoreFor(cell);
      if (scored === undefined) return undefined;
      // The covering feature set comes from the PROVENANCE MAP, never re-derived
      // from geometry — a second source of truth about which features cover a
      // cell could disagree with the score it is explaining.
      const merged = pipeline.features();
      const covering = Object.keys(scored.contributors[category] ?? {})
        .map((key) => merged.get(key as Parameters<typeof merged.get>[0]))
        .filter((feature): feature is OsmFeature => feature !== undefined);
      return explainCell(cell, covering, table, category);
    }

    default:
      throw new Error(`Unknown request kind: ${String(kind)}`);
  }
}

/**
 * Buffers to hand over rather than copy, per request kind.
 *
 * WHY PER KIND AND NOT A BLANKET SWEEP. Transferring **detaches** a buffer on this
 * side, so it may only be done for data the worker does not keep:
 *
 * - **update** — the mesh comes from `mergeMeshes`, freshly allocated per call and
 *   never retained here, so handing it over is free. This is the payload that
 *   matters: the building geometry is the largest thing that crosses.
 * - **terrain** — the field's `heights` MUST NOT be transferred. That same object
 *   stays in module state for the next mesh build, and detaching it would leave the
 *   worker holding a zero-length array. Buildings would silently drop to flat ground
 *   on the following refresh, which reads as a terrain bug rather than as a
 *   memory-ownership one.
 * - **init / explain** — small plain objects with nothing worth transferring.
 *
 * Until this existed the package's `Float32Array` output was only transfer**able**,
 * while four docstrings claimed the transfer itself as the payoff of the worker
 * split. Raised in review on #228: the docs asserted a property the code lacked.
 */
function transferablesOf(kind: WorkerCallKind, value: unknown): Transferable[] {
  if (kind !== "update") return [];
  const mesh = (value as UpdateResult | undefined)?.mesh;
  if (mesh === undefined) return [];
  return [
    mesh.buildings.positions.buffer,
    mesh.buildings.normals.buffer,
    mesh.buildings.indices.buffer,
    mesh.plates.positions.buffer,
    mesh.plates.normals.buffer,
    mesh.plates.indices.buffer,
  ].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}

/**
 * `postMessage` with a transfer list, typed for a worker rather than a window.
 *
 * The project ships the DOM lib and not WebWorker, so `self` types as a `Window`
 * and its `postMessage` overloads expect a `targetOrigin` string — which makes the
 * transfer-list form a type error at every call site. Narrowed once here instead of
 * casting twice, and deliberately NOT by adding the WebWorker lib globally: that
 * would let every other file in this app reach for worker-only globals.
 */
const postToMain = self.postMessage.bind(self) as (
  message: unknown,
  transfer?: Transferable[],
) => void;

/** In-flight requests, so an `abort` can actually stop the work it names. */
const inFlight = new Map<number, AbortController>();

self.addEventListener("message", (event: MessageEvent) => {
  const envelope: unknown = event.data;
  // GUARDED. The channel is shared with whatever else posts to it (a bundler's
  // HMR ping, for one), and a handler that assumes its own shape throws inside
  // an event listener where nothing catches it — killing the worker and hanging
  // every pending call on the other side.
  if (!isWorkerEnvelope(envelope)) return;

  if (envelope.kind === "abort") {
    inFlight.get(envelope.target)?.abort();
    inFlight.delete(envelope.target);
    return;
  }

  const { id, kind, payload } = envelope;
  const controller = new AbortController();
  inFlight.set(id, controller);

  // EVERY path replies. An exception in a worker rejects nothing on the main
  // thread, so a request whose failure is not turned into a message is a promise
  // that never settles — a demo that silently stops, which is strictly worse
  // than one that reports an error.
  void handle(kind, payload as never, controller.signal)
    .then(
      (value) => {
        // A superseded request must not resolve: the caller has already rejected
        // it and a late success would be applied to a position the user left.
        if (controller.signal.aborted) return;
        postToMain({ id, ok: true, value }, transferablesOf(kind, value));
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        postToMain({
          id,
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    )
    .finally(() => {
      inFlight.delete(id);
    });
});
