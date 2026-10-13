/**
 * The globe's city, loaded and built off the main thread from the Osm
 * library's public API only (globe city plan 2026-10-05-0040 §14, the
 * owner's D-K5: the city validates that the library serves a second app as
 * it serves OsmDemo).
 *
 * Loaded through the design system's worker view (`/w/`, serve-routes.mjs),
 * because the library's modules import packages by name and import maps do
 * not apply inside a worker.
 *
 * ONE LOAD AT A TIME (round-4 plan 2026-10-11-0122 §5): `{ kind: "load", id,
 * target, zoom }` starts the library's `loadCityData` for the place, on the
 * library's `cityDataPlan` with the relief's own heights (Terrarium at the
 * relief's zoom, R13), so the warm-up and the build are ONE load and read
 * the same tiles and heights by construction (validation finding F6). A new
 * load, or `{ kind: "abort", id }`, stops the one before. Replies, each
 * carrying its `id`:
 *
 * - `{ kind: "progress", counts, progress, landing }` after each settled
 *   job (`landing` the library's `landingProgress`: the first delivery's
 *   jobs only, what the flight paces on, DEC-AW-1);
 * - `{ kind: "city", ok: true, stage, buildings, trees, roads, counts,
 *   groundM }` after the first ring, after every ring and after a retry
 *   that brought something new (`buildCity` on the delivered features and
 *   ground, within the terrain window, R12), the buildings' and roads'
 *   typed arrays transferred;
 * - `{ kind: "settled", outcome, counts, ... }` once every job was tried
 *   once (the library's `firstPass`: what a flight waits for, before any
 *   retry);
 * - `{ kind: "finished", outcome, counts, missingTiles, missingHeights,
 *   elapsedMs }` once, after the retries, and `{ kind: "city", ok: false, message }` before it
 *   when the load ended without a city (a height still missing after the
 *   retries: no city stands on invented heights, R3).
 *
 * The data parse (a cold res-7 tile is about 21 MB of JSON) runs here, never
 * on the page's main thread (the frame rule).
 *
 * @see globe-city-worker.js.md
 */
import {
  MemoryBlobStore,
  TERRAIN_EXTENT_M,
  TERRARIUM_URL_TEMPLATE,
  browserPngDecoder,
  buildCity,
  cityDataPlan,
  createCachingTileFetch,
  createCityTileSource,
  loadCityData,
} from "gps-plus-slam-osm";
import { openPersistentOsmStore } from "gps-plus-slam-app-framework/osm-bridge";

/** How the globe identifies itself to the Overpass operators. */
const USER_AGENT = "gps-plus-slam-globe (github.com/cs-util-com)";

let store;
let current = null;

/** The relief's heights: its own source at its zoom (R13). */
const reliefHeights = (zoom) => ({
  urlTemplates: [TERRARIUM_URL_TEMPLATE],
  zoom,
});

/** The buffers a reply hands over rather than copies (built per request). */
function transferables(chunks) {
  const out = [];
  for (const chunk of chunks) {
    const m = chunk.mesh;
    out.push(m.positions.buffer, m.normals.buffer, m.indices.buffer);
    for (const a of [chunk.colors, chunk.height01, chunk.featureRand]) {
      if (a !== undefined) out.push(a.buffer);
    }
  }
  return [...new Set(out)];
}

function validate(target, zoom) {
  if (!(Number.isFinite(target?.lat) && Number.isFinite(target?.lng))) {
    throw new RangeError(`a city needs a finite target, got ${target}`);
  }
  if (!(Number.isInteger(zoom) && zoom >= 1 && zoom <= 15)) {
    throw new RangeError(`a city needs the relief's zoom (1-15), got ${zoom}`);
  }
}

async function start(id, target, zoom, firstRings) {
  store ??= (await openPersistentOsmStore()) ?? new MemoryBlobStore();
  if (current?.id !== id) return; // superseded while the store opened
  const plan = cityDataPlan(target, { heights: reliefHeights(zoom) });
  let built = false;
  const load = loadCityData(plan, {
    source: createCityTileSource(store, { userAgent: USER_AGENT }),
    heightFetch: createCachingTileFetch({ store }),
    decodePng: browserPngDecoder(),
    firstRings,
    onProgress: (counts, progress, landing) =>
      self.postMessage({ id, kind: "progress", counts, progress, landing }),
    onData: (data) => {
      const startedAt = performance.now();
      const city = buildCity(data.features, data.ground, {
        withinM: TERRAIN_EXTENT_M,
        roads: true,
      });
      built = true;
      self.postMessage(
        {
          id,
          kind: "city",
          ok: true,
          stage: data.stage,
          buildings: city.buildings,
          trees: city.trees,
          roads: city.roads,
          counts: {
            features: data.features.length,
            tiles: data.tiles.loaded,
            missingTiles: data.tiles.missing.length,
            volumes: city.volumes.length,
            barriers: city.barriers.length,
            trees: city.trees.length,
            roads: city.roadCount,
            buildMs: Math.round(performance.now() - startedAt),
          },
          groundM: data.groundM,
        },
        transferables([...city.buildings, ...city.roads]),
      );
    },
  });
  current.load = load;
  void load.firstPass.then((pass) => {
    if (current?.id === id) self.postMessage({ id, kind: "settled", ...pass });
  });
  const report = await load.finished;
  if (current?.id !== id) return;
  if (!built && report.outcome === "settled") {
    self.postMessage({
      id,
      kind: "city",
      ok: false,
      message:
        report.missingHeights > 0
          ? `${report.missingHeights} heights missing for the city's window (nothing is built)`
          : `no city data arrived (${report.missingTiles.length} tiles missing)`,
    });
  }
  self.postMessage({ id, kind: "finished", ...report });
}

self.addEventListener("message", (event) => {
  const { kind, id, target, zoom, firstRings } = event.data ?? {};
  if (kind === "abort") {
    if (current?.id === id) {
      current.load?.abort();
      current = null;
    }
    return;
  }
  if (kind !== "load") return;
  current?.load?.abort();
  current = { id, load: null };
  try {
    validate(target, zoom);
  } catch (error) {
    self.postMessage({ id, kind: "city", ok: false, message: String(error) });
    self.postMessage({ id, kind: "finished", outcome: "invalid-target" });
    return;
  }
  start(id, target, zoom, firstRings ?? 1).catch((error) => {
    self.postMessage({
      id,
      kind: "city",
      ok: false,
      message: String(error?.message ?? error),
    });
    self.postMessage({ id, kind: "finished", outcome: "settled" });
  });
});
