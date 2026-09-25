/**
 * Desktop-preview-only OSM building + road layer.
 *
 * Fetches real OSM buildings and roads once around a fixed origin and draws
 * them onto the desktop preview's flat ground — see
 * `plans/2026-08-27-desktop-preview-osm-buildings-plan.md`. Deliberately NOT
 * the incremental, terrain-aware pipeline `GpsPlusSlamJs_OsmDemo` runs: a
 * tour's preview area is small and known up front, so one bounded fetch is
 * enough and there is no worker, no terrain lattice, and no re-fetch as the
 * visitor walks.
 *
 * Never used by the real AR/phone viewing path — importing this file (and
 * therefore `gps-plus-slam-osm` + `h3-js`) outside `desktop-preview/` is
 * blocked by the dependency-cruiser boundary rule.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
} from "three";
import {
  OverpassSource,
  FETCH_RES,
  loadTiles,
  enuFrameAt,
  buildBuildings,
  buildRoads,
  buildAreaPlates,
  cellToBoundingBox,
  featureKey,
  DEFAULT_ROAD_RGB,
  type BoundingBox,
  type MeshData,
  type OsmDataSource,
  type OsmFeature,
} from "gps-plus-slam-osm";
import { latLngToCell } from "h3-js";
import { disposeObject3D } from "gps-plus-slam-app-framework/visualization/three-dispose";

/** Plain building tone — matches the preview's "cheap and plain" look. */
const BUILDING_RGB = 0xb9b3a6;

/**
 * Ground plates — parks, car parks, plazas, water, landuse — one flat tone
 * for all of them, same reasoning as `BUILDING_RGB`/`DEFAULT_ROAD_RGB`: no
 * per-feature colouring yet. Chosen distinct from both the green ground
 * plane (0x6f8f5e, `preview-session.ts`) and the building tone above, so
 * real parcels read as texture breaking up the plain green rather than
 * blending into either.
 */
const PLATE_RGB = 0x9a9184;

/**
 * Plates drape at y=0 by default (same as roads/buildings) unless given a
 * `groundHeightM`, and roads/buildings ALSO sit at y=0 — coincident geometry
 * z-fights wherever a landuse polygon (e.g. a whole residential block)
 * underlies a road or building footprint. Lifting plates 1cm below that
 * baseline, and the ground plane itself 1cm below the plates
 * (`preview-session.ts`'s `ground.position.y = -0.02`), stacks the three
 * layers with enough separation to never be coplanar, without the
 * `renderOrder` machinery `GpsPlusSlamJs_OsmDemo` needs for its much larger,
 * terrain-draped scene.
 */
const PLATE_Y_OFFSET_M = -0.01;

/**
 * `gps-plus-slam-osm` is deliberately three.js-free (plan §4.2) — it hands
 * back raw `Float32Array`/`Uint32Array` buffers (`MeshData`) and stops. This
 * is the "three lines that turn those buffers into a mesh" the package's own
 * docs say belong in the consumer (see `GpsPlusSlamJs_OsmDemo/src/mesh-layers.ts`).
 * Shared by buildings and roads: both `BuildingVolume` and `RoadRibbon` carry
 * a `mesh: MeshData` in the same positions/normals/indices shape.
 */
/**
 * One `FETCH_RES` tile per point that needs covering (the origin plus every
 * `route` point), deduped by cell id — see `load()`'s comment for why this
 * replaces a fixed-radius disk around the origin alone.
 */
function tilesToFetch(
  origin: { readonly lat: number; readonly lng: number },
  route: readonly { readonly lat: number; readonly lon: number }[],
): string[] {
  const cellIds = new Set<string>([
    latLngToCell(origin.lat, origin.lng, FETCH_RES),
  ]);
  for (const point of route) {
    cellIds.add(latLngToCell(point.lat, point.lon, FETCH_RES));
  }
  return [...cellIds];
}

/**
 * Adjacent tiles' fetch bboxes overlap on purpose (`cellToBoundingBox`'s
 * doc), so a feature straddling two tiles comes back once per tile fetched.
 * Dedup by OSM id before building meshes — otherwise it would be
 * extruded/ribboned/plated once per tile, overlapping itself.
 */
function dedupeFeatures(
  results: readonly { readonly features: readonly OsmFeature[] }[],
): OsmFeature[] {
  const seen = new Set<string>();
  const features: OsmFeature[] = [];
  for (const result of results) {
    for (const feature of result.features) {
      const key = featureKey(feature);
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(feature);
    }
  }
  return features;
}

/** Smallest bbox containing every input bbox. `boxes` is always non-empty here (at least the origin's own tile). */
function unionBoundingBoxes(boxes: readonly BoundingBox[]): BoundingBox {
  return boxes.reduce((acc, box) => ({
    south: Math.min(acc.south, box.south),
    west: Math.min(acc.west, box.west),
    north: Math.max(acc.north, box.north),
    east: Math.max(acc.east, box.east),
  }));
}

function toMesh(meshData: MeshData, color: number): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(meshData.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(meshData.normals, 3));
  geometry.setIndex(new BufferAttribute(meshData.indices, 1));
  // A single plain material per layer — no per-feature colouring yet.
  const material = new MeshLambertMaterial({ color });
  return new Mesh(geometry, material);
}

/**
 * Turns a load run's raw features into meshes and adds them to `group` —
 * buildings, roads and ground plates, all free passes over the same fetch
 * (no extra Overpass request). Split out of `runLoad` purely to keep that
 * function's branching (status transitions, staleness checks) readable on
 * its own.
 */
function populateGroup(
  group: Group,
  features: readonly OsmFeature[],
  origin: { readonly lat: number; readonly lng: number },
  clipTo: BoundingBox,
): void {
  const frame = enuFrameAt(origin);
  for (const volume of buildBuildings(features, { frame })) {
    group.add(toMesh(volume.mesh, BUILDING_RGB));
  }
  for (const road of buildRoads(features, { frame })) {
    group.add(toMesh(road.mesh, DEFAULT_ROAD_RGB));
  }
  // `clipTo` is the union bbox of every tile actually fetched: triangulation
  // is O(n²) in ring size (plates.ts), and clipping to what was fetched keeps
  // a landuse polygon that extends beyond it from costing more than the
  // fetched tiles' worth.
  for (const plate of buildAreaPlates(features, {
    frame,
    groundHeightM: () => PLATE_Y_OFFSET_M,
    clipTo,
  })) {
    group.add(toMesh(plate.mesh, PLATE_RGB));
  }
}

/**
 * The GUARANTEE around the origin, not a fetch parameter (see `load()`'s
 * comment on why a radius-driven multi-tile disk fetch was dropped,
 * 2026-08-28). A single `FETCH_RES` (7) H3 tile has a ~1406 m edge (h3-js
 * `getHexagonEdgeLengthAvg(7, "m")`), so fetching just the tile that
 * contains the origin already covers at least this radius on every side —
 * comfortably, since 1406 m >> 300 m. Kept as a named, tested constant so
 * that guarantee stays visible and machine-checked rather than an
 * unexplained "one tile is enough" assumption.
 *
 * This is a floor, not a ceiling: `load()` also fetches one tile per
 * `options.route` point (deduped), so a tour whose breadcrumb/walk actually
 * extends past this radius — a real hexagon is not a circle, and a tour is
 * not always short and centred on its own origin — still gets buildings
 * along its whole length, not just near the start (2026-08-28, "range too
 * small" — a ~950m route with two turns walked out of the origin's own
 * tile).
 */
export const DEFAULT_OSM_BUILDING_RADIUS_M = 300;

/**
 * `DEFAULT_OSM_BUILDING_RADIUS_M` spans multiple fetch tiles (7 for the
 * default 300m around a real origin), and `area-loader.ts`'s `loadTiles`
 * fetches them SEQUENTIALLY on purpose (dedup/rate-limit reasoning lives
 * there), not the single-tile latency the original 20s figure was based on.
 * Measured against live Overpass (Munich, 300m, 2026-08-28): 7/7 tiles
 * succeeded, zero retries, zero rate-limiting, in 86s total — so a 20s
 * timeout aborted every real load before it could finish, which is what
 * "buildings never appear" actually was. 120s comfortably covers that
 * measurement with headroom; a walkable preview still starts immediately
 * either way (buildings pop in later, or don't) — only the odds of them
 * appearing at all changes.
 */
export const DEFAULT_OSM_BUILDING_TIMEOUT_MS = 120_000;

const OSM_BUILDING_USER_AGENT =
  "gps-plus-slam-tour-builder-desktop-preview (github.com/cs-util-com/location-based-webxr)";

export type OsmBuildingStatus =
  | "idle" // enabled, load() not called yet
  | "loading"
  | "loaded"
  | "failed"
  | "off";

export interface OsmBuildingLayerOptions {
  /** The tour's origin. TourBuilder's own `lat`/`lon` shape (not `lng`). */
  readonly origin: { readonly lat: number; readonly lon: number };
  /**
   * Extra points the fetch must also cover — typically the tour's breadcrumb
   * (`PreviewSessionOptions.route`). Each point contributes its own
   * `FETCH_RES` tile (deduped against the origin's and each other's); a
   * short tour centred on its origin adds nothing beyond the single-tile
   * floor above, a long or bendy one gets as many tiles as it actually
   * spans. Omitted/empty ⇒ unchanged single-tile behaviour.
   */
  readonly route?: readonly { readonly lat: number; readonly lon: number }[];
  readonly timeoutMs?: number;
  /** Test seam. Defaults to a real `OverpassSource`. */
  readonly source?: OsmDataSource;
  /** Per-session on/off toggle. Default `true`. */
  readonly enabled?: boolean;
}

export interface OsmBuildingLayer {
  /** Added to the scene immediately; stays empty until `load()` populates it. */
  readonly group: Group;
  /**
   * Fetches and extrudes buildings once. Never rejects: any failure, empty
   * area, or timeout leaves `group` exactly as it was (empty, unless already
   * populated by a prior call). Starts a load only from `"idle"`; from any
   * other status it resolves immediately without fetching.
   */
  load(): Promise<void>;
  /** Aborts an in-flight load, disposes GPU resources, clears the group. */
  dispose(): void;
  getStatus(): OsmBuildingStatus;
  /**
   * Fires on every subsequent status transition only — no replay of the
   * current status on subscribe. Returns an unsubscribe function.
   */
  onStatusChange(callback: (status: OsmBuildingStatus) => void): () => void;
  /**
   * `false` aborts any in-flight run; a completed load is hidden (not
   * disposed/re-fetched) so a later `true` is instant. Only a run that never
   * finished — `"idle"`/an aborted `"loading"` — has nothing to hide and gets
   * disposed the same as before.
   * `true` from `"off"` re-shows a hidden load with no fetch, or starts one
   * if nothing was cached; from `"failed"` it always starts a fresh load
   * (the retry path). From `"idle"`/`"loading"`/`"loaded"` it is a no-op.
   */
  setEnabled(enabled: boolean): void;
}

export function createOsmBuildingLayer(
  options: OsmBuildingLayerOptions,
): OsmBuildingLayer {
  const group = new Group();
  group.name = "osm-buildings";
  // `gps-plus-slam-osm`'s mesh output is FIXED to +x=east, -z=north
  // (mesh-data.ts's MeshData doc) — a different convention from this app's
  // own AR-world axes (x=north, z=east; preview-frame.ts), which is what
  // every waypoint, the route, the camera and the 2D map are placed in.
  // Left uncorrected, buildings/roads render 90° off from the tour's own
  // content. Rotating the whole group -90° around Y maps OSM's (east,
  // -north) onto this app's (north, east) — verified: a building 100m due
  // east in OSM's frame lands at world (x=0, z=100) after this, matching
  // where the tour's own frame would place a point 100m east of the origin.
  group.rotation.y = -Math.PI / 2;

  const timeoutMs = options.timeoutMs ?? DEFAULT_OSM_BUILDING_TIMEOUT_MS;
  const source =
    options.source ??
    new OverpassSource({ userAgent: OSM_BUILDING_USER_AGENT });
  // gps-plus-slam-osm uses `lng` (matching h3-js); TourBuilder uses `lon`
  // (contract D5) — the only place the two vocabularies meet.
  const origin = { lat: options.origin.lat, lng: options.origin.lon };

  let disposed = false;
  // Bumped by every dispose(), setEnabled(false) and new load run — the run
  // that captured the current value at start is "stale" once this moves on,
  // and a stale run's late settlement must add no meshes and emit no status.
  let generation = 0;
  let currentController: AbortController | null = null;
  let status: OsmBuildingStatus = (options.enabled ?? true) ? "idle" : "off";
  // Set once `runLoad` finishes populating `group`; lets `setEnabled(false)`
  // hide instead of dispose, so toggling back on is instant with no re-fetch.
  let hasCachedData = false;
  const listeners = new Set<(status: OsmBuildingStatus) => void>();

  function setStatus(next: OsmBuildingStatus): void {
    if (status === next) return;
    status = next;
    for (const listener of [...listeners]) listener(next);
  }

  /** A run superseded by a newer one, `setEnabled(false)`, or `dispose()`. */
  function isStale(token: number): boolean {
    return token !== generation || disposed;
  }

  /** Shared by `load()` and `setEnabled(true)` — see the module's plan doc. */
  async function runLoad(): Promise<void> {
    const token = ++generation;
    // A previous run that failed part-way, or a partial load, may have left
    // meshes behind; a retry must not stack a second copy on top.
    disposeObject3D(group);
    group.clear();
    const controller = new AbortController();
    currentController = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    setStatus("loading");
    try {
      // Deliberately NOT ensureAreaLoaded(origin, radiusM, ...): that always
      // rounds any non-zero radius up to a full 1-ring (7-tile) disk around
      // the ORIGIN alone (`tilesWithin`'s `Math.ceil`) — expensive even for a
      // short tour, and still blind to a tour that walks out of that disk
      // anyway. Fetching exactly the tiles the route touches scales with the
      // tour's actual size/shape instead of a fixed guess in either
      // direction.
      const tiles = tilesToFetch(origin, options.route ?? []);
      const { loaded, deferred, failed } = await loadTiles(source, tiles, {
        signal: controller.signal,
      });
      if (isStale(token)) return;

      // Nothing arrived and at least one tile errored — an outage, not an
      // empty area.
      if (loaded.length === 0 && failed.length + deferred.length > 0) {
        setStatus("failed");
        return;
      }

      const features = dedupeFeatures(loaded);
      populateGroup(
        group,
        features,
        origin,
        unionBoundingBoxes(tiles.map(cellToBoundingBox)),
      );

      if (failed.length + deferred.length > 0) {
        // Partial coverage beats flat ground, but the gap is still a
        // dev-facing signal.
        // eslint-disable-next-line no-console
        console.warn("[desktop-preview] OSM building load partially failed.", {
          failed,
          deferred,
        });
      }
      hasCachedData = true;
      setStatus("loaded");
    } catch (error) {
      if (isStale(token)) return;
      // Fail soft, always — see the module doc. A slow/down Overpass
      // instance both just means the flat plane stays flat; this is the one
      // abort that counts as a failure (an abort we caused ourselves, via
      // setEnabled(false) or dispose(), makes the run stale before this
      // point, so it never reaches here).
      // eslint-disable-next-line no-console
      console.warn(
        "[desktop-preview] OSM building load failed; showing flat ground.",
        error,
      );
      setStatus("failed");
    } finally {
      clearTimeout(timer);
      if (token === generation) currentController = null;
    }
  }

  async function load(): Promise<void> {
    if (status !== "idle") return;
    await runLoad();
  }

  function setEnabled(enabled: boolean): void {
    if (enabled) {
      if (status === "off" && hasCachedData) {
        // A completed load was only hidden, not disposed — show it again
        // with no fetch.
        group.visible = true;
        setStatus("loaded");
        return;
      }
      // "off" with nothing cached, or "failed": (re)fetch.
      if (status === "off" || status === "failed") {
        void runLoad();
      }
      // idle/loading/loaded: no second fetch, no duplicate meshes.
      return;
    }
    if (status === "off") return;
    generation += 1; // stales any in-flight run
    currentController?.abort();
    currentController = null;
    if (hasCachedData) {
      // Keep the meshes around (and their GPU resources) so the next
      // setEnabled(true) is instant instead of re-fetching from Overpass.
      group.visible = false;
    } else {
      // Nothing finished loading yet (idle, or a run aborted mid-flight) —
      // there is nothing worth caching.
      disposeObject3D(group);
      group.clear();
    }
    setStatus("off");
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    generation += 1;
    currentController?.abort();
    currentController = null;
    disposeObject3D(group);
    group.clear();
    hasCachedData = false;
    // Leaving the preview must never trigger a "couldn't load" notice on a
    // HUD that is being torn down — dispose() is silent.
    listeners.clear();
  }

  return {
    group,
    load,
    dispose,
    getStatus: () => status,
    onStatusChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    setEnabled,
  };
}
