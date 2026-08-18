/**
 * Caching tile-fetch tests.
 *
 * Why these tests matter:
 * `createCachingTileFetch` is what makes elevation survive an offline restart —
 * without it the provider's only cache is a 64-tile in-memory Map, so an
 * offline cold start has no terrain and the failure mode is a silently wrong
 * flat datum, not an error. These tests pin the three behaviours that decide
 * whether the wrapper is a cache or a liability:
 *
 * 1. **The caller's body is never consumed.** The wrapper snapshots bytes for
 *    the store from a clone; a wrapper that read the body it hands back would
 *    make every miss throw "body already used" downstream.
 * 2. **A failed store WRITE must not lose the paid-for tile.** The same bug was
 *    fixed once for OSM tiles (`CachingSource.fetchAndStore`): a full disk used
 *    to discard a fetched tile and render nothing. Mirrored here.
 * 3. **Only a 200 is persisted.** Caching a 404 or an error page as tile bytes
 *    would poison the URL forever, since v1 deliberately never invalidates.
 *
 * @see caching-tile-fetch.ts.md
 */

import { describe, it, expect } from "vitest";
import { createCachingTileFetch } from "./caching-tile-fetch.js";
import { MemoryBlobStore } from "../source/memory-blob-store.js";

const URL_A = "https://tiles.example/13/4300/2740.png";
const URL_B = "https://tiles.example/13/4301/2740.png";

const BYTES_A = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
const BYTES_B = new Uint8Array([137, 80, 78, 71, 9, 8, 7]);

/** Counting fake network: the only thing that knows whether it was used. */
function countingNetwork(
  bytesFor: (url: string) => Uint8Array | undefined = defaultBytes,
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl: typeof fetch = (input, _init) => {
    const url = urlOf(input);
    calls.push(url);
    const bytes = bytesFor(url);
    if (bytes === undefined) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    // A fresh copy per response, so a wrapper that mutated bytes would be seen.
    return Promise.resolve(new Response(bytes.slice(), { status: 200 }));
  };
  return { impl, calls };
}

function defaultBytes(url: string): Uint8Array | undefined {
  if (url === URL_A) return BYTES_A;
  if (url === URL_B) return BYTES_B;
  return undefined;
}

function urlOf(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
}

describe("store hit", () => {
  it("serves the stored bytes without touching the network", async () => {
    const store = new MemoryBlobStore();
    const first = countingNetwork();
    await createCachingTileFetch({ store, fetchImpl: first.impl })(URL_A);
    expect(first.calls).toEqual([URL_A]);

    // A NEW wrapper over the same store — the offline-restart scenario: the
    // in-memory state is gone, only the persisted bytes remain.
    const second = countingNetwork();
    const cachingFetch = createCachingTileFetch({
      store,
      fetchImpl: second.impl,
    });
    const response = await cachingFetch(URL_A);

    expect(second.calls).toEqual([]);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES_A);
    expect(cachingFetch.stats).toEqual({
      hits: 1,
      misses: 0,
      storeFailures: 0,
    });
  });

  it("marks the synthetic response so diagnostics can tell hit from network", async () => {
    const store = new MemoryBlobStore();
    const { impl } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    const miss = await cachingFetch(URL_A);
    expect(miss.headers.get("x-tile-cache")).toBeNull();

    const hit = await cachingFetch(URL_A);
    expect(hit.headers.get("x-tile-cache")).toBe("hit");
  });
});

describe("store miss", () => {
  it("fetches, persists exactly the fetched bytes under the full URL, and returns them", async () => {
    const store = new MemoryBlobStore();
    const { impl, calls } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    const response = await cachingFetch(URL_A);

    expect(calls).toEqual([URL_A]);
    // The body is not double-consumed: the CALLER can still read it fully even
    // though the wrapper also snapshotted it for the store.
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES_A);
    expect(cachingFetch.stats).toEqual({
      hits: 0,
      misses: 1,
      storeFailures: 0,
    });

    // Persisted under the full request URL — asserted via the store directly so
    // a silently different key scheme cannot pass by round-tripping.
    expect(await store.keys()).toEqual([URL_A]);
    // And the persisted copy really is the canonical bytes: a second wrapper
    // must serve them back identically without the network.
    const replay = createCachingTileFetch({
      store,
      fetchImpl: countingNetwork(() => undefined).impl,
    });
    const cached = await replay(URL_A);
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(BYTES_A);
  });

  it("round-trips a multi-chunk payload byte-exactly", async () => {
    // WHY THIS TEST MATTERS. `toBase64` walks the bytes in 0x8000-element
    // chunks to stay under `String.fromCharCode`'s argument-count limit — a
    // real 512-px WebP tile is comfortably past one chunk, while every other
    // test here uses a handful of bytes and would never enter the loop's
    // second iteration. 100 000 bytes (> 3 chunks) covering every value
    // 0x00..0xFF pins that chunk boundaries neither drop, duplicate, nor
    // reorder bytes — a corruption that would decode into plausible but wrong
    // terrain, the exact failure this module must not produce.
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const store = new MemoryBlobStore();
    const first = createCachingTileFetch({
      store,
      fetchImpl: countingNetwork(() => bytes).impl,
    });
    await first(URL_A);
    expect(first.stats.storeFailures).toBe(0);

    // A second wrapper over the same store: the replay can only come from the
    // persisted base64, so equality here is equality through the round trip.
    const replay = createCachingTileFetch({
      store,
      fetchImpl: countingNetwork(() => undefined).impl,
    });
    const cached = await replay(URL_A);
    expect(cached.headers.get("x-tile-cache")).toBe("hit");
    expect(new Uint8Array(await cached.arrayBuffer())).toEqual(bytes);
  });

  it("accepts URL and Request inputs and keys them identically to the string form", async () => {
    const store = new MemoryBlobStore();
    const { impl, calls } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    await cachingFetch(new URL(URL_A));
    await cachingFetch(new Request(URL_A));
    await cachingFetch(URL_A);

    // One network call: the URL object populated the store, the rest hit.
    expect(calls).toEqual([URL_A]);
    expect(cachingFetch.stats.hits).toBe(2);
  });
});

describe("non-200 responses and network errors pass through untouched", () => {
  it("passes a 404 through and stores nothing", async () => {
    const store = new MemoryBlobStore();
    const { impl, calls } = countingNetwork(() => undefined);
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    const response = await cachingFetch(URL_A);
    expect(response.status).toBe(404);
    expect(store.size).toBe(0);

    // Not cached: the next call asks the network again — a transient 404 must
    // not poison the URL in a cache that never invalidates.
    await cachingFetch(URL_A);
    expect(calls).toEqual([URL_A, URL_A]);
  });

  it("propagates a network error and stores nothing", async () => {
    const store = new MemoryBlobStore();
    const failing: typeof fetch = () =>
      Promise.reject(new TypeError("network down"));
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: failing });

    await expect(cachingFetch(URL_A)).rejects.toThrow("network down");
    expect(store.size).toBe(0);
    expect(cachingFetch.stats.storeFailures).toBe(0);
  });
});

describe("a failing store degrades, never discards", () => {
  it("returns the fetched tile even when the store write fails, and counts it", async () => {
    // The regression this mirrors: a full disk once DISCARDED a fetched OSM
    // tile because the cache write rejected after the network had already paid
    // for it. A storage problem must never become a data problem.
    const store = new MemoryBlobStore();
    store.put = () => Promise.reject(new Error("quota exceeded"));
    const { impl } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    const response = await cachingFetch(URL_A);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES_A);
    expect(cachingFetch.stats.storeFailures).toBe(1);
  });

  it("falls back to the network when the store read fails", async () => {
    const store = new MemoryBlobStore();
    store.get = () => Promise.reject(new Error("permission revoked"));
    const { impl, calls } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    const response = await cachingFetch(URL_A);

    expect(calls).toEqual([URL_A]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES_A);
  });

  it("treats a corrupt stored entry as a miss rather than serving garbage", async () => {
    // An interrupted write can leave a value that is not valid base64. The
    // cost of treating it as a miss is one refetch; the cost of serving it is
    // corrupt terrain presented as plausible data.
    const store = new MemoryBlobStore();
    await store.put(URL_A, "%%% not base64 %%%");
    const { impl, calls } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    const response = await cachingFetch(URL_A);

    expect(calls).toEqual([URL_A]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES_A);
  });
});

describe("scope guards", () => {
  it("bypasses the cache entirely for non-GET requests", async () => {
    // The wrapper is fetch-compatible, so a consumer could route anything
    // through it; serving a POST's answer from a byte cache would be wrong in
    // every way. Non-GET delegates untouched and stores nothing.
    const store = new MemoryBlobStore();
    const { impl, calls } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });

    await cachingFetch(URL_A, { method: "POST" });
    await cachingFetch(URL_A, { method: "POST" });

    expect(calls).toEqual([URL_A, URL_A]);
    expect(store.size).toBe(0);
    expect(cachingFetch.stats).toEqual({
      hits: 0,
      misses: 0,
      storeFailures: 0,
    });
  });

  it("rejects with an abort error for an already-aborted signal, even on a hit", async () => {
    // Real fetch rejects before touching the network; the synthetic-hit path
    // must not be MORE alive than the network path it stands in for.
    const store = new MemoryBlobStore();
    const { impl } = countingNetwork();
    const cachingFetch = createCachingTileFetch({ store, fetchImpl: impl });
    await cachingFetch(URL_A); // populate

    const controller = new AbortController();
    controller.abort();
    await expect(
      cachingFetch(URL_A, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
