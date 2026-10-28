/**
 * The relief's tile cache: a budget per height-tile format and device
 * class, and an observable "cache full, refinement stalled" state (tour
 * editor plan 2026-10-17-1816 §13; G0 spikes, the headline finding).
 *
 * The library counts each relief tile's bytes as its own copy of the
 * height grid (a clone per tile, though the GPU upload is shared), the
 * imagery texture composed for it and its mesh. With 512 px heights a
 * tile counts about 2.4 times a 256 px one, so the 64 MB that holds the
 * AWS relief filled at 49 Mapterhorn tiles: the tree stopped refining at
 * level 2 and drew a continent-sized tile 3.2 km under an eye-height
 * camera, while sampled heights stayed right. Nothing reported it. When
 * full, the library stops queueing the tiles an update wants (its
 * `stats.refused`, reset every update) and drops a tile that has just
 * loaded; `watchReliefCache` keeps both as counts and a stall.
 *
 * @see globe-relief-cache.ts.md
 */
import type { LRUCache } from "3d-tiles-renderer";

/** Who the budget is for: the app decides (a lab setting, a device probe). */
export type ReliefDeviceClass = "phone" | "desktop";

const MIB = 2 ** 20;

export const RELIEF_CACHE = Object.freeze({
  /**
   * The budget for 256 px height tiles, per device class. The phone's is
   * the globe's 64 MB (F1, unchanged; below the need measured on a
   * desktop canvas, see the sidecar). The desktop's is 256 MiB, from the
   * lab sweep of 2026-10-18 (G1 review M3; bytes the view's tiles use,
   * 1280 x 800, Munich): AWS 130 MiB at the default mesh and up to 191
   * MiB at mesh level 17 with the OSM map, so 256 MiB keeps a third in
   * hand; Mapterhorn (512 px, so 604 MiB) up to 242 MiB, and 333 MiB at
   * 1920 x 1080.
   */
  bytes256: Object.freeze({ phone: 64 * MIB, desktop: 256 * MIB }),
  /** The floor the library evicts down to, as a share of the cap (48/64). */
  floorShare: 0.75,
  /**
   * What the library counts per tile beside its heights (bytes): the
   * imagery composed for the tile (256 x 256 RGBA) and its 32 x 32 mesh
   * with skirts (1,221 vertices of position, normal and uv; 6,912 indices).
   */
  otherBytesPerTile: 256 * 256 * 4 + 1_221 * 32 + 6_912 * 2,
  /**
   * Refusals less than this far apart (ms) are one run, and a run this
   * old is still running...
   */
  stallWindowMs: 2_000,
  /**
   * ...and a run of refusals this long (ms) reads stalled, full or not: a
   * cache that thrashes (the library unloads to its floor, the update
   * refills it and is refused again) has room at almost any moment.
   */
  sustainedMs: 1_000,
});

/** Bytes the library counts for one tile of `tileDimension` px heights. */
export function reliefTileBytes(tileDimension: number): number {
  if (!(Number.isInteger(tileDimension) && tileDimension >= 1)) {
    throw new RangeError(
      `a tile dimension must be a positive integer, got ${tileDimension}`,
    );
  }
  // The decoded grid: float32, one texel of border all round.
  return (tileDimension + 2) ** 2 * 4 + RELIEF_CACHE.otherBytesPerTile;
}

/** The relief cache's cap and the floor the library evicts down to (bytes). */
export interface ReliefCacheBudget {
  readonly maxBytes: number;
  readonly minBytes: number;
}

/** RangeError unless 0 <= `minBytes` <= `maxBytes` and `maxBytes` > 0, all finite. */
export function checkReliefCacheBudget(budget: ReliefCacheBudget): void {
  const { maxBytes, minBytes } = budget ?? {};
  if (
    !(Number.isFinite(maxBytes) && maxBytes > 0) ||
    !(Number.isFinite(minBytes) && minBytes >= 0 && minBytes <= maxBytes)
  ) {
    throw new RangeError(
      `the relief cache needs 0 <= minBytes <= maxBytes, maxBytes > 0, got ${minBytes} and ${maxBytes}`,
    );
  }
}

/**
 * The relief cache's cap and floor (bytes) for `tileDimension` px height
 * tiles on a `device`: the 256 px budget scaled by what a tile of this
 * format counts, so the cap holds the same number of tiles. The device
 * class has no default: a desktop editor silently given the phone's budget
 * stalls (G1 review M3). RangeError for a bad dimension or a missing or
 * unknown device class.
 */
export function reliefCacheBudget(
  tileDimension: number,
  device: ReliefDeviceClass,
): ReliefCacheBudget {
  const base = (RELIEF_CACHE.bytes256 as Record<string, number | undefined>)[
    device
  ];
  if (base === undefined) {
    throw new RangeError(`unknown device class ${String(device)}`);
  }
  const maxBytes = Math.round(
    (base * reliefTileBytes(tileDimension)) / reliefTileBytes(256),
  );
  return {
    maxBytes,
    minBytes: Math.round(maxBytes * RELIEF_CACHE.floorShare),
  };
}

/** The relief cache now (`watchReliefCache`). */
export interface ReliefCacheState {
  readonly usedBytes: number;
  /**
   * Bytes of the tiles the last traversing update used (the view's need:
   * what a budget must hold), 0 before the first.
   */
  readonly inUseBytes: number;
  readonly maxBytes: number;
  readonly full: boolean;
  /** Tiles updates wanted to load but could not queue: the cache was full. */
  readonly refusedRequests: number;
  /** Tiles loaded, then dropped: the cache was full. */
  readonly refusedLoads: number;
  /**
   * Full with a tile refused since the cache last had room (the library
   * unloads unused tiles when full, so a cache that STAYS full holds only
   * tiles in use, and the tiles it turned away are missing), or refusals
   * running for `sustainedMs` and not stopped (a thrashing cache).
   */
  readonly stalled: boolean;
}

/** What `watchReliefCache` reads of the tiles' renderer (0.5.3). */
export interface WatchedTiles {
  readonly lruCache: LRUCache;
  readonly stats: { readonly refused: number };
  readonly frameCount: number;
  addEventListener(type: "update-after", listener: () => void): void;
  removeEventListener(type: "update-after", listener: () => void): void;
}

/**
 * What the cache's typings leave out (0.5.3): its byte count, and its
 * private set of loaded items, read if it is there.
 */
type CacheInternals = {
  cachedBytes: number;
  loadedSet?: { has(item: unknown): boolean };
  usedSet?: Iterable<unknown>;
  bytesMap?: { get(item: unknown): number | undefined };
};

/**
 * Keeps the relief cache's refusals: after each update that traversed
 * (`frameCount` moved; an update a plugin skips leaves the last count in
 * place), the library's `stats.refused`; and every `remove` of a tile
 * that has loaded, with no bytes counted, while the cache is full (the
 * library's "discard this tile" path). It reads stalled when full after a
 * refusal until it is seen with room again (after an update, a removal or
 * a read: a cache stuck full of tiles in use), or while refusals less than
 * `windowMs` apart have run for `RELIEF_CACHE.sustainedMs` (a thrashing
 * cache). `state()` reports them; `dispose()`
 * restores the cache's `remove` and stops listening. `now` is injectable
 * for tests. RangeError for a window that is not finite and >= 0.
 */
export function watchReliefCache(
  tiles: WatchedTiles,
  {
    now = () => performance.now(),
    windowMs = RELIEF_CACHE.stallWindowMs,
  }: { now?: () => number; windowMs?: number } = {},
): { state(): ReliefCacheState; dispose(): void } {
  if (!(windowMs >= 0 && Number.isFinite(windowMs))) {
    throw new RangeError(
      `the stall window must be finite and >= 0, got ${windowMs}`,
    );
  }
  const cache = tiles.lruCache;
  const internals = cache as unknown as CacheInternals;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the cache below
  const remove = cache.remove;
  let refusedRequests = 0;
  let refusedLoads = 0;
  let refusedSinceRoom = false;
  let lastRefusalAt = Number.NEGATIVE_INFINITY;
  let runStartAt = Number.NEGATIVE_INFINITY;
  const refuse = () => {
    const t = now();
    refusedSinceRoom = true;
    if (t - lastRefusalAt > windowMs) runStartAt = t;
    lastRefusalAt = t;
  };
  const thrashing = () =>
    now() - lastRefusalAt <= windowMs &&
    lastRefusalAt - runStartAt >= RELIEF_CACHE.sustainedMs;
  /** A cache seen with room has nothing turned away outstanding. */
  const seeRoom = () => {
    if (!cache.isFull()) refusedSinceRoom = false;
  };
  let inUseBytes = 0;
  let seenFrame = tiles.frameCount;
  const afterUpdate = () => {
    if (tiles.frameCount === seenFrame) return;
    seenFrame = tiles.frameCount;
    // The used set is this update's until the next one clears it.
    inUseBytes = 0;
    for (const item of internals.usedSet ?? []) {
      inUseBytes += internals.bytesMap?.get(item) ?? 0;
    }
    const refused = tiles.stats.refused;
    if (refused > 0) {
      refusedRequests += refused;
      refuse();
    }
    seeRoom();
  };
  tiles.addEventListener("update-after", afterUpdate);
  cache.remove = function (this: LRUCache, item: unknown) {
    const loaded = internals.loadedSet?.has(item) ?? false;
    if (loaded && cache.getMemoryUsage(item) === 0 && cache.isFull()) {
      refusedLoads++;
      refuse();
    }
    const removed = remove.call(this, item);
    seeRoom();
    return removed;
  };
  return {
    state() {
      seeRoom();
      const full = cache.isFull();
      return {
        usedBytes: internals.cachedBytes,
        inUseBytes,
        maxBytes: cache.maxBytesSize,
        full,
        refusedRequests,
        refusedLoads,
        stalled: (full && refusedSinceRoom) || thrashing(),
      };
    },
    dispose() {
      cache.remove = remove;
      tiles.removeEventListener("update-after", afterUpdate);
    },
  };
}
