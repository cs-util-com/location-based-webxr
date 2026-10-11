/**
 * The OSM tile cache's store and source for OsmDemo's worker, built in ONE
 * place. The source is the Osm library's `createCityTileSource` with the
 * demo's user agent: the globe's city loads through the same construction
 * (round-4 plan 2026-10-11-0122 §5), the same OPFS directory and cache key,
 * so the two apps cannot drift apart in how they fetch a tile. (The globe's
 * arrival prefetch wrote this cache too, round-5 plan 2026-10-01-0945 §3.6,
 * until its loading moved into the library.)
 *
 * @see osm-tile-cache.ts.md
 */

import {
  MemoryBlobStore,
  createCityTileSource,
  type CachingSource,
  type OsmBlobStore,
} from "gps-plus-slam-osm";
import {
  openPersistentOsmStore,
  type OpenOsmStoreOptions,
} from "gps-plus-slam-app-framework/osm-bridge";

/** How the demo identifies itself to the Overpass operators. */
export const OSM_DEMO_USER_AGENT =
  "gps-plus-slam-osm-demo (github.com/cs-util-com)";

/**
 * The worker's store: OPFS where available, memory otherwise.
 *
 * OPFS is the point - a cached res-7 tile is tens of MB and refetching it on
 * every reload would be an abuse of donated infrastructure. But the demo must
 * still run in a browser without it rather than refusing to start.
 */
export async function openOsmStore(
  options: OpenOsmStoreOptions = {},
): Promise<OsmBlobStore> {
  return (await openPersistentOsmStore(options)) ?? new MemoryBlobStore();
}

/**
 * The demo's Overpass source behind its cache: what every OsmDemo tile
 * fetch, foreground or ring prefetch, goes through.
 * `fetchImpl` is the network seam (tests; defaults to the global fetch).
 * The library's `createCityTileSource` with the demo's user agent: the
 * globe's city builds the same source (round-4 plan 2026-10-11-0122 §5).
 */
export function createOsmTileSource(
  store: OsmBlobStore,
  options: { readonly fetchImpl?: typeof fetch } = {},
): CachingSource {
  return createCityTileSource(store, {
    userAgent: OSM_DEMO_USER_AGENT,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
  });
}
