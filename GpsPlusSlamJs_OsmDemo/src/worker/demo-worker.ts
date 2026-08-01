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
  buildPoiMarkers,
  buildRegionSlabs,
  type SlabRegion,
  buildRoads,
  buildTrees,
  enuFrameAt,
  metresToDegrees,
  explainCell,
  loadRuleTable,
  buildingColour,
  chunkMeshes,
  featureKey,
  meshCentroidEnu,
  roadColour,
  type LatLng,
  type OsmFeature,
  type RuleTable,
} from "gps-plus-slam-osm";
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
} from "gps-plus-slam-app-framework/osm-bridge";

import { buildCellMesh } from "../cell-mesh.js";
import { DemoPipeline } from "../demo-pipeline.js";
import { describeTerrain } from "../terrain-note.js";
import {
  createHeightfieldCache,
  TERRAIN_EXTENT_M,
  type HeightfieldData,
} from "../heightfield.js";
import { createTerrainField, type TerrainField } from "../terrain-field.js";
import { createMeshPlanner } from "./mesh-planner.js";
import { createPrefetchQueue, type PrefetchQueue } from "./prefetch-queue.js";
import { createTerrainGate, needsTerrainFor } from "./terrain-gate.js";
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
   * The background ring loader (W8, DEC-R2-6).
   *
   * Built with the same `CachingSource` the pipeline fetches through, so a
   * prefetched tile lands in the OPFS blob store and the next click reads it
   * from disk instead of the network. **Deliberately not merged into the index**
   * — see `prefetch-queue.ts` for why warming the cache is the whole job.
   */
  readonly prefetch: PrefetchQueue;
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

/**
 * Which centre {@link terrain} belongs to — including when it came back empty.
 *
 * RECORDED EVEN ON FAILURE, and that is the difference between a degraded scene
 * and a stalled one: it answers "is the terrain question resolved for this
 * position?", not "is there relief?". A DEM outage resolves the question.
 */
let terrainCentre: { lat: number; lng: number } | undefined;

/**
 * Releases a mesh build that is waiting for its own position's terrain (W3).
 *
 * The main thread now fires the terrain load and the refresh CONCURRENTLY, so a
 * mesh build can reach this worker before the DEM grid it must stand on. See
 * `terrain-gate.ts` for why the join is keyed on the position rather than on the
 * order the two messages arrive in.
 */
const terrainGate = createTerrainGate();

/**
 * The ENU frame at `centre` plus the terrain sampler every builder reads.
 *
 * ONE PLACE, because the region slabs are now built on their own as well as
 * inside a full mesh (W6) and the two must stand on the same surface. Deriving
 * the sampler twice is the shape of defect this demo keeps finding: two
 * computations that agree today with nothing asserting they always will.
 */
/**
 * The key the cell-mesh request's single score is filed under.
 *
 * `buildCellMesh` looks a score up by category, and the caller has already
 * chosen one — so the category name itself never crosses the boundary. A fixed
 * private key makes that explicit instead of shipping the real name and
 * pretending the lookup still means something.
 */
const CELL_MESH_CATEGORY = "score";

/**
 * The sampler for whatever terrain is currently held.
 *
 * Both readers below go through this rather than calling `heightfieldFrom`
 * themselves: `heightAtEnu` is invoked PER VERTEX of the affordance grid, and
 * rebuilding the sampler inside it allocated a `HeightfieldData` spread and a
 * closure for every one of them (PR #239).
 */
const fieldFor = createHeightfieldCache();

/** The current terrain sampler in ENU, or flat. Used by the cell-mesh call. */
function heightAtEnu(point: { x: number; y: number }): number {
  const field = fieldFor(terrain);
  return field === undefined ? 0 : field.heightAt(point);
}

function meshOptions(centre: LatLng): {
  frame: ReturnType<typeof enuFrameAt>;
  groundHeightM?: (position: LatLng) => number;
} {
  const frame = enuFrameAt(centre);
  const field = fieldFor(terrain);
  if (field === undefined) return { frame };
  return {
    frame,
    groundHeightM: (position: LatLng) => field.heightAt(frame.toEnu(position)),
  };
}

/**
 * A lat/lng box of `halfWidthM × CLIP_SLACK` around `centre`.
 *
 * The conversion itself comes from the package (`metresToDegrees`), so this does
 * not re-derive metres-per-degree or the `1 / cos(latitude)` longitude scaling —
 * both of which `cellPaddingDegrees` already owns. Two copies of that arithmetic
 * is the shape this file's own `TERRAIN_EXTENT_M` move was made to avoid, and
 * PR #236 caught it being reintroduced one function later.
 *
 * THE SLACK IS REAL, not decorative. Without it the box is EXACTLY the ground
 * plane, edge-aligned with zero margin, so a plate reaching the very edge of the
 * rendered square is clipped precisely at the boundary the camera can see. A few
 * per cent of over-keeping costs a handful of triangles that fall just outside
 * the view; under-keeping would cut a plate the user is looking at.
 */
const CLIP_SLACK = 1.05;

function clipBoxAround(
  centre: LatLng,
  halfWidthM: number,
): { south: number; west: number; north: number; east: number } {
  const reach = halfWidthM * CLIP_SLACK;
  const { lat } = metresToDegrees(centre.lat, reach);
  // `metresToDegrees` asks for the latitude FURTHEST from the equator that the
  // result must cover, and that is the box's poleward edge, not its centre —
  // passing `centre.lat` would make the far edge slightly short (PR #237).
  // Negligible here (~0.16 % at 85 deg, many times covered by CLIP_SLACK), but
  // honouring the contract costs one extra call and removes the need for the
  // next reader to redo that arithmetic.
  const { lng } = metresToDegrees(Math.abs(centre.lat) + lat, reach);
  return {
    south: centre.lat - lat,
    north: centre.lat + lat,
    west: centre.lng - lng,
    east: centre.lng + lng,
  };
}

/** Builds the scene geometry for the current features, on the current terrain. */
function buildMesh(
  features: Iterable<OsmFeature>,
  centre: LatLng,
  /**
   * The scored regions.
   *
   * From the SNAPSHOT, not from the features: a region is a product of scoring
   * — a flood fill over affordance cells — rather than of geometry, so it is the
   * one input to the mesh build that the feature set cannot supply. Passed in
   * rather than re-derived, so the slab a user sees and the outline the map
   * draws are the same region.
   */
  regions: readonly SlabRegion[] = [],
): TransferableMesh {
  const options = meshOptions(centre);
  const all = [...features];
  // Areas are clipped to what is actually rendered before they are triangulated.
  // WHY ONLY THE PLATES: ear clipping is O(n²) in ring size and OSM area size is
  // unbounded, so ONE administrative boundary relation — 25 001 points, spanning
  // 100+ km of which 2.8 km is drawn — cost 2 657 ms of the 2 881 ms this build
  // took, on every click (measured 2026-07-31). Buildings and roads are small
  // polygons and short ribbons, so they never reach the quadratic and are left
  // unclipped rather than changed on speculation.
  const plateClip = clipBoxAround(centre, TERRAIN_EXTENT_M);

  const volumes = buildBuildings(all, options);
  const trees = buildTrees(all, options);
  // Same options as the trees: a marker floating over sloped ground reads as a
  // placement bug, and the sampler is the one already built for this frame.
  const poi = buildPoiMarkers(all, options);
  // PER-VERTEX terrain, like the plates: a road is a long surface, and one
  // sample would cut into the hill at one end and float at the other.
  const roads = buildRoads(all, options);
  // Per-vertex terrain again: a region can be hundreds of metres across.
  const regionSlabs = buildRegionSlabs(regions, options);
  // PER-VERTEX terrain for plates, unlike buildings: a 30 m car park sampled once
  // would cut into the ground at one end and float at the other, which is exactly
  // the artefact the building change removed. The same option name carries both
  // because the builders call it differently, which is where the difference belongs.
  const plates = buildAreaPlates(all, { ...options, clipTo: plateClip });
  // BATCHED PER CHUNK, not merged into one (W20, R4-16). The comment that used
  // to be here said a single batch was right "even though the package's general
  // guidance is to batch per res-8/res-9 cell", on the grounds that the view is
  // always wholly on screen. DEC-R2-8 grew the extent to 2.8 km and that stopped
  // being true — and one mesh cannot be frustum-culled in parts, which is
  // exactly what R4-16 reports.
  // TAGS BY KEY, so the colour of a piece of geometry comes from the feature it
  // was built from (W22/W23). The builders return an `OsmFeatureKey` rather than
  // the tags — they have no reason to carry them — so the lookup is assembled
  // here, where the feature set already is.
  const tagsByKey = new Map(
    all.map((feature) => [featureKey(feature), feature.tags]),
  );

  const buildings = chunkMeshes(
    volumes,
    (volume) => volume.mesh,
    (volume) => meshCentroidEnu(volume.mesh),
    undefined,
    // A `building:part` inherits its PARENT's colour: the parts of one building
    // are one building, and colouring them independently would stripe a cathedral
    // by whichever part happened to carry which tag.
    (volume) =>
      buildingColour(
        tagsByKey.get(volume.parentFeature ?? volume.feature) ??
          tagsByKey.get(volume.feature) ??
          {},
      ),
  );

  return {
    buildings,
    trees,
    plates: chunkMeshes(
      plates,
      (plate) => plate.mesh,
      (plate) => meshCentroidEnu(plate.mesh),
    ),
    plateCount: plates.length,
    poi,
    roads: chunkMeshes(
      roads,
      (road) => road.mesh,
      (road) => meshCentroidEnu(road.mesh),
      undefined,
      (road) => roadColour(tagsByKey.get(road.feature) ?? {}),
    ),
    roadCount: roads.length,
    regions: regionSlabs,
    volumes: volumes.length,
    parts: volumes.filter((v) => v.parentFeature !== undefined).length,
    guessedHeights: volumes.filter((v) => v.heights.heightIsGuessed).length,
    // THE REAL FLAG, not a proxy: a gabled roof on an actual rectangle is EXACT,
    // and that is the common case the approximation trade rests on.
    approximateRoofs: volumes.filter((v) => v.roofIsApproximate).length,
  };
}

/**
 * Decides whether a pass rebuilds the geometry or only re-sends the slabs (W6).
 *
 * The decision itself lives in `mesh-planner.ts`, where it can be tested without
 * a worker — this file only supplies the inputs and acts on the answer.
 */
const meshPlanner = createMeshPlanner();

/** Bumped whenever the held terrain is replaced; an input to the planner. */
let terrainStamp = 0;

/**
 * Builds what this pass actually needs to send.
 *
 * The region slabs are ALWAYS rebuilt, because they are a product of SCORING and
 * scoring is exactly what a widening ring changes. Everything else is a product
 * of the features, the terrain and the frame origin.
 */
function meshUpdateFor(
  snapshot: { position: LatLng; regions: readonly SlabRegion[] },
  pipeline: DemoPipeline,
): WorkerCalls["update"]["result"]["mesh"] {
  const full = meshPlanner.needsFullBuild({
    position: snapshot.position,
    loadedTileCount: pipeline.loadedTileCount(),
    terrainStamp,
  });

  if (!full) {
    return {
      kind: "regions",
      regions: buildRegionSlabs(
        snapshot.regions,
        meshOptions(snapshot.position),
      ),
    };
  }
  return {
    kind: "full",
    mesh: buildMesh(
      pipeline.features().values(),
      snapshot.position,
      snapshot.regions,
    ),
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
      // ONE STORE, AND THE RULE TABLE GETS IT TOO. This was
      // `loadRuleTable({})` — no store — which quietly disabled two things the
      // loader documents as load-bearing: `readCache` returns `undefined`
      // immediately, so the TTL short-circuit never fires and every boot went to
      // the network; and `checkDrift` has no baseline to compare against, since
      // drift is comparative and the shipped snapshot is explicitly the wrong
      // baseline (the loader's own header says so). The guard existed and was
      // inert in its only consumer. Raised in review on #233.
      //
      // The same OPFS store serves both because the keys are namespaced —
      // `rules/v1/table.csv` against `osm/v{n}/{tile}` — and a second store would
      // be a second OPFS directory for no reason.
      const store = await makeStore();
      const loaded = await loadRuleTable({ store });
      const source = new CachingSource(
        new OverpassSource({
          userAgent: "gps-plus-slam-osm-demo (github.com/cs-util-com)",
        }),
        store,
      );
      const pipeline = new DemoPipeline({ source, table: loaded.table });
      state = {
        pipeline,
        table: loaded.table,
        // Through the SAME source, so a prefetched tile is written to the same
        // OPFS blob store the next foreground fetch reads from. A separate
        // source would warm a cache nobody consults.
        prefetch: createPrefetchQueue({
          fetchTile: (tile, prefetchSignal) =>
            source.fetchTile(tile, prefetchSignal),
          isLoaded: (tile) => pipeline.hasTile(tile),
        }),
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
      const { position, category, radius } =
        payload as WorkerCalls["update"]["request"];
      const { pipeline, prefetch } = requireState();
      const snapshot = await pipeline.update(
        position,
        category,
        signal,
        radius,
      );
      // THE JOIN (W3). The fetch and the scoring above ran while the DEM grid
      // for this position was still being sampled — that concurrency is the
      // whole item — so the mesh must not be built until the terrain UNDER THIS
      // POSITION has landed. Anything else stands the buildings on the previous
      // position's relief, permanently, because nothing rebuilds them when the
      // field arrives.
      //
      // Skipped when the held field already belongs here, which is every
      // category change and every widening ring: those never move the user, so
      // there is nothing to wait for and waiting would give back what W3 won.
      if (needsTerrainFor(terrainCentre, position)) {
        await terrainGate.waitFor(position, signal);
      }
      // THE RING, AFTER the visible work (W8, DEC-R2-6). Queued here rather than
      // before the fetch loop because the user's own tile must never wait behind
      // a background one — the public instances allocate ~2 slots per client.
      // `replace` states the whole desired set, so moving away drops the tiles of
      // the place left behind, including the one in flight.
      prefetch.replace(pipeline.neighbourTilesFor(position));
      return {
        snapshot,
        mesh: meshUpdateFor(snapshot, pipeline),
      };
    }

    case "terrain": {
      const { centre, extentM, spacingM } =
        payload as WorkerCalls["terrain"]["request"];
      const { terrainField } = requireState();
      try {
        return await loadTerrain(
          terrainField,
          centre,
          extentM,
          spacingM,
          signal,
        );
      } finally {
        // IN A `finally`, and that is load-bearing. A mesh build waiting on this
        // centre is asking "is the terrain question resolved here?", not "is
        // there relief here?" — so a DEM outage, an abort and a success all
        // release it. Releasing only on success turns a failed tile into a
        // stalled mesh, which is the one outcome worse than flat ground.
        terrainGate.settle(centre);
      }
    }

    case "cellMesh": {
      const request = payload as WorkerCalls["cellMesh"]["request"];
      // The SAME builder the main thread used, moved rather than reimplemented:
      // a second grid builder would be a second answer to "which cells are
      // drawn and what colour are they", which is the disagreement the shared
      // store exists to prevent.
      const options = meshOptions(request.centre);
      return buildCellMesh(
        request.cells.map(({ cell, score }) => ({
          cell,
          // `buildCellMesh` reads `scores[category]`; the caller has already
          // resolved the category, so it arrives as a single value under a
          // fixed key rather than as the whole score record. Sending every
          // category's score for every cell would be the bulk of the payload
          // for data the grid cannot use.
          scores: { [CELL_MESH_CATEGORY]: score },
        })),
        {
          frame: options.frame,
          category: CELL_MESH_CATEGORY,
          threshold: request.threshold,
          scale: request.scale,
          showBelowThreshold: request.showBelowThreshold,
          ...(options.groundHeightM === undefined
            ? {}
            : {
                heightAt: (point: { x: number; y: number }) =>
                  heightAtEnu(point),
              }),
        },
      );
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
 * Samples the DEM grid for one centre and adopts it as the current terrain.
 *
 * Split out of {@link handle} so the `finally` that settles the terrain gate has
 * exactly one statement to guard — with the body inline, the gate's release
 * would sit ~30 lines away from the `try` it belongs to.
 */
async function loadTerrain(
  terrainField: TerrainField,
  centre: LatLng,
  extentM: number,
  spacingM: number,
  signal: AbortSignal,
): Promise<WorkerCalls["terrain"]["result"]> {
  // GROW the cache to cover the view, then RENDER a bounded grid from it.
  // The split is the whole point: the growth is incremental and permanent,
  // while what crosses the boundary stays a fixed-shape grid.
  // `extentM`, NOT `extentM * SQRT2`. `ensureAround` builds a SQUARE lattice of
  // half-width `radiusM`, and `sampleGrid` reads a SQUARE of half-width
  // `extentM` — so the circumscribed-circle radius over-built by √2 per axis,
  // i.e. twice the posts, for ground nothing ever samples.
  //
  // Harmless while the extent was 1400 m (110 889 posts, under the cache cap)
  // and NOT harmless at 2400 m: it put the lattice at 321 489 posts against a
  // 250 000 cap, so eviction ran on every load and threw away ~71 000 posts that
  // the next load immediately re-fetched — the exact opposite of what
  // `terrain-field.ts` exists to do. The 5 % margin covers the Mercator pitch
  // changing slightly across the square; `ensureAround`'s own `+1` covers the
  // bilinear read at the very edge.
  await terrainField.ensureAround(centre, extentM * 1.05);
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
  // `await` boundary in this function, so everything from that check to this
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
  // The mesh key reads this: a new field means the heights every builder samples
  // have changed, so the next pass must rebuild rather than re-send slabs (W6).
  terrainStamp += 1;
  // RECORDED EVEN WHEN THE FIELD IS EMPTY. This is what the mesh build's join
  // reads to decide whether it already has the terrain for its own position, and
  // "the DEM failed here" is an answer to that question. Recording it only on
  // success would make every later mesh build at this position wait out the
  // gate's full timeout.
  terrainCentre = centre;
  return {
    field: terrain,
    note: describeTerrain(field),
  };
}

/**
 * Buffers to hand over rather than copy, per request kind.
 *
 * WHY PER KIND AND NOT A BLANKET SWEEP. Transferring **detaches** a buffer on this
 * side, so it may only be done for data the worker does not keep:
 *
 * - **update** — the mesh comes from `chunkMeshes`, freshly allocated per call and
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
  const update = (value as UpdateResult | undefined)?.mesh;
  // A REGIONS-ONLY REPLY TRANSFERS NOTHING (W6). It has no `buildings` or
  // `plates` to hand over, and the slab buffers are not in this list either —
  // which is worth knowing rather than assuming: the win from W6 is the BUILD
  // being skipped, not a transfer being saved.
  if (update === undefined || update.kind !== "full") return [];
  const mesh = update.mesh;
  // PER CHUNK since W20. The layers are lists now, so the transfer list is a
  // flatMap rather than six fields — and it must stay complete: a buffer left
  // out is silently COPIED instead of moved, which is invisible except as the
  // thing this list exists to avoid.
  return [...mesh.buildings, ...mesh.plates, ...mesh.roads]
    .flatMap((chunk) => [
      chunk.mesh.positions.buffer,
      chunk.mesh.normals.buffer,
      chunk.mesh.indices.buffer,
    ])
    .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
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
