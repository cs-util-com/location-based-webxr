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

import {
  type TileCache,
  drainTileCache,
  releaseTileCache,
} from "./globe-tile-cache.js";

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

/**
 * Why (perf plan 2026-10-03-2017 H4, PERF-2c): a release disposed every
 * tile in ONE frame; the frame-hitch recorder counted 188 globe disposals
 * in a single frame, a dispose burst on the GPU thread. The drain spreads
 * the same release over frames, at most `maxTiles` disposals a frame, and
 * can stop between frames when the carrier comes back into the band.
 */
describe("drainTileCache", () => {
  function filled(count: number) {
    const lru = new LRUCache();
    const cache = lru as unknown as TileCache & typeof lru;
    cache.minSize = 6;
    cache.maxSize = 800;
    // Room for every tile: the cache refuses an add once it is full.
    cache.minBytesSize = 48 * 2 ** 20;
    cache.maxBytesSize = 256 * 2 ** 20;
    const disposed: number[] = [];
    for (let i = 0; i < count; i++) {
      const tile = { id: i };
      cache.add(tile, () => {
        disposed.push(i);
      });
      cache.setLoaded(tile, true);
      cache.setMemoryUsage(tile, 2 ** 20);
      cache.markUsed(tile);
    }
    return { cache, disposed };
  }

  it("disposes at most maxTiles a call, and empties the cache over calls", () => {
    for (const maxTiles of [4, 8, 16]) {
      const { cache, disposed } = filled(188);
      const perCall: number[] = [];
      const lefts: number[] = [];
      let freed = 0;
      for (let call = 0; call < 1_000 && cache.cachedBytes > 0; call++) {
        const before = disposed.length;
        const step = drainTileCache(cache, maxTiles);
        freed += step.freedBytes;
        perCall.push(disposed.length - before);
        lefts.push(step.left + disposed.length);
      }
      // `left` is what remains after the call.
      expect(new Set(lefts)).toEqual(new Set([188]));
      expect(Math.max(...perCall)).toBe(maxTiles);
      expect(perCall.length).toBe(Math.ceil(188 / maxTiles));
      expect(disposed.length).toBe(188);
      expect(freed).toBe(188 * 2 ** 20);
      // The limits are the cache's own throughout: nothing to restore.
      expect(cache.minSize).toBe(6);
      expect(cache.maxBytesSize).toBe(256 * 2 ** 20);
    }
  });

  it("leaves the remaining tiles loaded when the caller stops draining", () => {
    const { cache, disposed } = filled(40);
    drainTileCache(cache, 8);
    drainTileCache(cache, 8);
    expect(disposed.length).toBe(16);
    expect(cache.cachedBytes).toBe(24 * 2 ** 20);
  });

  // Why (round-6 plan G6-1): zooming out after a release, the globe had
  // no tile left, so neither carrier could draw the widening view and the
  // background showed. A carrier keeps its coarsest tiles (cheap) so it is
  // ready again at once; `keep` names them, and they are never drained.
  it("never removes an item `keep` names, and counts only the others as left", () => {
    const { cache, disposed } = filled(40);
    const keep = (item: unknown) => (item as { id: number }).id < 5;
    let left = Infinity;
    for (let call = 0; call < 100 && left > 0; call++) {
      left = drainTileCache(cache, 8, keep).left;
    }
    expect(left).toBe(0);
    expect(disposed.length).toBe(35);
    expect(disposed.every((id) => id >= 5)).toBe(true);
    expect(cache.cachedBytes).toBe(5 * 2 ** 20);
  });

  it("is a no-op on an empty cache, and refuses a step that is not a positive integer", () => {
    const cache = new LRUCache() as unknown as TileCache;
    expect(drainTileCache(cache, 8)).toEqual({
      freedBytes: 0,
      removed: 0,
      left: 0,
    });
    for (const bad of [0, -1, 2.5, Number.NaN, Infinity]) {
      expect(() => drainTileCache(cache, bad)).toThrow(RangeError);
    }
  });
});
