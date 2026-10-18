/**
 * Why these tests matter: the G0 spikes' headline finding (2026-10-17) was
 * a SILENT stall: with 512 px heights the relief cache filled at 49 tiles,
 * the tree stopped at level 2 and the ground was drawn 3.2 km under the
 * camera, with nothing on the page saying so. These tests pin (1) a budget
 * that scales with the tile format, so a 512 px source gets the room its
 * tiles need while the phone's 256 px budget stays the 64 MB it always
 * was, and (2) a stall that is observable: a full cache that turns tiles
 * away reads `stalled`, and stops reading it once refusals stop. The
 * refusals are the library's own (its queue and its load step), driven
 * through its real renderer and cache, never a re-implementation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LRUCache, TilesRenderer } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import {
  RELIEF_CACHE,
  checkReliefCacheBudget,
  reliefCacheBudget,
  reliefTileBytes,
  watchReliefCache,
} from "./globe-relief-cache.js";

describe("reliefCacheBudget", () => {
  // Why: the globe lab's phone budget must not move with this change; the
  // owner's phone judges the globe's pace, and 64/48 MB is what it ran.
  it("keeps the phone's 256 px budget at 64 MB with a 48 MB floor", () => {
    expect(reliefCacheBudget(256, "phone")).toEqual({
      maxBytes: 64 * 2 ** 20,
      minBytes: 48 * 2 ** 20,
    });
    expect(reliefCacheBudget(256)).toEqual(reliefCacheBudget(256, "phone"));
  });

  // Why: the cap is meant as a NUMBER OF TILES; a format whose tiles count
  // more bytes gets proportionally more, so 512 px tiles are not held to
  // less than half the tiles 256 px ones get.
  it("holds the same number of tiles for every format", () => {
    for (const device of ["phone", "desktop"] as const) {
      const tiles = (td: number) =>
        reliefCacheBudget(td, device).maxBytes / reliefTileBytes(td);
      expect(tiles(512)).toBeCloseTo(tiles(256), 3);
      expect(tiles(128)).toBeCloseTo(tiles(256), 3);
    }
    // 512 px tiles count about 2.4 times a 256 px tile.
    expect(reliefTileBytes(512) / reliefTileBytes(256)).toBeCloseTo(2.36, 2);
  });

  it("gives a desktop twice a phone", () => {
    expect(reliefCacheBudget(512, "desktop").maxBytes).toBe(
      2 * reliefCacheBudget(512, "phone").maxBytes,
    );
  });

  // Why: the spike measured 197 MB in use for Mapterhorn at eye height on
  // a desktop; the desktop budget must hold it with room to spare.
  it("holds the spike's measured eye-height use on a desktop", () => {
    expect(reliefCacheBudget(512, "desktop").maxBytes).toBeGreaterThan(
      1.4 * 197 * 2 ** 20,
    );
  });

  // Why: an app sets the budget; a cap of 0, a floor above the cap or a
  // NaN would make the library evict everything or nothing, silently.
  it("accepts every budget it computes and refuses an impossible one", () => {
    for (const td of [128, 256, 512]) {
      for (const device of ["phone", "desktop"] as const) {
        expect(() =>
          checkReliefCacheBudget(reliefCacheBudget(td, device)),
        ).not.toThrow();
      }
    }
    expect(() =>
      checkReliefCacheBudget({ maxBytes: 1_000, minBytes: 1_000 }),
    ).not.toThrow();
    for (const bad of [
      { maxBytes: 0, minBytes: 0 },
      { maxBytes: 1_000, minBytes: 1_001 },
      { maxBytes: Number.POSITIVE_INFINITY, minBytes: 1 },
      { maxBytes: 1_000, minBytes: Number.NaN },
      { maxBytes: 1_000, minBytes: -1 },
    ]) {
      expect(() => checkReliefCacheBudget(bad)).toThrow(RangeError);
    }
  });

  it("refuses a bad dimension or an unknown device class", () => {
    expect(() => reliefTileBytes(0)).toThrow(RangeError);
    expect(() => reliefTileBytes(256.5)).toThrow(RangeError);
    expect(() => reliefCacheBudget(256, "watch" as unknown as "phone")).toThrow(
      RangeError,
    );
  });
});

/** The renderer's private queue step and frame counter (0.5.3), for tests. */
type DrivenTiles = TilesRenderer & {
  stats: { refused: number };
  frameCount: number;
  queueTileForDownload(tile: unknown): void;
};

describe("watchReliefCache", () => {
  /** A renderer whose cache holds `bytes` at most, and the watch's clock. */
  function setup(bytes = 1_000) {
    const tiles = new TilesRenderer() as DrivenTiles;
    const cache = new LRUCache();
    cache.maxBytesSize = bytes;
    cache.minBytesSize = bytes / 2;
    tiles.lruCache = cache;
    let t = 0;
    const watch = watchReliefCache(tiles, { now: () => t, windowMs: 2_000 });
    /** One update as the library runs it: stats reset, traversal, event. */
    const update = (traverse: () => void = () => {}) => {
      tiles.stats.refused = 0;
      tiles.frameCount++;
      traverse();
      tiles.dispatchEvent({ type: "update-after" } as never);
    };
    /** A tile in the cache, loaded, counting `n` bytes. */
    const resident = (n: number) => {
      const tile = { internal: { loadingState: 3 } };
      cache.add(tile, () => {});
      cache.setLoaded(tile, true);
      cache.setMemoryUsage(tile, n);
      return tile;
    };
    const unloaded = () => ({ internal: { loadingState: 0 } });
    return {
      tiles,
      cache,
      watch,
      update,
      resident,
      unloaded,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it("reads not full and not stalled while there is room", () => {
    const { watch, update, resident, tiles, unloaded } = setup();
    resident(400);
    update(() => tiles.queueTileForDownload(unloaded()));
    expect(watch.state()).toEqual({
      usedBytes: 400,
      maxBytes: 1_000,
      full: false,
      refusedRequests: 0,
      refusedLoads: 0,
      stalled: false,
    });
  });

  // Why: the stall the spike found, driven through the library's own
  // renderer and cache: once full, the queue step turns the tiles an
  // update wants away (its `stats.refused`), and the load step drops a
  // tile that has just loaded (loaded, no bytes counted yet, cache full).
  // Both must read as stalled, and the stall must last while the cache
  // stays full (the globe lab, 2026-10-18: 128 MiB at a 3 km oblique view,
  // 136 refusals, then none; still full, 6 of 103 visible tiles never
  // loaded, and a stall that had cleared after 2 s said nothing).
  it("reads stalled when a full cache turns tiles away, and while it stays full", () => {
    const { tiles, cache, watch, update, resident, unloaded } = setup();
    resident(1_000);
    expect(cache.isFull()).toBe(true);
    update(() => {
      tiles.queueTileForDownload(unloaded());
      tiles.queueTileForDownload(unloaded());
    });
    expect(tiles.stats.refused).toBe(2);
    expect(watch.state()).toMatchObject({
      full: true,
      refusedRequests: 2,
      stalled: true,
    });

    // The load step's discard: a tile queued while there was room, loaded
    // after the cache filled, removed before its bytes are counted.
    cache.maxBytesSize = 2_000;
    const late = { internal: { loadingState: 3 } };
    cache.add(late, () => {});
    cache.maxBytesSize = 1_000;
    cache.setLoaded(late, true);
    cache.remove(late);
    expect(watch.state()).toMatchObject({ refusedLoads: 1, stalled: true });

    // An update a plugin skips keeps the last count; it is not counted again.
    tiles.dispatchEvent({ type: "update-after" } as never);
    expect(watch.state().refusedRequests).toBe(2);

    // Refusals stop, the cache stays full: the tiles it turned away are
    // still missing, so it still reads stalled.
    update();
    update();
    expect(watch.state()).toMatchObject({
      full: true,
      refusedRequests: 2,
      refusedLoads: 1,
      stalled: true,
    });
  });

  // Why: the library unloads unused tiles when the cache is full; a tile
  // refused just before that unload is asked for again on the next update
  // and loads. A refusal the same update makes room for is not a stall.
  it("does not read stalled when the update that refused also made room", () => {
    const { tiles, cache, watch, update, resident, unloaded, advance } =
      setup();
    const old = resident(1_000);
    update(() => {
      tiles.queueTileForDownload(unloaded());
      cache.remove(old);
    });
    expect(watch.state()).toMatchObject({
      full: false,
      refusedRequests: 1,
      stalled: false,
    });
    // Full again later, without a refusal since: not stalled.
    advance(2_001);
    resident(1_000);
    update();
    expect(watch.state()).toMatchObject({ full: true, stalled: false });
  });

  // Why: "stalled" means the tree cannot refine NOW. Once the library has
  // unloaded enough to make room, the next update queues again, so a
  // refusal a moment ago must not keep the warning up.
  it("stops reading stalled as soon as the cache has room again", () => {
    const { tiles, cache, watch, update, resident, unloaded } = setup();
    const big = resident(1_000);
    update(() => tiles.queueTileForDownload(unloaded()));
    expect(watch.state().stalled).toBe(true);
    cache.remove(big); // evicted with its bytes counted: room again
    expect(watch.state()).toMatchObject({
      full: false,
      refusedRequests: 1,
      stalled: false,
    });
  });

  // Why: the library also removes tiles in ordinary unloading (queued
  // tiles nobody wants any more, tiles evicted with their bytes counted,
  // failed loads); those are not refusals and must not raise the stall.
  it("does not count an ordinary removal as a refusal", () => {
    const { cache, watch, resident } = setup();
    const a = resident(1_000);
    const queued = { internal: { loadingState: 1 } };
    cache.maxBytesSize = 5_000;
    cache.add(queued, () => {});
    cache.maxBytesSize = 1_000;
    cache.remove(queued); // queued, never loaded
    cache.remove(a); // loaded with its bytes counted
    expect(watch.state()).toMatchObject({
      refusedRequests: 0,
      refusedLoads: 0,
      stalled: false,
    });
  });

  it("restores the cache's remove and stops listening on dispose", () => {
    const { tiles, cache, watch, update, resident, unloaded } = setup();
    const ownRemove = LRUCache.prototype.remove;
    expect(cache.remove).not.toBe(ownRemove);
    watch.dispose();
    expect(cache.remove).toBe(ownRemove);
    resident(1_000);
    update(() => tiles.queueTileForDownload(unloaded()));
    expect(watch.state().refusedRequests).toBe(0);
  });

  // Why: a cache far too small thrashes: the library unloads to its
  // floor, the update refills it and is refused again, so it reads with
  // room at almost any moment (the globe lab, 2026-10-18, 8 MiB: never
  // "full" when polled). Refusals that keep coming for a second or more
  // read as stalled, full or not; a single burst at the cap does not.
  it("reads stalled while refusals keep coming, even with room between them", () => {
    const { tiles, cache, watch, update, resident, unloaded, advance } =
      setup();
    const thrash = () => {
      const a = resident(1_000);
      update(() => tiles.queueTileForDownload(unloaded()));
      cache.remove(a); // unloaded to the floor: room again
    };
    thrash();
    expect(watch.state()).toMatchObject({ full: false, stalled: false });
    advance(600);
    thrash();
    advance(600);
    thrash();
    expect(watch.state()).toMatchObject({ full: false, stalled: true });
    // They stop: after the window, not stalled.
    advance(2_001);
    expect(watch.state()).toMatchObject({ full: false, stalled: false });
    // A new single burst starts a new run: not stalled.
    thrash();
    expect(watch.state().stalled).toBe(false);
  });

  it("refuses a negative or non-finite stall window", () => {
    for (const windowMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        watchReliefCache(new TilesRenderer() as DrivenTiles, { windowMs }),
      ).toThrow(RangeError);
    }
    expect(RELIEF_CACHE.stallWindowMs).toBeGreaterThan(
      RELIEF_CACHE.sustainedMs,
    );
  });
});

describe("the library's refusals (a guard)", () => {
  // Why: the watch reads the library's refusals, not its own guess of
  // them: `stats.refused` reset at the start of every traversing update
  // and raised for every tile the queue could not take, and the load
  // step's discard of a just-loaded tile. If a bump renames or moves them,
  // the stall would silently read "fine" again.
  it("still resets stats.refused per update and discards a late tile", () => {
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "node_modules",
        "3d-tiles-renderer",
        "src",
        "core",
        "renderer",
        "tiles",
        "TilesRendererBase.js",
      ),
      "utf8",
    );
    expect(source).toContain("stats.refused = 0;");
    expect(source).toContain(
      "stats.refused += queuedTiles.length - requested;",
    );
    expect(source).toContain(
      "if ( lruCache.getMemoryUsage( tile ) === 0 && bytesUsed > 0 && lruCache.isFull() ) {",
    );
    expect(source).toContain("this.frameCount ++;");
  });
});
