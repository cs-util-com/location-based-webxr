/**
 * The OSM tile cache's store and source, built in ONE place for the two
 * writers of that cache: OsmDemo's worker, and the globe's arrival prefetch
 * (round-5 plan 2026-10-01-0945 §3.6), which warms it during the fly-in so
 * OsmDemo opens warm after the URL hand-over (DEC-GL5-8).
 *
 * WHY ONE MODULE. The prefetch is only worth anything if it writes exactly
 * what OsmDemo reads: the same OPFS directory, the same cache key, and the
 * same Overpass source (the same user agent, the same race and slot rules).
 * Two copies of that wiring is how one of them quietly drifts and the
 * second visit stays cold with nothing reporting it.
 *
 * LAB-LOADABLE. The globe lab imports this module as served TypeScript
 * (`/osm/osm-tile-cache.js`), so it imports only modules that load under the
 * design system's no-build routes (see `arrival-prefetch.ts.md`).
 *
 * @see osm-tile-cache.ts.md
 */

import {
  CachingSource,
  MemoryBlobStore,
  OverpassSource,
  type OsmBlobStore,
} from "gps-plus-slam-osm";
import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
  type OsmBlobStoreWarn,
} from "gps-plus-slam-app-framework/osm-bridge";

/** How the demo identifies itself to the Overpass operators. */
export const OSM_DEMO_USER_AGENT =
  "gps-plus-slam-osm-demo (github.com/cs-util-com)";

/** How a store is opened. */
export interface OpenOsmStoreOptions {
  /**
   * The storage manager. Default: `navigator.storage`; an explicit
   * `undefined` means there is none.
   */
  readonly storage?: StorageManager | undefined;
  /**
   * Where the OPFS store reports a failed write or listing. OsmDemo's worker
   * passes the framework logger (`worker/osm-store-warn.ts`), so the
   * failures stay Sentry Issues; the globe lab cannot load the logger and
   * leaves the store's `console.warn` default.
   */
  readonly warn?: OsmBlobStoreWarn;
}

/** The browser's storage manager, when there is one. */
function storageOf(options: OpenOsmStoreOptions): StorageManager | undefined {
  if ("storage" in options) return options.storage;
  return typeof navigator === "undefined" ? undefined : navigator.storage;
}

/**
 * The OPFS-backed store, or `undefined` when there is none (no storage
 * manager, OPFS refused, a private mode that throws). Never throws.
 *
 * `undefined` rather than a memory fallback, because the two callers want
 * different things from its absence: the worker still needs SOME store
 * ({@link openOsmStore}), while a prefetch must know that nothing it fetches
 * would outlive the page.
 */
export async function openPersistentOsmStore(
  options: OpenOsmStoreOptions = {},
): Promise<OsmBlobStore | undefined> {
  try {
    const storage = storageOf(options);
    if (typeof storage?.getDirectory !== "function") return undefined;
    const root = await storage.getDirectory();
    return new OpfsOsmBlobStore({
      directory: await openOsmStoreDirectory(root),
      ...(options.warn === undefined ? {} : { warn: options.warn }),
    });
  } catch {
    return undefined;
  }
}

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
 * fetch, foreground, ring prefetch or arrival prefetch, goes through.
 * `fetchImpl` is the network seam (tests; defaults to the global fetch).
 */
export function createOsmTileSource(
  store: OsmBlobStore,
  options: { readonly fetchImpl?: typeof fetch } = {},
): CachingSource {
  return new CachingSource(
    new OverpassSource({
      userAgent: OSM_DEMO_USER_AGENT,
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
    }),
    store,
  );
}
