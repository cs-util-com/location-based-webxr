/**
 * Keeps the relief's decoded heights past their tiles (owner decision
 * 2026-10-04, DEC-N1). The library's terrain plugin locks one decoded
 * elevation grid per source tile in a reference-counted cache and frees it
 * when its last tile is disposed, so leaving the band (which drains the
 * relief) and coming back fetched and decoded every height tile again. This
 * holds one extra lock on each grid its tiles released, newest first, within
 * `maxBytes`, so a return finds the grid in the library's own cache; only
 * the imagery and the meshes are built again.
 *
 * @see globe-height-keeper.ts.md
 */

/** What this module uses of the plugin's grid cache (private in 0.5.3). */
interface GridCacheLike {
  lock(...key: number[]): unknown;
  release(...key: number[]): void;
  get(...key: number[]): { image?: { data?: ArrayLike<number> } } | null;
}

/** What this module uses of the plugin (private in 0.5.3; guarded by the tests). */
interface KeeperPlugin {
  _gridCache: GridCacheLike;
  _releaseGrid(tile: object): void;
}

export interface HeightKeeper {
  /** Counters for the Debug panel and the smokes. */
  stats(): {
    /** Grids held now, and their bytes. */
    kept: number;
    keptBytes: number;
    /** Grids given back to make room since installation. */
    evicted: number;
  };
  /** Gives every kept grid back (the terrain's dispose). */
  dispose(): void;
}

/**
 * The library stores a tile's source grid key under a module-private symbol
 * named "SOURCE_TILE" (`[x, y, level]`); found by its description.
 */
export function librarySourceOf(tile: object): number[] | undefined {
  for (const s of Object.getOwnPropertySymbols(tile)) {
    if (s.description === "SOURCE_TILE") {
      const v = (tile as Record<symbol, unknown>)[s];
      return Array.isArray(v) ? (v as number[]) : undefined;
    }
  }
  return undefined;
}

/**
 * Installs the keeper on `plugin` (a registered `TerrariumMeshPlugin`):
 * wraps its `_releaseGrid` so the released grid gets one extra lock, kept in
 * a newest-first list within `maxBytes` (0 keeps nothing). `sourceOf` reads a
 * tile's grid key (the library's own by default). TypeError if the plugin
 * lacks a member this relies on; RangeError for a budget that is not finite
 * and >= 0.
 */
export function installHeightKeeper(
  plugin: unknown,
  options: {
    maxBytes: number;
    sourceOf?: (tile: object) => number[] | undefined;
  },
): HeightKeeper {
  const { maxBytes, sourceOf = librarySourceOf } = options;
  const p = plugin as Partial<KeeperPlugin> | null;
  if (
    typeof p?._releaseGrid !== "function" ||
    typeof p._gridCache?.lock !== "function" ||
    typeof p._gridCache.release !== "function" ||
    typeof p._gridCache.get !== "function"
  ) {
    throw new TypeError(
      "the terrain plugin no longer has _releaseGrid and a _gridCache with lock, release and get",
    );
  }
  if (!(maxBytes >= 0 && Number.isFinite(maxBytes))) {
    throw new RangeError(
      `the height budget must be finite and >= 0, got ${maxBytes}`,
    );
  }
  const cache = p._gridCache;
  /** Kept grids, oldest first: key text -> { key, bytes }. */
  const kept = new Map<string, { key: number[]; bytes: number }>();
  let keptBytes = 0;
  let evicted = 0;

  const giveBack = (text: string) => {
    const k = kept.get(text);
    if (!k) return;
    kept.delete(text);
    keptBytes -= k.bytes;
    cache.release(...k.key);
  };

  /** The grid's bytes (its decoded heights), or 0 when it is not loaded. */
  const gridBytes = (key: number[]): number => {
    const data = cache.get(...key)?.image?.data;
    return data && "byteLength" in data
      ? (data as { byteLength: number }).byteLength
      : 0;
  };

  /** Holds the grid at `key` (one extra lock), newest, within the budget. */
  const keep = (key: number[]) => {
    const text = key.join("/");
    const held = kept.get(text);
    if (held) {
      // Already held: refresh its place as the newest.
      kept.delete(text);
      kept.set(text, held);
      return;
    }
    const bytes = gridBytes(key);
    if (bytes === 0 || bytes > maxBytes) return;
    // The extra lock first, so the library's release that follows never
    // drops the count to zero.
    cache.lock(...key);
    kept.set(text, { key, bytes });
    keptBytes += bytes;
    while (keptBytes > maxBytes) {
      giveBack(kept.keys().next().value as string);
      evicted++;
    }
  };

  const releaseGrid = p._releaseGrid.bind(p);
  (p as KeeperPlugin)._releaseGrid = (tile: object) => {
    const key = maxBytes > 0 ? sourceOf(tile) : undefined;
    if (key) keep(key);
    releaseGrid(tile);
  };

  return {
    stats: () => ({ kept: kept.size, keptBytes, evicted }),
    dispose() {
      for (const text of [...kept.keys()]) giveBack(text);
    },
  };
}
