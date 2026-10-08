/**
 * Why these tests matter: OsmDemo's worker and the globe's arrival prefetch
 * (round-5 plan 2026-10-01-0945 §3.6) must write the SAME cache, or the
 * prefetch warms a store OsmDemo never reads and the "warm" second visit is
 * silently cold. This module is the one place both build the store and the
 * tile source from, so these tests pin what "the same" means: the same OPFS
 * directory, the same cache key, the same identifying user agent. And the
 * fallback has to be explicit: without OPFS the worker still needs a store
 * (a memory one), while the prefetch needs to KNOW there is no persistent
 * one, because warming memory that dies with the page is pure waste.
 */

import { describe, expect, it, vi } from "vitest";
import { MemoryBlobStore, OVERPASS_SCHEMA_VERSION } from "gps-plus-slam-osm";
import { OpfsOsmBlobStore } from "gps-plus-slam-app-framework/osm-bridge";

import {
  OSM_DEMO_USER_AGENT,
  createOsmTileSource,
  openOsmStore,
} from "./osm-tile-cache.js";

/** A StorageManager whose OPFS root hands out empty directories. */
function fakeStorage(): StorageManager {
  const directory = {
    getDirectoryHandle: vi.fn(() => Promise.resolve(directory)),
  };
  return {
    getDirectory: () => Promise.resolve(directory),
  } as unknown as StorageManager;
}

describe("openOsmStore (the worker's store)", () => {
  it("falls back to memory rather than refusing to start", async () => {
    const store = await openOsmStore({ storage: undefined });
    expect(store).toBeInstanceOf(MemoryBlobStore);
  });

  it("is the persistent store when OPFS is there", async () => {
    expect(await openOsmStore({ storage: fakeStorage() })).toBeInstanceOf(
      OpfsOsmBlobStore,
    );
  });
});

describe("createOsmTileSource", () => {
  it("keys tiles as OsmDemo reads them and identifies the demo", async () => {
    const store = new MemoryBlobStore();
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ version: 0.6, elements: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const source = createOsmTileSource(store, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(source.cacheKey("871fa199affffff")).toBe(
      `osm/v${OVERPASS_SCHEMA_VERSION}/871fa199affffff`,
    );
    await source.fetchTile("871fa199affffff");
    expect(await store.keys()).toEqual([
      `osm/v${OVERPASS_SCHEMA_VERSION}/871fa199affffff`,
    ]);
    const init = fetchImpl.mock.calls[0]?.at(1) as RequestInit | undefined;
    expect(new Headers(init?.headers).get("User-Agent")).toBe(
      OSM_DEMO_USER_AGENT,
    );
  });
});
