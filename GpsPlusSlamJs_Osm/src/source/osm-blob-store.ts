/**
 * The persistence seam.
 *
 * Persistence is **injected, never imported**: this package must run in Node
 * (tests, the investigation harness), in a browser main thread, and inside a
 * Web Worker, and none of those share a storage API. The consumer supplies an
 * OPFS-backed or IndexedDB-backed implementation; tests supply the in-memory
 * one.
 *
 * @see osm-blob-store.ts.md
 */

/**
 * A minimal string-keyed blob store.
 *
 * **Known limitation of a blob-shaped interface, accepted deliberately:** no
 * indexes, no cursors, no partial reads, no transactional multi-store writes. A
 * query like "every feature tagged X across all cached tiles" means loading and
 * parsing whole tiles. That is fine for this package's access patterns, which
 * are always "the tiles around the user", and the injected interface means a
 * consumer can back it with IndexedDB instead of OPFS if that ever changes.
 */
export interface OsmBlobStore {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every key currently held. Used by `listCachedTiles()`. */
  keys(): Promise<readonly string[]>;
}
