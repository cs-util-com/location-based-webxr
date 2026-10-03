/**
 * Releasing a carrier's tile cache when the carrier leaves the frame
 * (review 2026-10-03-1835 major 4): outside the altitude band one carrier
 * is neither drawn nor updated, and its tiles would otherwise stay
 * resident beside the other's.
 *
 * @see globe-tile-cache.ts.md
 */
/**
 * What this module uses of the library's `LRUCache` (its typings omit
 * `cachedBytes`).
 */
export interface TileCache {
  readonly cachedBytes: number;
  minSize: number;
  maxSize: number;
  minBytesSize: number;
  maxBytesSize: number;
  markAllUnused(): void;
  unloadUnusedContent(): void;
}

/** At most this many unload passes (each frees part of the excess). */
const MAX_PASSES = 256;

/**
 * Unloads every tile `cache` holds (each tile's dispose callback runs) and
 * returns the bytes freed. The library unloads only part of its excess per
 * pass and stops at its floor, so the floor is lowered to 0 for the passes
 * and the limits are restored after: the carrier loads normally when it
 * returns. Call it only for a renderer that is not updated meanwhile.
 */
export function releaseTileCache(cache: TileCache): number {
  const before = cache.cachedBytes;
  const { minSize, minBytesSize, maxSize, maxBytesSize } = cache;
  cache.minSize = 0;
  cache.minBytesSize = 0;
  cache.maxSize = 0;
  cache.maxBytesSize = 0;
  try {
    cache.markAllUnused();
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const bytes = cache.cachedBytes;
      cache.unloadUnusedContent();
      if (cache.cachedBytes === 0 || cache.cachedBytes >= bytes) break;
    }
  } finally {
    cache.minSize = minSize;
    cache.minBytesSize = minBytesSize;
    cache.maxSize = maxSize;
    cache.maxBytesSize = maxBytesSize;
  }
  return before - cache.cachedBytes;
}
