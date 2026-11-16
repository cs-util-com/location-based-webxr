/**
 * The globe editor's city worker: the Globe package's worker core
 * (`gps-plus-slam-globe/city-worker`) wired to the Osm library and to the
 * browser's tile store. All logic lives in the core; this file only hands it
 * the library, the store, the project's tile host and the worker's
 * `postMessage`.
 *
 * Vite bundles this module when it is referenced as
 * `new Worker(new URL("./globe-city-worker.ts", import.meta.url), { type: "module" })`
 * (`editor3d-globe.ts`). The data parse (a cold tile is tens of MB of JSON)
 * and the city's build run here, never on the page's main thread.
 *
 * @see globe-city-worker.ts.md
 */
import { openPersistentOsmStore } from "gps-plus-slam-app-framework/osm-bridge";
import { createCityWorkerCore } from "gps-plus-slam-globe/city-worker";
import {
  MemoryBlobStore,
  OSM_TILES_BASE_URL,
  TERRAIN_EXTENT_M,
  TERRARIUM_URL_TEMPLATE,
  browserPngDecoder,
  buildCity,
  cityDataPlan,
  createCachingTileFetch,
  createCityTileSource,
  loadCityData,
} from "gps-plus-slam-osm";

/** How the editor identifies itself to the Overpass operators. */
export const CITY_WORKER_USER_AGENT =
  "gps-plus-slam-tour-editor (github.com/cs-util-com)";

// `self` in a module worker is the DedicatedWorkerGlobalScope; type just the
// surface used so the file needs no WebWorker lib in the app tsconfig.
const ctx = self as unknown as {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage: (message: unknown, transfer: ArrayBufferLike[]) => void;
};

const core = createCityWorkerCore({
  post: (message, transfer) => {
    ctx.postMessage(message, transfer);
  },
  openStore: async () =>
    (await openPersistentOsmStore()) ?? new MemoryBlobStore(),
  osm: {
    TERRAIN_EXTENT_M,
    TERRARIUM_URL_TEMPLATE,
    cityDataPlan,
    createCityTileSource,
    createCachingTileFetch,
    browserPngDecoder,
    loadCityData,
    buildCity,
  },
  userAgent: CITY_WORKER_USER_AGENT,
  // The project's tile host first (the library's `StaticTileSource`), as
  // OsmDemo does: a 404 asks for a fill, waited for up to 60 s when nothing
  // is queued ahead; a refusal or an error hands the tile to the Overpass
  // race at once. Always on: the sidecar says why there is no switch.
  staticTilesBaseUrl: OSM_TILES_BASE_URL,
});

ctx.onmessage = (event): void => {
  core.handle(event.data);
};
