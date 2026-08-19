/**
 * The worker: everything expensive in the demo, off the UI thread.
 *
 * WHAT LIVES HERE AND WHY. All four of the demo's costly operations, because all
 * four blocked the UI before this existed:
 *
 * - **Fetch and parse.** An Overpass response for one res-7 tile is ~21 MB of
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
  browserPngDecoder,
  buildAreaPlates,
  buildBarriers,
  buildBuildings,
  annotatePoiHosts,
  buildPoiMarkers,
  dropHostedDuplicates,
  hostDerivedMarkers,
  poiKind,
  poiModelFor,
  stablePoiScale,
  stableRotationY,
  buildObstacleIndex,
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
  isPedestrianPath,
  meshCentroidEnu,
  roadColour,
  type RacingElevationProvider,
  type RacingProviderStats,
  type LatLng,
  type OsmFeature,
  type RuleTable,
} from "gps-plus-slam-osm";
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
} from "gps-plus-slam-app-framework/osm-bridge";

import { planRouteWithIndex } from "../agent-route.js";
import { createDemProvider } from "../dem-provider.js";
import { WALKABLE_CATEGORY, walkableScoreOf } from "../route-penalty.js";
import { buildCellMesh } from "../cell-mesh.js";
import { shellRandFor } from "./shell-rand.js";
import { DemoPipeline } from "../demo-pipeline.js";
import { nowMs, nowEpochMs } from "../monotonic-clock.js";
import { describeTerrain } from "../terrain-note.js";
import {
  createHeightfieldCache,
  TERRAIN_EXTENT_M,
  type HeightfieldData,
} from "../heightfield.js";
import { createTerrainField, type TerrainField } from "../terrain-field.js";
import { terrainWindowFor } from "../terrain-window.js";
import { createMeshPlanner } from "./mesh-planner.js";
import { createObstacleIndexCache } from "./obstacle-index-cache.js";
import { createPrefetchQueue, type PrefetchQueue } from "./prefetch-queue.js";
import { createTerrainGate, needsTerrainFor } from "./terrain-gate.js";
import { createTerrainUpgradeSink } from "./terrain-upgrade-sink.js";
import {
  meshOutdatedByTerrain,
  type MeshBuildRecord,
} from "./terrain-arrival.js";
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
  /**
   * The composed DEM provider's `sourceId`, reported with every terrain
   * result so the page labels a field with the provider that sampled it.
   */
  readonly demSourceId: string;
  /**
   * A snapshot of the provider's cumulative serving stats — which member
   * answered how many positions. A FUNCTION, not a value: the counters live
   * on the provider and move with every batch, and each terrain result must
   * carry the numbers as of ITS load, copied so the page's snapshot cannot
   * mutate under it.
   */
  readonly demStats: () => RacingProviderStats;
  /**
   * The racing provider itself, so `terrainUpgrade` can await the loser.
   *
   * Held alongside `demStats` rather than replacing it because the two answer
   * different questions and are read at different moments: `demStats` is
   * snapshotted into every reply, this is awaited by one RPC.
   */
  readonly demProvider: RacingElevationProvider;
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
let terrainCentre:
  | { lat: number; lng: number; undulationM: number | undefined }
  | undefined;

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
  /**
   * Where the user is — what to CLIP to, not what the coordinates mean.
   *
   * Kept separate from `frameOrigin` below. Conflating the two is what made
   * every vertex move whenever the user did.
   */
  centre: LatLng,
  /**
   * Where the scene's ENU frame is anchored. Defaults to `centre`, which is the
   * pre-anchor behaviour.
   */
  frameOrigin: LatLng,
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
  /**
   * Outlines of the features excluded as below-surface, in lat/lng.
   *
   * EMPTY UNLESS THE LAYER IS ON. Converting and packing them costs a pass over
   * every excluded feature, which is wasted whenever nobody is drawing them --
   * the same rule the cell array follows since round 10 stage B.
   */
  undergroundOutlines: readonly (readonly LatLng[])[] = [],
): TransferableMesh {
  const options = meshOptions(frameOrigin);
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
  // BARRIERS ARE DRAWN, and drawn WITH the buildings (DEC-R11-2, DEC-R11-11).
  // `nav/obstacles.ts` has blocked agents with these since #259; until now
  // nothing put them on screen, which DEC-R7b-14 rules out — an NPC dodging
  // geometry the viewer cannot see demonstrates nothing, and the Tower renders
  // without its curtain wall at all. No toggle and no distinct colour: a wall is
  // part of the built world, so it goes through `buildingColour` like the rest.
  const barriers = buildBarriers(all, options);
  const trees = buildTrees(all, options);
  // Same options as the trees: a marker floating over sloped ground reads as a
  // placement bug, and the sampler is the one already built for this frame.
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

  // EVERY MARKER LEARNS WHAT IT SITS INSIDE (DEC-S1, DEC-S2, stage 1).
  //
  // AFTER THE PLATES, DELIBERATELY. Plates are clipped to the rendered extent
  // before triangulation, so a pool near the tile edge exists as a feature and
  // is NOT drawn. Matching against `all` rather than against what
  // `buildAreaPlates` returned would suppress that pool's marker and draw
  // nothing in its place — the data loss DEC-S1 is written to prevent, arriving
  // through the back door.
  //
  // NOTHING IS DECIDED HERE. The worker cannot know which layers are on (a
  // toggle does not re-run it), so this only collects candidates;
  // `resolvePoiPlacement` picks on the main thread, per rebuild.
  //
  // BUILDINGS FIRST, because the first enabled host wins and a building is the
  // more specific claim about a marker standing on a landuse plate inside it.
  const hostCandidates = [
    ...volumes.map((volume) => ({
      layer: "buildings" as const,
      feature: volume.feature,
      footprint: volume.footprint,
      topM: volume.topHeightM,
    })),
    ...plates.map((plate) => ({
      layer: "plates" as const,
      feature: plate.feature,
      footprint: plate.footprint,
      // A plate is on the ground, and it only ever suppresses — nothing is
      // placed above it — so there is no top to report.
      topM: 0,
    })),
  ];
  const nodeMarkers = annotatePoiHosts(
    buildPoiMarkers(all, options),
    hostCandidates,
  );

  // STAGE 2: the places that exist ONLY as geometry (DEC-S2). A restaurant
  // mapped as a building way and no node has no marker to re-anchor, and that
  // is ORDINARY tagging rather than an edge case — it is most of the owner's
  // headline example, "das Gebäude ist also ein Restaurant".
  //
  // ELIGIBILITY IS AN ALLOW-LIST, not "anything with a POI tag". `plates.ts`
  // owns every area whose tags match its own keys, and those OVERLAP the POI
  // keys — so a deny-list would let a car park through, since a restaurant
  // building and a car park both carry `amenity`. Only kinds with a symbol to
  // float qualify, which is exactly `poiModelFor(kind)?.symbol`.
  const byKey = new Map(all.map((feature) => [featureKey(feature), feature]));
  const derived = dropHostedDuplicates(
    hostDerivedMarkers(
      hostCandidates,
      (feature) => {
        const tags = byKey.get(feature)?.tags;
        return tags === undefined ? undefined : poiKind(tags);
      },
      (kind) => poiModelFor(kind)?.symbol !== undefined,
    ),
    nodeMarkers,
  );

  // APPENDED, NEVER INTERLEAVED. The consumer indexes marker identity by
  // position in this array, so putting a way-derived marker in the middle would
  // renumber every node marker after it and make each later pick name the wrong
  // feature.
  const poi = [
    ...nodeMarkers,
    ...derived.map((entry) => ({
      feature: entry.feature,
      position: { x: entry.host.x, y: entry.host.y },
      groundHeightM: entry.host.topM,
      kind: entry.kind,
      label: entry.kind.slice(entry.kind.indexOf("=") + 1),
      rotationY: stableRotationY(entry.feature),
      scale: stablePoiScale(entry.feature),
      hosts: [entry.host],
    })),
  ];
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

  // TAGS RESOLVED HERE, not in the colour callback, because the two sources
  // differ in exactly one way: a `building:part` inherits its PARENT's colour —
  // the parts of one building are one building, and colouring them
  // independently would stripe a cathedral by whichever part carried which tag
  // — while a barrier has no parent and is simply itself.
  const drawn = [
    ...volumes.map((volume) => ({
      mesh: volume.mesh,
      tags:
        tagsByKey.get(volume.parentFeature ?? volume.feature) ??
        tagsByKey.get(volume.feature) ??
        {},
    })),
    ...barriers.map((barrier) => ({
      mesh: barrier.mesh,
      tags: tagsByKey.get(barrier.feature) ?? {},
    })),
  ];

  const buildings = chunkMeshes(
    drawn,
    (item) => item.mesh,
    (item) => meshCentroidEnu(item.mesh),
    undefined,
    (item) => buildingColour(item.tags),
    // THE PHASE OFFSET FOR THE AR SHELL SHADER. Derived from the feature's own
    // first vertex rather than from its index, so it is STABLE across rebuilds:
    // an index-derived value would re-shuffle every refresh and the city would
    // visibly re-randomise whenever a tile loaded.
    (item) => shellRandFor(item.mesh),
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
    // CONVERTED HERE because this is where the frame is. Every other piece of
    // scene geometry is built in this function for the same reason, and
    // `recentre` invalidates ENU coordinates, so a page-side copy of the frame
    // would go stale exactly when the user moves.
    underground: packUnderground(undergroundOutlines, options.frame),
    regions: regionSlabs,
    volumes: volumes.length,
    parts: volumes.filter((v) => v.parentFeature !== undefined).length,
    guessedHeights: volumes.filter((v) => v.heights.heightIsGuessed).length,
    // THE REAL FLAG, not a proxy: a gabled roof on an actual rectangle is EXACT,
    // and that is the common case the approximation trade rests on.
    approximateRoofs: volumes.filter((v) => v.roofIsApproximate).length,
    barriers: barriers.length,
  };
}

/**
 * Decides whether a pass rebuilds the geometry or only re-sends the slabs (W6).
 *
 * The decision itself lives in `mesh-planner.ts`, where it can be tested without
 * a worker — this file only supplies the inputs and acts on the answer.
 */
const meshPlanner = createMeshPlanner();

/**
 * The navigation obstacle index, held across clicks (DEC-R11-16/19).
 *
 * NOT BUILT ON THE PUBLISH PATH, and that is DEC-R11-19 rather than DEC-R11-16
 * as first written. The corpus measurement
 * (`GpsPlusSlamJs_Osm/src/testdata/sites/site-obstacle-index-cost.test.ts`) put
 * a res-13 sweep at ~1 900–2 700 covered cells per extract and a few hundred
 * milliseconds — on extracts smaller than this demo's working set — so building
 * it inside `buildMesh` would slow every publish for a feature most sessions
 * never use. It appears on the first route request instead and survives until
 * the feature set moves.
 */
const obstacleIndex = createObstacleIndexCache(buildObstacleIndex);

/** Bumped whenever the held terrain is replaced; an input to the planner. */
let terrainStamp = 0;

/**
 * What the mesh currently on screen was built from (F1d).
 *
 * Read only by the `terrain` handler, to answer "did this field arrive too late
 * for the mesh that is already drawn?" — see `terrain-arrival.ts` for why that
 * question is asked here and not on the page. `undefined` until the first build.
 */
let lastMeshBuild: MeshBuildRecord | undefined;

/**
 * `update` handlers currently running.
 *
 * A COUNTER RATHER THAN A BOOLEAN because nothing serialises the handlers: the
 * page can post a second `update` (a category change, a widening ring) while
 * the first is still waiting at the terrain gate, and a boolean cleared by
 * whichever finished first would report "idle" with one still running. That
 * false idle is exactly what would let the late-terrain signal abort a live
 * Overpass fetch — see `TerrainArrival.updatesInFlight`.
 */
let updatesInFlight = 0;

/**
 * Builds what this pass actually needs to send.
 *
 * The region slabs are ALWAYS rebuilt, because they are a product of SCORING and
 * scoring is exactly what a widening ring changes. Everything else is a product
 * of the features, the terrain and the frame origin.
 */
/**
 * Packs below-surface outlines into ENU x,y pairs.
 *
 * ONE IMPLEMENTATION FOR BOTH REPLY KINDS. The full mesh and the regions-only
 * reply each need these, and two copies of the conversion is how they would
 * eventually disagree about the frame.
 */
function packUnderground(
  outlines: readonly (readonly LatLng[])[],
  frame: ReturnType<typeof enuFrameAt>,
): Float32Array[] {
  return outlines.map((outline) => {
    const packed = new Float32Array(outline.length * 2);
    for (let i = 0; i < outline.length; i += 1) {
      const point = outline[i];
      if (point === undefined) continue;
      const enu = frame.toEnu(point);
      packed[i * 2] = enu.x;
      packed[i * 2 + 1] = enu.y;
    }
    return packed;
  });
}

function meshUpdateFor(
  snapshot: {
    position: LatLng;
    regions: readonly SlabRegion[];
    undergroundOutlines: readonly (readonly LatLng[])[];
  },
  pipeline: DemoPipeline,
  frameOrigin: LatLng,
): WorkerCalls["update"]["result"]["mesh"] {
  const full = meshPlanner.needsFullBuild({
    position: snapshot.position,
    loadedTileCount: pipeline.loadedTileCount(),
    terrainStamp,
  });

  if (!full) {
    const options = meshOptions(frameOrigin);
    return {
      kind: "regions",
      regions: buildRegionSlabs(snapshot.regions, options),
      underground: packUnderground(snapshot.undergroundOutlines, options.frame),
    };
  }
  return {
    kind: "full",
    mesh: buildMesh(
      pipeline.features().values(),
      snapshot.position,
      frameOrigin,
      snapshot.regions,
      snapshot.undergroundOutlines,
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
      // THE SAME STORE AGAIN, third tenant: DEM tiles are keyed by their full
      // request URL, so they coexist with `osm/v{n}/…` and `rules/v1/…` the
      // same way those two coexist with each other. The composition itself —
      // Mapterhorn primary, AWS fallback, one caching fetch — lives behind
      // `createDemProvider`, where it is unit-testable; only the browser-bound
      // pieces (this store, the real decoder) are supplied here.
      // LATE BINDING, and it is unavoidable rather than untidy. The provider
      // must exist before `createTerrainField` can be given it, and the
      // upgrade callback must call back INTO that field — a cycle. A `let`
      // assigned one statement later is the smallest honest way to close it;
      // the alternative is a setter on the provider, which is the same
      // mutability with more surface.
      const upgradeSink: {
        apply?: (
          positions: readonly LatLng[],
          heights: readonly (number | undefined)[],
        ) => void;
      } = {};
      const demProvider = createDemProvider({
        store,
        decodePng: browserPngDecoder(),
        onUpgrade: (positions, heights) =>
          upgradeSink.apply?.(positions, heights),
      });
      const terrainField = createTerrainField({ provider: demProvider });
      upgradeSink.apply = createTerrainUpgradeSink(terrainField, () => {
        terrainStamp += 1;
      });
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
        terrainField,
        demSourceId: demProvider.sourceId,
        demStats: () => ({ ...demProvider.stats }),
        demProvider,
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
      const {
        position,
        frameOrigin,
        category,
        radius,
        includeCells,
        includeUnderground,
        postedAtEpochMs,
        geoidUndulationM,
      } = payload as WorkerCalls["update"]["request"];
      const { pipeline, prefetch } = requireState();
      // THE QUEUE WAIT — post to dispatch, the one measurement here that has
      // to cross the boundary. `nowEpochMs()` is `timeOrigin + now()`, an
      // absolute timeline both sides share, so this is a real duration rather
      // than the offset a raw `now()` subtraction would give.
      //
      // It matters because this worker also runs the concurrent DEM load
      // (W3, posted from the same tick in `main.ts`), so on a new position an
      // `update` can sit here behind ~55 000 heightfield samples. Until this
      // existed that time was folded into the page-side "boundary" term and
      // read as structured-clone cost, which is a completely different remedy.
      const queueMs =
        postedAtEpochMs === undefined
          ? 0
          : Math.max(0, nowEpochMs() - postedAtEpochMs);
      // THE HANDLER'S OWN WALL CLOCK, measured wholly inside the worker so the
      // page can derive the clone cost without needing a shared origin at all.
      const workerStart = nowMs();
      const snapshot = await pipeline.update(
        position,
        category,
        signal,
        radius,
        {
          includeCells: includeCells !== false,
          includeUnderground: includeUnderground === true,
        },
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
      // KEYED ON THE POSITION, NOT ON THE FRAME ORIGIN, and that is safe only
      // because of an invariant held on the page: the anchor advances ONLY in
      // the position subscriber, which drives this call and the terrain load
      // from the same value in the same tick (`scene-anchor.ts`'s holder). So
      // the held field cannot be in a different frame than this build without
      // the position having changed too, which this check already catches.
      //
      // If the anchor ever gains a second mover — an AR session adopting the
      // framework's `zero`, say — this has to key on the frame origin as well,
      // or a mesh will be built in one frame on ground sampled in another. That
      // is the exact defect round 5B removed, and it is silent.
      // STAGE 6, AND IT WAS NOT IN THE PLAN'S FIRST ENUMERATION. W3 runs the
      // terrain load concurrently with the fetch and the scoring, so this join
      // costs nothing when those are slow — and a fully cached refresh is
      // exactly when they are not, which is the corner where a concurrent load
      // turns into a visible wait on the click the owner is complaining about.
      // Zero on a category change or a widening ring, by design.
      const terrainStart = nowMs();
      // KEYED ON THE DATUM AS WELL AS THE POSITION. AR entry and AR exit both
      // change what the heights are measured from WITHOUT moving the user, so a
      // position-only check answered "no wait" on exactly the two transitions
      // where the held field is ~99 m out. The comment above predicted this
      // class of failure and named the frame origin; the datum got there first.
      const wantedField = { ...position, undulationM: geoidUndulationM };
      if (needsTerrainFor(terrainCentre, wantedField)) {
        await terrainGate.waitFor(wantedField, signal);
      }
      const terrainWaitMs = Math.max(0, nowMs() - terrainStart);
      // THE RING, AFTER the visible work (W8, DEC-R2-6). Queued here rather than
      // before the fetch loop because the user's own tile must never wait behind
      // a background one — the public instances allocate ~2 slots per client.
      // `replace` states the whole desired set, so moving away drops the tiles of
      // the place left behind, including the one in flight.
      // CLOCKED, though it is small and does not await. It is a TENTH thing
      // this handler does, and the whole finding behind this plan is that an
      // unenumerated step in this exact handler is what the residual exists to
      // catch. Naming it now costs one clock; leaving it costs milestone 5 a
      // session attributing a few stray milliseconds.
      const prefetchStart = nowMs();
      prefetch.replace(pipeline.neighbourTilesFor(position));
      const prefetchMs = Math.max(0, nowMs() - prefetchStart);
      // STAGE 7. `meshPlanner` decides full-build versus regions-only, so this
      // is legitimately near-zero on passes 2 and 3 — which is why every line
      // is tagged with its ring rather than summed per click.
      const meshStart = nowMs();
      const mesh = meshUpdateFor(snapshot, pipeline, frameOrigin ?? position);
      const meshMs = Math.max(0, nowMs() - meshStart);
      // WHAT THIS MESH IS STANDING ON (F1d). Recorded unconditionally, INCLUDING
      // when the planner decided against a full rebuild: the record answers
      // "which field is the geometry on screen sampled against", and a
      // regions-only pass leaves that geometry exactly where the previous full
      // build put it — on the field whose stamp is current now. Recording only
      // on a full build would leave a stale stamp here and make the terrain
      // handler signal a rebuild that is not needed.
      //
      // NO DATUM, unlike `terrainCentre` — see `MeshBuildRecord.centre`.
      lastMeshBuild = { centre: position, terrainStamp };
      return {
        snapshot,
        mesh,
        workerTimings: {
          terrainWaitMs,
          meshMs,
          prefetchMs,
          queueMs,
          workerTotalMs: Math.max(0, nowMs() - workerStart),
        },
      };
    }

    case "terrain": {
      const { centre, frameOrigin, extentM, spacingM, geoidUndulationM } =
        payload as WorkerCalls["terrain"]["request"];
      const { terrainField, demSourceId, demStats, demProvider } =
        requireState();
      try {
        return await loadTerrain(
          terrainField,
          demSourceId,
          demStats,
          () => demProvider.upgradesPending,
          centre,
          frameOrigin ?? centre,
          extentM,
          spacingM,
          geoidUndulationM,
          signal,
        );
      } finally {
        // IN A `finally`, and that is load-bearing. A mesh build waiting on this
        // centre is asking "is the terrain question resolved here?", not "is
        // there relief here?" — so a DEM outage, an abort and a success all
        // release it. Releasing only on success turns a failed tile into a
        // stalled mesh, which is the one outcome worse than flat ground.
        // WITH THE DATUM, or an AR-entry wait is released by the desktop field
        // that settled just before it — the same ~99 m mismatch the gate now
        // exists to catch, one layer down.
        terrainGate.settle({ ...centre, undulationM: geoidUndulationM });
      }
    }

    case "terrainUpgrade": {
      // WAITS FOR THE LOSER, then re-describes the window it has just improved.
      //
      // It does NOT start a load. `loadTerrain` would, and that load would
      // cancel the very in-flight request whose result this call exists to
      // collect — the reason this is a distinct kind rather than a second
      // `terrain` call.
      //
      // The reply is the same shape as `terrain`'s on purpose: the page's
      // existing handling, `meshOutdated` and the rebuild it triggers included,
      // is reused rather than written twice.
      const { centre, frameOrigin, extentM, spacingM, geoidUndulationM } =
        payload as WorkerCalls["terrainUpgrade"]["request"];
      const { terrainField, demSourceId, demStats, demProvider } =
        requireState();
      // Resolves immediately when nothing is pending, so a page that asks
      // speculatively — or twice — cannot hang.
      await demProvider.awaitUpgrades();

      // TWO GUARDS, BOTH ADDED AFTER THE MILESTONE REVIEW FOUND THIS HANDLER
      // WRITING STATE FOR A WINDOW THE USER HAD LEFT.
      //
      // This wait is long — bounded only by the preferred source's 30 s
      // deadline — and `describeCurrentTerrain` adopts its result as the
      // worker's current terrain unconditionally. Between the two, the user can
      // easily have walked somewhere else. Without these checks a superseded
      // upgrade overwrites `terrain` and `terrainCentre` with the OLD window,
      // including setting them empty if that window had no data — which is by
      // name the "older load writes last" interleaving this file's header says
      // holding the field worker-side prevents.
      //
      // The dispatcher suppresses the REPLY on abort but still runs the
      // handler, so the abort check has to be here rather than left to it.
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      // And the centre check catches the case an abort does not: a load that
      // completed normally for a different position while this was waiting.
      // `terrainCentre` is what the worker currently holds; if it has moved on,
      // this upgrade describes somewhere nobody is looking.
      if (
        terrainCentre === undefined ||
        terrainCentre.lat !== centre.lat ||
        terrainCentre.lng !== centre.lng
      ) {
        throw new DOMException("Terrain upgrade superseded", "AbortError");
      }
      return describeCurrentTerrain(
        terrainField,
        demSourceId,
        demStats,
        () => demProvider.upgradesPending,
        centre,
        frameOrigin ?? centre,
        extentM,
        spacingM,
        geoidUndulationM,
      );
    }

    case "cellMesh": {
      const request = payload as WorkerCalls["cellMesh"]["request"];
      // The SAME builder the main thread used, moved rather than reimplemented:
      // a second grid builder would be a second answer to "which cells are
      // drawn and what colour are they", which is the disagreement the shared
      // store exists to prevent.
      // THE SCENE'S ANCHOR, not the user's position. The grid is the fourth
      // thing built through `meshOptions` and the one missed when the frame was
      // fixed, so the cell overlay stayed anchored on the user while the
      // buildings underneath it did not — the two sliding apart by the walked
      // distance.
      const options = meshOptions(request.frameOrigin ?? request.centre);
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
          extrude: request.extrude === true,
          heightByScore: request.heightByScore === true,
          ...(options.groundHeightM === undefined
            ? {}
            : {
                heightAt: (point: { x: number; y: number }) =>
                  heightAtEnu(point),
              }),
        },
      );
    }

    case "geoEvent": {
      const { position, category, now, overlapMinutes } =
        payload as WorkerCalls["geoEvent"]["request"];
      const { pipeline } = requireState();
      // IT HAS TO RUN HERE. The index is private inside the pipeline inside this
      // worker, the climb reads it through SYNCHRONOUS callbacks that cannot
      // cross a structured clone, and the ensure step needs the same fetch
      // machinery `update` uses. Only the finished result goes back — the event
      // and, since W7, what finding it cost, which is measurable only in here.
      return pipeline.geoEvent(
        position,
        category,
        now,
        signal,
        // FORWARDED AS `undefined` WHEN ABSENT rather than defaulted here, so
        // the production default lives in exactly one place (`nextEventTime`).
        // A second default in the worker is how the picker's zero would quietly
        // become five again.
        overlapMinutes === undefined ? undefined : { overlapMinutes },
      );
    }

    case "planRoute": {
      const { from, to, frameOrigin } =
        payload as WorkerCalls["planRoute"]["request"];
      const { pipeline } = requireState();
      // KEYED ON THE FEATURE SET, not on the mesh build. `loadedTileCount`
      // documents itself as a faithful signature of the features — tiles are
      // only ever added — whereas `needsFullBuild`'s key also carries
      // `terrainStamp`, and terrain does not change what blocks an agent.
      const index = obstacleIndex.get(pipeline.loadedTileCount(), () =>
        pipeline.features().values(),
      );
      // THE SAME SAMPLER EVERY BUILDER READS, through the same cache, so the
      // ground the agent walks on and the ground the buildings stand on cannot
      // disagree. `fieldFor` returns `undefined` during a DEM outage, which
      // `groundHeightAtCell` turns into flat zero rather than into a refusal.
      return planRouteWithIndex(index, from, to, {
        frame: enuFrameAt(frameOrigin),
        field: fieldFor(terrain),
        // THE SCORE REACHES THE PLANNER HERE, AND NOWHERE ELSE (DEC-R13-1).
        // It is read from the same pipeline the `explain` handler reads, in the
        // same worker the route is already planned in, so **no new payload
        // crosses the boundary** — which is the whole reason stage 1 is a
        // one-file change rather than a protocol change.
        //
        // `walkable` BY NAME, not `snapshot.category` (DEC-R13-11): the demo
        // opens on `battleArea`, so reading the selected category would route
        // the shipped default by battle-area suitability.
        scoreFor: (cell) => walkableScoreOf(pipeline.scoreFor(cell)?.scores),
        // PATH-NESS, THE OTHER HALF OF "PREFER PATHS" (DEC-R2), read from the
        // same two maps the `explain` handler below already walks — the
        // provenance map for which features cover the cell, then the merged
        // feature map for their tags. No new payload, no new index.
        //
        // **It sees what the score cannot.** Scoring is multiplicative with zero
        // absorbing, so a footbridge sharing a res-13 cell with a river scores
        // exactly 0 and is indistinguishable from open water — while
        // `contributors` records a feature even when its factor is 0 or 1, so
        // the footway is still listed here.
        //
        // `undefined` rather than `false` for an unscored cell, so the planner
        // can tell "no way here" from "nobody looked": outside the scored disk
        // every cell is unknown, which prices uniformly and therefore changes no
        // route.
        onPathAt: (cell) => {
          const scored = pipeline.scoreFor(cell);
          if (scored === undefined) return undefined;
          const merged = pipeline.features();
          return Object.keys(scored.contributors[WALKABLE_CATEGORY] ?? {}).some(
            (key) => {
              const feature = merged.get(
                key as Parameters<typeof merged.get>[0],
              );
              return feature !== undefined && isPedestrianPath(feature);
            },
          );
        },
      });
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
  /** The provider's `sourceId`, reported back with the field it sampled. */
  demSourceId: string,
  /** Snapshots the provider's cumulative serving stats for this result. */
  demStats: () => RacingProviderStats,
  /**
   * How many DEM upgrades are still in flight, read AFTER the load.
   *
   * A function for the same reason `demStats` is: the count moves with every
   * batch, and this result must carry the value as of its own load.
   */
  upgradesPending: () => number,
  /** Where the user is. Keys the gate, and says which load this was. */
  centre: LatLng,
  /** Where the scene's frame is anchored. Says what the heights mean. */
  frameOrigin: LatLng,
  extentM: number,
  spacingM: number,
  /** Geoid undulation at the frame origin. AR only; absent means desktop. */
  geoidUndulationM: number | undefined,
  signal: AbortSignal,
): Promise<WorkerCalls["terrain"]["result"]> {
  // GROW the cache to cover the view, then RENDER a bounded grid from it.
  // The split is the whole point: the growth is incremental and permanent,
  // while what crosses the boundary stays a fixed-shape grid.
  //
  // WHERE that window sits, and in whose coordinates, is `terrain-window.ts`'s
  // decision — including why the radius is NOT a `sqrt(2)` margin (it cost
  // ~321 000 posts against a 250 000 cap when it was) and why the fetch centre
  // and the sample centre have to move together or not at all.
  const window = terrainWindowFor({ frameOrigin, centre, extentM });
  // THE SIGNAL GOES IN, not just checked on the way out. The check below is
  // what keeps a superseded load from being APPLIED; passing the signal is what
  // keeps it from being PAID FOR. Without it `ensureAround` reaches
  // `InFlightRequests` as an unsignalled caller, which pins the DEM request for
  // every joiner, so a walk across the map fetched every abandoned view to
  // completion (#270). `ensureAround` swallows the resulting `AbortError` into
  // "degrade to what is held", so the check still does its job.
  await terrainField.ensureAround(
    window.fetchCentre,
    window.fetchRadiusM,
    signal,
  );
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  // The mesh key reads this: a new field means the heights every builder samples
  // have changed, so the next pass must rebuild rather than re-send slabs (W6).
  //
  // BUMPED HERE AND NOT IN `describeCurrentTerrain`, because the upgrade path
  // shares that function and has already bumped — but only if its replacement
  // was actually applied. Bumping unconditionally there would report a refused
  // upgrade as a changed field and rebuild an identical mesh.
  terrainStamp += 1;
  return describeCurrentTerrain(
    terrainField,
    demSourceId,
    demStats,
    upgradesPending,
    centre,
    frameOrigin,
    extentM,
    spacingM,
    geoidUndulationM,
  );
}

/**
 * Builds a terrain reply from the field ALREADY held — no fetching, no
 * cancellation.
 *
 * Shared by `terrain` (after its load) and `terrainUpgrade` (after the DEM
 * race's loser has been applied), so the two replies cannot drift apart. That
 * shared shape is the point: the page's whole terrain path, including the
 * `meshOutdated` rebuild, works for an upgrade without knowing an upgrade
 * happened.
 *
 * Synchronous on purpose. Everything it touches is already in memory, and an
 * `await` in here would reopen the window the abort check above closes.
 */
function describeCurrentTerrain(
  terrainField: TerrainField,
  demSourceId: string,
  demStats: () => RacingProviderStats,
  upgradesPending: () => number,
  centre: LatLng,
  frameOrigin: LatLng,
  extentM: number,
  spacingM: number,
  geoidUndulationM: number | undefined,
): WorkerCalls["terrain"]["result"] {
  const window = terrainWindowFor({ frameOrigin, centre, extentM });
  const field = terrainField.sampleGrid({
    frame: window.frame,
    centreEnu: window.sampleCentreEnu,
    extentM,
    spacingM,
    // AR ONLY, and absent on every desktop request — see `geoidUndulationM` in
    // `protocol.ts`. Passing it switches the datum from the window centre to
    // `−N`, which is what makes the heights ellipsoidal and the datum fixed.
    ...(geoidUndulationM === undefined
      ? {}
      : { absoluteDatum: { undulationMetres: geoidUndulationM } }),
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
  // RECORDED EVEN WHEN THE FIELD IS EMPTY. This is what the mesh build's join
  // reads to decide whether it already has the terrain for its own position, and
  // "the DEM failed here" is an answer to that question. Recording it only on
  // success would make every later mesh build at this position wait out the
  // gate's full timeout.
  // THE DATUM TRAVELS WITH THE CENTRE. A field is identified by where it was
  // sampled AND by what its heights are measured from; recording only the
  // position is what let an AR-entry mesh build stand on the desktop field,
  // ~99 m out. See `GateCentre.undulationM`.
  terrainCentre = { ...centre, undulationM: geoidUndulationM };
  // DID THIS FIELD ARRIVE TOO LATE FOR THE MESH ALREADY ON SCREEN? (F1d.)
  //
  // Computed AFTER the stamp bump above, so `terrainStamp` is the value any
  // rebuild would use, and BEFORE the reply is built, so the page learns about
  // it on the same message that delivers the field. The alternative — an
  // unsolicited worker→page push — has no wire: the protocol is strictly
  // request/reply keyed on `id` and `isWorkerReply` rejects anything without
  // one, so a new envelope type would be real protocol surface for a boolean.
  const meshOutdated = meshOutdatedByTerrain(lastMeshBuild, {
    centre,
    terrainStamp,
    updatesInFlight,
  });
  return {
    field: terrain,
    note: describeTerrain(field),
    demSourceId,
    meshOutdated,
    // READ AFTER THE LOAD, so it reflects upgrades this batch registered. The
    // page uses it to decide whether to issue `terrainUpgrade`; reading it
    // before the sampling would always report the previous load's state and
    // the very first field — the one that matters most, on a cold start —
    // would never be upgraded.
    upgradePending: upgradesPending() > 0,
    meanFilledPosts: terrainField.meanFilledCount,
    // SNAPSHOT AT RESULT TIME, after the sampling above, so the counts include
    // this load's own batches. Cumulative for the session — the HUD reports a
    // share, and a share needs the denominator to keep meaning something.
    demStats: demStats(),
    // REPORTED EVEN WHEN THE FIELD IS EMPTY, and that is the point: the ground
    // plane follows this centre, and a plane left behind during a DEM outage
    // stops covering the user as soon as they walk past its extent.
    centreEnu: window.sampleCentreEnu,
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
      // `colors` IS DELIBERATELY ABSENT, and the omission is not the oversight
      // it looks like. Adding it on 2026-08-16 turned the demo's e2e suite red
      // — so something downstream re-reads that buffer after the post, and
      // transferring it detaches the worker's copy. Reverted rather than chased,
      // and filed; the comment above is about buffers that are safe to move.
      //
      // The two shell attributes ARE transferred: they are new, and nothing but
      // the AR material reads them. The optional entries rely on the
      // `instanceof` filter below to drop `undefined`.
      chunk.height01?.buffer,
      chunk.featureRand?.buffer,
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

  // COUNTED HERE RATHER THAN INSIDE THE HANDLER (F1d). The `terrain` handler
  // asks "is an update already going to rebuild the mesh?" before it signals a
  // late arrival, and the honest answer spans the whole dispatch — a handler
  // that has returned but whose reply has not been posted is still going to
  // produce a rebuild. Counting at this seam gets that for free from the
  // `.finally` below, and needs no try/finally threaded through a handler whose
  // only exit is a `return` sixty lines down.
  if (kind === "update") updatesInFlight += 1;

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
      // In the `finally`, so an aborted or throwing update still releases the
      // count. A counter that leaked upwards would silence the late-terrain
      // rebuild for the rest of the session — a failure that looks exactly like
      // the bug it was added to fix.
      if (kind === "update") updatesInFlight -= 1;
      inFlight.delete(id);
    });
});
