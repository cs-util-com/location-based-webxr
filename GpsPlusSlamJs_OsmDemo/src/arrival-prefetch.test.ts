/**
 * Why these tests matter: the arrival prefetch runs during the globe's
 * fly-in (round-5 plan 2026-10-01-0945 §3.6, DEC-GL5-8) and has one job:
 * leave OsmDemo's cache warm for the URL hand-over, without ever hurting
 * the flight. So the tests are about the cache it leaves behind (the keys
 * OsmDemo reads, through OsmDemo's own source) and about the things that
 * must never reach the caller: a dead network, a refused store, a cancel,
 * an invalid target. No test touches the network; `fetchImpl` is the seam.
 */

import { describe, expect, it, vi } from "vitest";
import {
  MemoryBlobStore,
  OVERPASS_SCHEMA_VERSION,
  type OsmBlobStore,
} from "gps-plus-slam-osm";

import { arrivalPlanFor } from "./arrival-plan.js";
import { startArrivalPrefetch } from "./arrival-prefetch.js";

const COLOGNE = { lat: 50.9413, lng: 6.9583 };
const PLAN = arrivalPlanFor(COLOGNE);
const osmKey = (tile: string) => `osm/v${OVERPASS_SCHEMA_VERSION}/${tile}`;

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

/** Answers Overpass POSTs with an empty tile and DEM GETs with 64 bytes. */
function healthyNetwork() {
  const posts: string[] = [];
  const gets: string[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if ((init?.method ?? "GET").toUpperCase() === "POST") {
      posts.push(urlOf(input));
      return Promise.resolve(
        new Response(JSON.stringify({ version: 0.6, elements: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    gets.push(urlOf(input));
    return Promise.resolve(new Response(new Uint8Array(64), { status: 200 }));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, posts, gets };
}

/** A network that never answers, but honours the abort signal. */
function hangingNetwork() {
  const signals: AbortSignal[] = [];
  const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    if (signal) signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, signals };
}

describe("a cold cache", () => {
  it("is left holding every key OsmDemo reads at arrival", async () => {
    const store = new MemoryBlobStore();
    const { fetchImpl, gets } = healthyNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, { store, fetchImpl });
    const report = await prefetch.finished;

    expect(report.outcome).toBe("settled");
    const keys = new Set(await store.keys());
    for (const tile of PLAN.overpassTiles) expect(keys).toContain(osmKey(tile));
    for (const url of PLAN.demUrls) expect(keys).toContain(url);
    expect(new Set(gets)).toEqual(new Set(PLAN.demUrls));
    expect(report.counts.overpass).toMatchObject({
      total: PLAN.overpassTiles.length,
      fetched: PLAN.overpassTiles.length,
      warm: 0,
      failed: 0,
    });
    expect(report.bytesStored).toBeGreaterThan(0);
    expect(prefetch.done).toBe(true);
    expect(prefetch.progress()).toBe(1);
  });

  it("reports progress that starts at 0 and never falls", async () => {
    const store = new MemoryBlobStore();
    const { fetchImpl } = healthyNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, { store, fetchImpl });
    expect(prefetch.progress()).toBe(0);
    expect(prefetch.done).toBe(false);
    let last = 0;
    while (!prefetch.done) {
      const now = prefetch.progress();
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(prefetch.progress()).toBe(1);
  });
});

describe("a warm cache", () => {
  it("costs no request at all and finishes at once", async () => {
    const store = new MemoryBlobStore();
    for (const tile of PLAN.overpassTiles) await store.put(osmKey(tile), "{}");
    for (const url of PLAN.demUrls) await store.put(url, "AAAA");
    const { fetchImpl } = healthyNetwork();
    const report = await startArrivalPrefetch(COLOGNE, { store, fetchImpl })
      .finished;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(report.counts.overpass.warm).toBe(PLAN.overpassTiles.length);
    expect(report.counts.dem.warm).toBe(PLAN.demUrls.length);
    expect(report.bytesStored).toBe(0);
  });

  it("fetches only what is missing", async () => {
    const store = new MemoryBlobStore();
    for (const tile of PLAN.overpassTiles) await store.put(osmKey(tile), "{}");
    const { fetchImpl, posts, gets } = healthyNetwork();
    const report = await startArrivalPrefetch(COLOGNE, { store, fetchImpl })
      .finished;
    expect(posts).toEqual([]);
    expect(gets.length).toBe(PLAN.demUrls.length);
    expect(report.counts.dem.fetched).toBe(PLAN.demUrls.length);
  });
});

describe("nothing reaches the caller", () => {
  it("a dead network settles every job as failed, without throwing", async () => {
    const store = new MemoryBlobStore();
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    ) as unknown as typeof fetch;
    const prefetch = startArrivalPrefetch(COLOGNE, { store, fetchImpl });
    const report = await prefetch.finished;
    expect(report.outcome).toBe("settled");
    expect(report.counts.overpass.failed).toBe(PLAN.overpassTiles.length);
    expect(report.counts.dem.failed).toBe(PLAN.demUrls.length);
    expect(prefetch.progress()).toBe(1);
    expect(await store.keys()).toEqual([]);
  }, 60_000);

  it("an HTTP error on a DEM tile is a failure, not a stored tile", async () => {
    const store = new MemoryBlobStore();
    for (const tile of PLAN.overpassTiles) await store.put(osmKey(tile), "{}");
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 503 })),
    ) as unknown as typeof fetch;
    const report = await startArrivalPrefetch(COLOGNE, { store, fetchImpl })
      .finished;
    expect(report.counts.dem.failed).toBe(PLAN.demUrls.length);
  });

  it("a store whose listing throws is read as empty, not as an error", async () => {
    const memory = new MemoryBlobStore();
    const store: OsmBlobStore = {
      get: (k) => memory.get(k),
      put: (k, v) => memory.put(k, v),
      delete: (k) => memory.delete(k),
      keys: () => Promise.reject(new Error("listing refused")),
    };
    const { fetchImpl } = healthyNetwork();
    const report = await startArrivalPrefetch(COLOGNE, { store, fetchImpl })
      .finished;
    expect(report.outcome).toBe("settled");
    expect(report.counts.overpass.fetched).toBe(PLAN.overpassTiles.length);
  });

  it("without a persistent store, it fetches nothing and is done", async () => {
    // Warming memory that dies with the page at the hand-over is pure
    // waste on donated infrastructure, so the prefetch declines.
    const { fetchImpl } = healthyNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, { store: null, fetchImpl });
    const report = await prefetch.finished;
    expect(report.outcome).toBe("no-persistent-store");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prefetch.progress()).toBe(1);
  });

  it.each([
    [{ lat: Number.NaN, lng: 0 }],
    [{ lat: 95, lng: 0 }],
    [undefined as unknown as { lat: number; lng: number }],
  ])("an invalid target %o is a finished no-op", async (target) => {
    const { fetchImpl } = healthyNetwork();
    const prefetch = startArrivalPrefetch(target, {
      store: new MemoryBlobStore(),
      fetchImpl,
    });
    expect((await prefetch.finished).outcome).toBe("invalid-target");
    expect(prefetch.done).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("cancelling", () => {
  it("abort() stops every request and finishes at once", async () => {
    const store = new MemoryBlobStore();
    const { fetchImpl, signals } = hangingNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, { store, fetchImpl });
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
    const before = prefetch.progress();
    prefetch.abort();
    const report = await prefetch.finished;
    expect(report.outcome).toBe("aborted");
    expect(prefetch.done).toBe(true);
    expect(signals.every((s) => s.aborted)).toBe(true);
    // Frozen where it was: the flight is being cancelled, not sped up.
    expect(prefetch.progress()).toBe(before);
    const callsAtAbort = vi.mocked(fetchImpl).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(callsAtAbort);
  });

  it("the caller's own signal aborts it too, even one aborted already", async () => {
    const { fetchImpl } = hangingNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, {
      store: new MemoryBlobStore(),
      fetchImpl,
      signal: AbortSignal.abort(),
    });
    expect((await prefetch.finished).outcome).toBe("aborted");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("abort() after the end changes nothing", async () => {
    const { fetchImpl } = healthyNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, {
      store: new MemoryBlobStore(),
      fetchImpl,
    });
    const report = await prefetch.finished;
    prefetch.abort();
    expect(report.outcome).toBe("settled");
    expect(prefetch.progress()).toBe(1);
  });
});
