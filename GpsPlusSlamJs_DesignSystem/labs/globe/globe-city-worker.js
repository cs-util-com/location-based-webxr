/**
 * The globe's city, built off the main thread from the Osm library's public
 * API only (globe city plan 2026-10-05-0040 §14, the owner's D-K5: the city
 * validates that the library serves a second app as it serves OsmDemo).
 *
 * Loaded through the design system's worker view (`/w/`, serve-routes.mjs),
 * because the library's modules import packages by name and import maps do
 * not apply inside a worker.
 *
 * One request at a time: `{ kind: "build", id, target }`. The reply is
 * `{ id, ok: true, buildings, trees, counts, groundM }` with the buildings'
 * typed arrays transferred, or `{ id, ok: false, message }`. Steps:
 *
 * - the OSM tiles of the target's working set, from the persistent store the
 *   arrival prefetch warms (the same OPFS directory, so a warmed city reads
 *   no network), merged into one feature set;
 * - the heights from the relief's own source and zoom (AWS Terrarium, z12),
 *   so the city stands on the numbers the relief draws (§12.4 R13), sampled
 *   absolutely with the geoid at 0: heights above the ellipsoid, the relief's
 *   convention (§12.1);
 * - `buildCity` within the terrain window (R12), on that field. Nothing is
 *   built without a field (R3): a city on the ellipsoid would stand hundreds
 *   of metres underground.
 *
 * @see globe-city-worker.js.md
 */
import {
  CachingSource,
  MemoryBlobStore,
  OverpassSource,
  TERRAIN_EXTENT_M,
  TERRARIUM_URL_TEMPLATE,
  TerrariumProvider,
  browserPngDecoder,
  buildCity,
  cityGround,
  createCachingTileFetch,
  createTerrainField,
  enuFrameAt,
  ensureWorkingSetLoaded,
  heightfieldFrom,
  mergeTiles,
  terrainWindowFor,
} from "gps-plus-slam-osm";
import { openPersistentOsmStore } from "gps-plus-slam-app-framework/osm-bridge";

/** How the globe identifies itself to the Overpass operators. */
const USER_AGENT = "gps-plus-slam-globe (github.com/cs-util-com)";

/** The relief's Terrarium zoom (`globe-terrain.ts`, `maxZoom` 12). */
const RELIEF_ZOOM = 12;

/** Metres between height posts: about the z12 pixel at mid latitudes. */
const SPACING_M = 24;

let store;

async function buildFor(target) {
  store ??= (await openPersistentOsmStore()) ?? new MemoryBlobStore();
  const source = new CachingSource(
    new OverpassSource({ userAgent: USER_AGENT }),
    store,
  );
  const area = await ensureWorkingSetLoaded(source, target);
  const features = [...mergeTiles(area.loaded).features.values()];

  const frame = enuFrameAt(target);
  const field = createTerrainField({
    provider: new TerrariumProvider({
      decodePng: browserPngDecoder(),
      fetchImpl: createCachingTileFetch({ store }),
      urlTemplate: TERRARIUM_URL_TEMPLATE,
      zoom: RELIEF_ZOOM,
    }),
    zoom: RELIEF_ZOOM,
  });
  const window = terrainWindowFor({
    frameOrigin: target,
    centre: target,
    extentM: TERRAIN_EXTENT_M,
  });
  await field.ensureAround(window.fetchCentre, window.fetchRadiusM);
  const heights = field.sampleGrid({
    frame,
    extentM: TERRAIN_EXTENT_M,
    spacingM: SPACING_M,
    centreEnu: window.sampleCentreEnu,
    absoluteDatum: { undulationMetres: 0 },
  });
  if (!heights.hasData) {
    throw new Error("no heights for the city's window (nothing is built)");
  }
  const heightfield = heightfieldFrom(heights);
  const city = buildCity(features, cityGround(frame, heightfield), {
    withinM: TERRAIN_EXTENT_M,
  });
  return {
    buildings: city.buildings,
    trees: city.trees,
    counts: {
      features: features.length,
      tiles: area.loaded.length,
      deferred: area.deferred.length,
      failed: area.failed.length,
      volumes: city.volumes.length,
      barriers: city.barriers.length,
      trees: city.trees.length,
    },
    groundM: heightfield.heightAt({ x: 0, y: 0 }),
  };
}

/** The buffers a reply hands over rather than copies (built per request). */
function transferables(buildings) {
  const out = [];
  for (const chunk of buildings) {
    const m = chunk.mesh;
    out.push(m.positions.buffer, m.normals.buffer, m.indices.buffer);
    for (const a of [chunk.colors, chunk.height01, chunk.featureRand]) {
      if (a !== undefined) out.push(a.buffer);
    }
  }
  return [...new Set(out)];
}

self.addEventListener("message", async (event) => {
  const { kind, id, target } = event.data ?? {};
  if (kind !== "build") return;
  try {
    if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
      throw new RangeError(`a city needs a finite target, got ${target}`);
    }
    const result = await buildFor(target);
    self.postMessage(
      { id, ok: true, ...result },
      transferables(result.buildings),
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      message: String(error?.message ?? error),
    });
  }
});
