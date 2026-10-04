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
  /** Every item the cache holds (the library's own list, in no fixed order). */
  readonly itemList: readonly unknown[];
  /** Removes one item, running its dispose callback; false if absent. */
  remove(item: unknown): boolean;
  /** The library's unload order: a positive result unloads `a` first. */
  unloadPriorityCallback?: ((a: unknown, b: unknown) => number) | null;
  defaultPriorityCallback?: (a: unknown, b: unknown) => number;
}

/** One `drainTileCache` call's result. */
export interface TileCacheDrainStep {
  /** Bytes the call freed. */
  freedBytes: number;
  /** Items the call removed (each one's dispose callback ran). */
  removed: number;
  /** Items still in the cache after the call that `keep` does not name. */
  left: number;
}

/**
 * Removes at most `maxTiles` items from `cache`, the ones the library would
 * unload first, and returns what it freed. Called once a frame it spreads a
 * release over frames (perf plan 2026-10-03-2017 H4: one frame disposed
 * 188 tiles); the caller stops calling when the carrier is back, and the
 * rest stay loaded. The cache's limits are never touched. Items `keep`
 * names are never removed (a carrier's coarsest tiles, so it can draw
 * again at once; round-6 plan G6-1). RangeError unless `maxTiles` is a
 * positive integer.
 */
export function drainTileCache(
  cache: TileCache,
  maxTiles: number,
  keep: (item: unknown) => boolean = () => false,
): TileCacheDrainStep {
  if (!Number.isInteger(maxTiles) || maxTiles < 1) {
    throw new RangeError(
      `the drain step must be a positive integer, got ${maxTiles}`,
    );
  }
  const before = cache.cachedBytes;
  const order = cache.unloadPriorityCallback ?? cache.defaultPriorityCallback;
  const items = cache.itemList.filter((item) => !keep(item));
  if (order) items.sort((a, b) => -order(a, b));
  let removed = 0;
  for (const item of items.slice(0, maxTiles)) {
    if (cache.remove(item)) removed++;
  }
  return {
    freedBytes: before - cache.cachedBytes,
    removed,
    left: cache.itemList.filter((item) => !keep(item)).length,
  };
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
