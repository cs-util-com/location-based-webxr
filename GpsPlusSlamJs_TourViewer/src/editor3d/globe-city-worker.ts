/**
 * The globe editor's city worker: the Globe package's worker core
 * (`gps-plus-slam-globe/city-worker`) wired to the Osm library and to the
 * browser's tile store. All logic lives in the core; this file only hands it
 * the library, the store and the worker's `postMessage`.
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
});

ctx.onmessage = (event): void => {
  core.handle(event.data);
};
