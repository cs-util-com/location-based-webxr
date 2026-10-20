/**
 * Opens the browser's persistent OSM tile store: the OPFS directory every
 * reader and writer of the cache shares, or `undefined` when there is none.
 *
 * WHY HERE. OsmDemo's worker and the globe's arrival prefetch opened it
 * through OsmDemo's `osm-tile-cache.ts`; the globe's city (globe city plan
 * 2026-10-05-0040 §14, the Osm library's second consumer) is a third reader,
 * and an app's module was the wrong home for storage glue three callers
 * share. It sits beside the store and the directory it opens.
 *
 * @see open-osm-store.ts.md
 */

import {
  OpfsOsmBlobStore,
  openOsmStoreDirectory,
  type OsmBlobStore,
  type OsmBlobStoreWarn,
} from './opfs-osm-blob-store.js';

/** How the store is opened. */
export interface OpenOsmStoreOptions {
  /**
   * The storage manager. Default: `navigator.storage`; an explicit
   * `undefined` means there is none.
   */
  readonly storage?: StorageManager | undefined;
  /**
   * Where the OPFS store reports a failed write or listing. OsmDemo's worker
   * passes the framework logger, so the failures stay Sentry Issues; a
   * caller that cannot load the logger leaves the store's `console.warn`.
   */
  readonly warn?: OsmBlobStoreWarn;
}

/** The browser's storage manager, when there is one. */
function storageOf(options: OpenOsmStoreOptions): StorageManager | undefined {
  if ('storage' in options) return options.storage;
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/**
 * The OPFS-backed store, or `undefined` when there is none (no storage
 * manager, OPFS refused, a private mode that throws). Never throws.
 *
 * `undefined` rather than a memory fallback, because callers want different
 * things from its absence: a worker still needs SOME store (it falls back to
 * the Osm library's `MemoryBlobStore`), while a prefetch must know that
 * nothing it fetches would outlive the page.
 */
export async function openPersistentOsmStore(
  options: OpenOsmStoreOptions = {}
): Promise<OsmBlobStore | undefined> {
  try {
    const storage = storageOf(options);
    if (typeof storage?.getDirectory !== 'function') return undefined;
    const root = await storage.getDirectory();
    return new OpfsOsmBlobStore({
      directory: await openOsmStoreDirectory(root),
      ...(options.warn === undefined ? {} : { warn: options.warn }),
    });
  } catch {
    return undefined;
  }
}
