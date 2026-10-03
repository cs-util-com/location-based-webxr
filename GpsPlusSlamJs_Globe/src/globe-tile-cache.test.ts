/**
 * Why this test matters (review 2026-10-03-1835 major 4): outside the
 * altitude band one carrier is neither drawn nor updated, but its tiles
 * stayed in its cache: the globe's 64 MB sat resident all the way down to
 * the hold, beside the relief's. Releasing a carrier's cache must unload
 * every tile it holds (each tile's own dispose callback runs, so its GPU
 * memory goes), even though the library unloads only part of its excess per
 * call and keeps a floor, and must leave the cache's own limits as they
 * were, so the carrier loads normally when it comes back.
 */
import { LRUCache } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { type TileCache, releaseTileCache } from "./globe-tile-cache.js";

describe("releaseTileCache", () => {
  it("unloads every tile, past the floor, and keeps the limits", () => {
    const lru = new LRUCache();
    const cache = lru as unknown as TileCache & typeof lru;
    cache.minSize = 6;
    cache.maxSize = 800;
    cache.minBytesSize = 48 * 2 ** 20;
    cache.maxBytesSize = 64 * 2 ** 20;
    const disposed: number[] = [];
    for (let i = 0; i < 40; i++) {
      const tile = { id: i };
      cache.add(tile, () => {
        disposed.push(i);
      });
      cache.setLoaded(tile, true);
      cache.setMemoryUsage(tile, 2 ** 20);
      cache.markUsed(tile);
    }
    expect(cache.cachedBytes).toBe(40 * 2 ** 20);
    const freed = releaseTileCache(cache);
    expect(freed).toBe(40 * 2 ** 20);
    expect(cache.cachedBytes).toBe(0);
    expect(disposed.length).toBe(40);
    expect(cache.minSize).toBe(6);
    expect(cache.maxSize).toBe(800);
    expect(cache.minBytesSize).toBe(48 * 2 ** 20);
    expect(cache.maxBytesSize).toBe(64 * 2 ** 20);
  });

  it("is a no-op on an empty cache", () => {
    const cache = new LRUCache();
    expect(releaseTileCache(cache as unknown as TileCache)).toBe(0);
  });
});
