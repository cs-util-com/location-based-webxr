/**
 * Caching-decorator tests.
 *
 * Why these tests matter:
 * The plan singles out one caching decision as the one that determines whether
 * the cache ever works at all: **key by the fixed H3 grid cell, never by the
 * query bbox.** A walking user generates a slightly different bbox every
 * second, so a bbox-keyed cache hits zero percent of the time while looking
 * entirely healthy — unbounded network cost with no error to notice. The first
 * describe block below is that guarantee.
 *
 * The rest cover the failure modes that turn a cache from a saving into a
 * liability: a corrupt entry that poisons a tile forever, a schema change that
 * silently serves non-equivalent data, and concurrent misses that stampede the
 * network.
 *
 * @see caching-source.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import { latLngToCell } from "h3-js";
import { CachingSource } from "./caching-source.js";
import { MemoryBlobStore } from "./memory-blob-store.js";
import type { OsmDataSource, OsmTileResult } from "./osm-data-source.js";
import { FETCH_RES } from "../spatial/resolutions.js";

const TILE = latLngToCell(50.9413, 6.9583, FETCH_RES);
const TILE_B = latLngToCell(52.52, 13.405, FETCH_RES);

/** Counting fake: the only thing that knows whether "the network" was used. */
class CountingSource implements OsmDataSource {
  readonly attribution = "© OpenStreetMap contributors";
  readonly sourceId = "counting";
  calls = 0;
  constructor(private readonly fetchedAt = 1000) {}

  fetchTile(tile: string): Promise<OsmTileResult> {
    this.calls++;
    return Promise.resolve({
      tile,
      features: [
        {
          type: "node",
          id: this.calls,
          position: { lat: 1, lng: 2 },
          tags: {},
        },
      ],
      fetchedAt: this.fetchedAt,
      sourceId: this.sourceId,
      schemaVersion: 1,
      skipped: [],
    });
  }
}

describe("the cache key — the decision the whole cache rests on", () => {
  it("is the H3 cell id plus a schema version, never a bbox", () => {
    const cache = new CachingSource(
      new CountingSource(),
      new MemoryBlobStore(),
    );
    expect(cache.cacheKey(TILE)).toBe(`osm/v1/${TILE}`);
  });

  it("is stable across repeated calls — this is what makes a walking user hit cache", async () => {
    // The regression this guards: keying by the query bbox. Every GPS update
    // shifts the bbox slightly, so every request would miss while the cache
    // grew forever and looked like it was working.
    const inner = new CountingSource();
    const cache = new CachingSource(inner, new MemoryBlobStore());

    for (let i = 0; i < 25; i++) {
      await cache.fetchTile(TILE);
    }
    expect(inner.calls).toBe(1);
    expect(cache.stats.hits).toBe(24);
  });

  it("changes with the schema version, so a changed query never reuses old tiles", async () => {
    const store = new MemoryBlobStore();
    const innerV1 = new CountingSource();
    await new CachingSource(innerV1, store, { schemaVersion: 1 }).fetchTile(
      TILE,
    );

    const innerV2 = new CountingSource();
    await new CachingSource(innerV2, store, { schemaVersion: 2 }).fetchTile(
      TILE,
    );

    expect(innerV1.calls).toBe(1);
    expect(innerV2.calls).toBe(1); // did NOT reuse the v1 entry
    expect(store.size).toBe(2);
  });

  it("ignores a cached entry whose stored schemaVersion disagrees with the key", async () => {
    // Belt and braces: the version is in the key AND checked in the payload,
    // because a store shared between package versions could return a v1 blob
    // under a v2 key after a manual migration.
    const store = new MemoryBlobStore();
    await store.put(
      "osm/v1/" + TILE,
      JSON.stringify({
        tile: TILE,
        features: [],
        fetchedAt: 1,
        sourceId: "x",
        schemaVersion: 99,
      }),
    );
    const inner = new CountingSource();
    await new CachingSource(inner, store).fetchTile(TILE);
    expect(inner.calls).toBe(1);
  });
});

describe("cache-first behaviour", () => {
  it("hits the network exactly once for two identical requests", async () => {
    const inner = new CountingSource();
    const cache = new CachingSource(inner, new MemoryBlobStore());

    await cache.fetchTile(TILE);
    await cache.fetchTile(TILE);

    expect(inner.calls).toBe(1);
    expect(cache.stats.misses).toBe(1);
    expect(cache.stats.hits).toBe(1);
  });

  it("fetches each distinct tile once", async () => {
    const inner = new CountingSource();
    const cache = new CachingSource(inner, new MemoryBlobStore());

    await cache.fetchTile(TILE);
    await cache.fetchTile(TILE_B);
    await cache.fetchTile(TILE);

    expect(inner.calls).toBe(2);
  });

  it("preserves the ORIGINAL fetchedAt through the cache, not the read time", async () => {
    // Provenance must describe when the DATA was retrieved, not when it was
    // last read. A consumer showing "OSM data from March 2026" would otherwise
    // always claim the data is current.
    const inner = new CountingSource(1234);
    const cache = new CachingSource(inner, new MemoryBlobStore(), {
      now: () => 9_999_999,
    });

    await cache.fetchTile(TILE);
    const cached = await cache.fetchTile(TILE);
    expect(cached.fetchedAt).toBe(1234);
  });

  it("deduplicates concurrent misses for the same tile into one downstream call", async () => {
    const inner = new CountingSource();
    const cache = new CachingSource(inner, new MemoryBlobStore());

    const [a, b, c] = await Promise.all([
      cache.fetchTile(TILE),
      cache.fetchTile(TILE),
      cache.fetchTile(TILE),
    ]);

    expect(inner.calls).toBe(1);
    expect(cache.stats.deduplicated).toBe(2);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("staleness is the consumer’s policy, never the library’s", () => {
  it("serves indefinitely when no maxAgeMs is given", async () => {
    const inner = new CountingSource(0);
    const cache = new CachingSource(inner, new MemoryBlobStore(), {
      now: () => 10 ** 12, // decades later
    });

    await cache.ensureTile(TILE);
    await cache.ensureTile(TILE);
    expect(inner.calls).toBe(1);
  });

  it("refetches when the caller asks for a maxAgeMs the entry exceeds", async () => {
    // The counter-case to "stale is fine": an AR overlay showing a building
    // demolished two years ago is a bug, so the consumer must be able to force
    // a refresh — per call, without the library ever expiring on its own.
    const inner = new CountingSource(0);
    const cache = new CachingSource(inner, new MemoryBlobStore(), {
      now: () => 60_000,
    });

    await cache.ensureTile(TILE);
    await cache.ensureTile(TILE, { maxAgeMs: 1000 });

    expect(inner.calls).toBe(2);
    expect(cache.stats.staleRefetches).toBe(1);
  });

  it("keeps serving a fresh-enough entry under maxAgeMs", async () => {
    const inner = new CountingSource(0);
    const cache = new CachingSource(inner, new MemoryBlobStore(), {
      now: () => 500,
    });

    await cache.ensureTile(TILE);
    await cache.ensureTile(TILE, { maxAgeMs: 10_000 });
    expect(inner.calls).toBe(1);
  });
});

describe("a broken cache entry must never poison a tile", () => {
  it.each([
    ["truncated JSON", '{"tile":"abc",'],
    ["valid JSON of the wrong shape", '{"hello":"world"}'],
    ["a JSON array", "[]"],
    ["null", "null"],
    ["empty string", ""],
  ])("treats %s as a miss and refetches", async (_label, stored) => {
    const store = new MemoryBlobStore();
    await store.put(`osm/v1/${TILE}`, stored);
    const inner = new CountingSource();

    const result = await new CachingSource(inner, store).fetchTile(TILE);

    expect(inner.calls).toBe(1);
    expect(result.tile).toBe(TILE);
  });

  it("treats a throwing store as a miss rather than propagating", async () => {
    // Quota-exceeded and permission-revoked both throw on read. One refetch is
    // cheap; a thrown error here would break the whole working set.
    const store = new MemoryBlobStore();
    vi.spyOn(store, "get").mockRejectedValue(new Error("QuotaExceededError"));
    const inner = new CountingSource();

    await expect(
      new CachingSource(inner, store).fetchTile(TILE),
    ).resolves.toMatchObject({ tile: TILE });
    expect(inner.calls).toBe(1);
  });
});

describe("eviction is the host application’s job", () => {
  it("lists cached tiles as bare cell ids", async () => {
    const cache = new CachingSource(
      new CountingSource(),
      new MemoryBlobStore(),
    );
    await cache.fetchTile(TILE);
    await cache.fetchTile(TILE_B);

    expect((await cache.listCachedTiles()).sort()).toEqual(
      [TILE, TILE_B].sort(),
    );
  });

  it("does not list entries belonging to another schema version", async () => {
    const store = new MemoryBlobStore();
    await store.put("osm/v2/other", "{}");
    const cache = new CachingSource(new CountingSource(), store);
    await cache.fetchTile(TILE);

    expect(await cache.listCachedTiles()).toEqual([TILE]);
  });

  it("evicts only the named tile, and the next request refetches it", async () => {
    const inner = new CountingSource();
    const cache = new CachingSource(inner, new MemoryBlobStore());
    await cache.fetchTile(TILE);
    await cache.fetchTile(TILE_B);

    await cache.evictTile(TILE);

    expect(await cache.listCachedTiles()).toEqual([TILE_B]);
    await cache.fetchTile(TILE);
    expect(inner.calls).toBe(3);
  });

  it("never evicts on its own, however many tiles accumulate", async () => {
    const store = new MemoryBlobStore();
    const cache = new CachingSource(new CountingSource(), store);
    for (let i = 0; i < 50; i++) {
      await cache.fetchTile(latLngToCell(50 + i * 0.05, 6.9, FETCH_RES));
    }
    expect(store.size).toBe(50);
  });
});

describe("decorator transparency", () => {
  it("passes the inner source’s attribution through unchanged", () => {
    const inner = new CountingSource();
    const cache = new CachingSource(inner, new MemoryBlobStore());
    expect(cache.attribution).toBe(inner.attribution);
  });

  it("marks its own sourceId as wrapping the inner one", () => {
    const cache = new CachingSource(
      new CountingSource(),
      new MemoryBlobStore(),
    );
    expect(cache.sourceId).toBe("cached(counting)");
  });

  it("forwards the AbortSignal to the inner source", async () => {
    const inner = new CountingSource();
    const spy = vi.spyOn(inner, "fetchTile");
    const cache = new CachingSource(inner, new MemoryBlobStore());
    const controller = new AbortController();

    await cache.fetchTile(TILE, controller.signal);
    expect(spy).toHaveBeenCalledWith(TILE, controller.signal);
  });
});
