/**
 * Why these tests matter: the arrival prefetch runs during the globe's
 * fly-in (round-5 plan 2026-10-01-0945 §3.6, DEC-GL5-8) and has one job:
 * leave OsmDemo's cache warm for the URL hand-over, without ever hurting
 * the flight. So the tests are about the cache it leaves behind (the keys
 * OsmDemo reads, through OsmDemo's own source) and about the things that
 * must never reach the caller: a dead network, a refused store, a cancel,
 * an invalid target. No test touches the network; `fetchImpl` is the seam.
 */

import { cellToLatLng } from "h3-js";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryBlobStore,
  OVERPASS_SCHEMA_VERSION,
  type OsmBlobStore,
} from "gps-plus-slam-osm";

import { arrivalPlanFor } from "./arrival-plan.js";
import {
  startArrivalPrefetch,
  type ArrivalPrefetchOutcome,
  type ArrivalPrefetchReport,
} from "./arrival-prefetch.js";

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
    // Typed as the lab reads it: the report is the module's public result.
    const report: ArrivalPrefetchReport = await prefetch.finished;
    const settled: ArrivalPrefetchOutcome = "settled";

    expect(report.outcome).toBe(settled);
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

describe("one Overpass tile at a time, nearest first", () => {
  // Why: OsmDemo's own foreground fetch takes one tile at a time
  // (`FETCH_CONCURRENCY` 1 in `demo-pipeline.ts`) so the source's two slots
  // race that tile at two operators; a pool of two would spend them on two
  // unraced tiles and hold two 21 MB tiles in memory at once. Plan order is
  // ring order, so the tile under the target is warmed first.
  const THREE_TILES = { lat: 50.9, lng: 6.9511 };
  const plan = arrivalPlanFor(THREE_TILES);

  /** Which plan tile an Overpass POST asks for, from its bbox. */
  function tileOf(init: RequestInit | undefined): string {
    const query =
      new URLSearchParams(typeof init?.body === "string" ? init.body : "").get(
        "data",
      ) ?? "";
    const m = /\[bbox:([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/.exec(query);
    if (m === null) throw new Error(`no bbox in ${query.slice(0, 80)}`);
    const [s, w, n, e] = m.slice(1).map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const inside = plan.overpassTiles.filter((tile) => {
      const [lat, lng] = cellToLatLng(tile);
      return lat > s && lat < n && lng > w && lng < e;
    });
    if (inside.length !== 1) throw new Error(`bbox matches ${inside.length}`);
    return inside[0]!;
  }

  it("never has two tiles in flight, and asks in plan order", async () => {
    expect(plan.overpassTiles.length).toBe(3);
    const store = new MemoryBlobStore();
    for (const url of plan.demUrls) await store.put(url, "AAAA");
    const pending: { tile: string; release: () => void }[] = [];
    const firstAsked: string[] = [];
    let maxTilesInFlight = 0;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const tile = tileOf(init);
      if (!firstAsked.includes(tile)) firstAsked.push(tile);
      return new Promise<Response>((resolve, reject) => {
        const entry = {
          tile,
          release: () =>
            resolve(
              new Response(JSON.stringify({ version: 0.6, elements: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            ),
        };
        pending.push(entry);
        maxTilesInFlight = Math.max(
          maxTilesInFlight,
          new Set(pending.map((p) => p.tile)).size,
        );
        init?.signal?.addEventListener("abort", () => {
          pending.splice(pending.indexOf(entry), 1);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as unknown as typeof fetch;

    const prefetch = startArrivalPrefetch(THREE_TILES, { store, fetchImpl });
    while (!prefetch.done) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const next = pending.shift();
      next?.release();
    }
    expect(maxTilesInFlight).toBe(1);
    expect(firstAsked).toEqual(plan.overpassTiles);
    expect((await prefetch.finished).counts.overpass.fetched).toBe(3);
  });
});

describe("a store that cannot keep what it is given", () => {
  // Why: warming is worth ~21 MB of donated bandwidth a tile only if the
  // bytes stay. An OPFS store that is there but cannot write (quota, a
  // revoked handle) swallows each failed write by design, so without a
  // probe the prefetch would pull every tile and report it as warm.
  function storeThatDropsWrites(): OsmBlobStore {
    const keys: string[] = [];
    return {
      get: () => Promise.resolve(undefined),
      put: (key) => {
        keys.push(key);
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
      keys: () => Promise.resolve([]),
    };
  }

  it("declines after a failed write probe, fetching nothing", async () => {
    const { fetchImpl } = healthyNetwork();
    const prefetch = startArrivalPrefetch(COLOGNE, {
      store: storeThatDropsWrites(),
      fetchImpl,
    });
    expect((await prefetch.finished).outcome).toBe("store-unwritable");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(prefetch.progress()).toBe(1);
  });

  it("counts a job whose write failed as failed, not fetched", async () => {
    // The probe passes; then every tile write fails the way the OPFS store
    // reports it: swallowed, with its error counter raised.
    const memory = new MemoryBlobStore();
    let failWrites = false;
    const stats = { errors: 0 };
    const store: OsmBlobStore & { stats: { errors: number } } = {
      stats,
      get: (k) => memory.get(k),
      put: async (k, v) => {
        if (failWrites) {
          stats.errors += 1;
          return;
        }
        await memory.put(k, v);
      },
      delete: (k) => memory.delete(k),
      keys: () => memory.keys(),
    };
    const { fetchImpl } = healthyNetwork();
    const wrapped = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      failWrites = true;
      return fetchImpl(input, init);
    }) as unknown as typeof fetch;
    const report = await startArrivalPrefetch(COLOGNE, {
      store,
      fetchImpl: wrapped,
    }).finished;
    expect(report.outcome).toBe("settled");
    expect(report.counts.overpass.failed).toBe(PLAN.overpassTiles.length);
    expect(report.counts.overpass.fetched).toBe(0);
    expect(report.counts.dem.failed).toBe(PLAN.demUrls.length);
    expect(report.writeFailures).toBe(
      PLAN.overpassTiles.length + PLAN.demUrls.length,
    );
  });
});
