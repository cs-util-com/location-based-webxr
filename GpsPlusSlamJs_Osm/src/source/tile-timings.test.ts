/**
 * `OsmTileResult.timings` — the fetch/parse split, and the traps in it.
 *
 * Why these tests matter: the click-path stage-timing plan predicts that PARSE,
 * not network, dominates a warm-cache click, and the only way to find out is to
 * time them apart. Every assertion here exists because getting one of these
 * wrong produces a breakdown that looks plausible and points at the wrong
 * stage — which is worse than no breakdown, because it gets acted on.
 *
 * The four traps, each pinned below:
 *
 *  1. **Persisted timings.** `CachingSource` serialises the whole result into
 *     OPFS. A `timings` left on it comes back on every later hit, so the warm
 *     path reports the original network fetch forever and parse — the term the
 *     plan is hunting — is measured on the wrong path.
 *  2. **`parseMs: 0` vs absent.** Zero is the true answer on a cache hit
 *     (`parseOverpassJson` does not run); absent means nobody measured. A
 *     consumer that cannot tell them apart cannot reconcile a breakdown.
 *  3. **Joiners.** `InFlightRequests` gives N callers one delivery. A caller
 *     that waited 200 ms on someone else's slow fetch did not spend that time.
 *  4. **Queueing before transport.** The concurrency limiter makes callers wait
 *     before any request is built. Folded into transport it reads as a slow
 *     server; dropped, it reads as time that never happened.
 *
 * Every clock here is injected and advances by a fixed step per read, so each
 * stage's duration is exactly attributable — a test that asserts "some number
 * appeared" would pass against an instrument that timed the wrong interval.
 *
 * @see osm-data-source.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import { latLngToCell } from "h3-js";
import { OverpassSource } from "./overpass-source.js";
import { CachingSource } from "./caching-source.js";
import { MemoryBlobStore } from "./memory-blob-store.js";
import { FixtureSource } from "./fixture-source.js";
import { OVERPASS_SCHEMA_VERSION } from "./overpass-query.js";
import type {
  OsmDataSource,
  OsmTileResult,
  OsmTileTimings,
} from "./osm-data-source.js";
import { FETCH_RES } from "../spatial/resolutions.js";

const TILE = latLngToCell(50.9413, 6.9583, FETCH_RES);

const OK_BODY = {
  version: 0.6,
  elements: [
    { type: "node", id: 1, lat: 50.94, lon: 6.95, tags: { amenity: "bench" } },
  ],
};

/**
 * A clock that advances a fixed amount per READ.
 *
 * Deliberately not a settable fake: the point is that every start/stop pair
 * lands on a distinct value, so an instrument whose stop is on the wrong side
 * of an `await` produces a wrong duration rather than a plausible one.
 */
function steppingClock(stepMs: number, start = 0) {
  let t = start;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSource(overrides: Record<string, unknown> = {}) {
  return new OverpassSource({
    userAgent: "gps-plus-slam-osm-tests/1.0 (+https://example.invalid)",
    fetchImpl: vi.fn().mockResolvedValue(jsonResponse(OK_BODY)),
    random: () => 0,
    now: () => 1_000_000,
    monotonicNow: steppingClock(10),
    sleepImpl: () => Promise.resolve(),
    ...overrides,
  });
}

describe("OverpassSource fills timings for a network delivery", () => {
  it("reports the three costs separately, each with its own interval", async () => {
    // The whole reason for the field. `parseOverpassJson` and `JSON.parse` are
    // different costs over the same bytes, and §3 of the plan predicts one of
    // them dominates a warm click — a single `parseMs` covering both would rank
    // them together and name neither.
    const source = makeSource();
    const result = await source.fetchTile(TILE);

    expect(result.timings?.servedBy).toBe("network");
    // Each stage read the stepping clock twice, so each is exactly one step.
    expect(result.timings?.transportMs).toBeGreaterThan(0);
    expect(result.timings?.decodeMs).toBeGreaterThan(0);
    expect(result.timings?.parseMs).toBeGreaterThan(0);
    expect(result.timings?.attempts).toBe(1);
  });

  it("counts retry attempts, so a slow transport can be told from a sleeping one", async () => {
    // `transportMs` deliberately spans the retry loop including its backoff
    // sleeps. Without the attempt count, three retries and one slow server are
    // the same number — and they have opposite remedies.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 502 }))
      .mockResolvedValue(jsonResponse(OK_BODY));
    const source = makeSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await source.fetchTile(TILE);
    expect(result.timings?.attempts).toBe(2);
  });

  it("charges queueing to slotWaitMs, never to transport", async () => {
    // Trap 4. With `maxConcurrent: 1` the second caller waits for the first to
    // finish before its request is even built. That wait is real time the user
    // spends, and it belongs to neither the server nor the parser.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) await gate;
      return jsonResponse(OK_BODY);
    });
    const source = makeSource({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxConcurrent: 1,
    });

    const first = source.fetchTile(TILE);
    const secondTile = latLngToCell(52.52, 13.405, FETCH_RES);
    const second = source.fetchTile(secondTile);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.timings?.slotWaitMs).toBe(0);
    expect(b.timings?.slotWaitMs).toBeGreaterThan(0);
  });

  it("gives a joined caller its own timings, not the fetch it rode along on", async () => {
    // Trap 3. Both callers get the same features; they did NOT both pay the
    // same cost, and a breakdown that says they did overstates the fetch stage
    // by however many callers happened to collide.
    const source = makeSource();
    const [a, b] = await Promise.all([
      source.fetchTile(TILE),
      source.fetchTile(TILE),
    ]);

    const kinds = [a.timings?.servedBy, b.timings?.servedBy].sort();
    expect(kinds).toEqual(["joined", "network"]);
    expect(a.features).toEqual(b.features);
  });
});

describe("a source that does not measure omits the field entirely", () => {
  it("leaves FixtureSource results with no timings at all", async () => {
    // Trap 2, the "absent" half. A fixture is instant, so zeros would be
    // defensible-looking and wrong: the honest statement is that nothing here
    // was measured, and the breakdown must be able to say so rather than
    // silently attributing 0 ms to a stage it never observed.
    //
    // Both branches, because the empty-tile path builds its own result object
    // and is the one a working-set test hits most.
    const source = new FixtureSource([
      { name: "one", tile: TILE, capturedAt: 0, payload: OK_BODY },
    ]);
    expect((await source.fetchTile(TILE)).timings).toBeUndefined();
    const elsewhere = latLngToCell(52.52, 13.405, FETCH_RES);
    expect((await source.fetchTile(elsewhere)).timings).toBeUndefined();
  });

  it("keeps an unmeasured source unmeasured through the cache, apart from the write", async () => {
    // The composition that could quietly invent a measurement: `CachingSource`
    // adds `storeMs`, and doing that unconditionally would give a source that
    // measures nothing a partial timings object — zeros for four stages it
    // never observed, which is precisely the absent-vs-zero confusion the
    // whole field is shaped to avoid.
    const store = new MemoryBlobStore();
    const cached = new CachingSource(
      new FixtureSource([
        { name: "one", tile: TILE, capturedAt: 0, payload: OK_BODY },
      ]),
      store,
    );
    expect((await cached.fetchTile(TILE)).timings).toBeUndefined();
  });
});

/** A source whose timings are unmistakably "the network", for cache tests. */
class TimedSource implements OsmDataSource {
  readonly attribution = "© OpenStreetMap contributors";
  readonly sourceId = "timed";
  calls = 0;

  fetchTile(tile: string): Promise<OsmTileResult> {
    this.calls++;
    return Promise.resolve({
      tile,
      features: [
        { type: "node", id: 1, position: { lat: 1, lng: 2 }, tags: {} },
      ],
      fetchedAt: 1000,
      sourceId: this.sourceId,
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: [],
      timings: NETWORK_TIMINGS,
    });
  }
}

/**
 * An unmistakably-network delivery, typed rather than inferred.
 *
 * The annotation is what makes a field rename fail HERE, in the fixture that
 * every cache assertion below is written against, instead of silently producing
 * a structurally-different object that the assertions then pass on.
 */
const NETWORK_TIMINGS: OsmTileTimings = {
  servedBy: "network",
  slotWaitMs: 0,
  transportMs: 60_000,
  decodeMs: 2_000,
  parseMs: 3_000,
  attempts: 1,
};

describe("CachingSource keeps timings out of the cache", () => {
  it("does not persist them — a stored blob describes a tile, not a fetch", async () => {
    // Trap 1, at the source. `store.put` takes `JSON.stringify(result)`, so
    // this is one keystroke away from being wrong and produces no error when
    // it is.
    const store = new MemoryBlobStore();
    const cached = new CachingSource(new TimedSource(), store);
    await cached.fetchTile(TILE);

    const raw = await store.get(cached.cacheKey(TILE));
    expect(raw).toBeDefined();
    expect(JSON.parse(raw as string)).not.toHaveProperty("timings");
  });

  it("reports a HIT with its own cost, never the fetch that filled it", async () => {
    // Trap 1, at the symptom. The 60 s network transport above must not come
    // back on the warm path — that is exactly the reading that would make the
    // plan conclude "fetch dominates" on a click that touched no network.
    const store = new MemoryBlobStore();
    const inner = new TimedSource();
    const cached = new CachingSource(inner, store, {
      monotonicNow: steppingClock(5),
    });

    await cached.fetchTile(TILE);
    const hit = await cached.fetchTile(TILE);

    expect(inner.calls).toBe(1);
    expect(hit.timings?.servedBy).toBe("cache");
    expect(hit.timings?.transportMs).toBeLessThan(1000);
  });

  it("reports parseMs 0 on a hit, because the parser genuinely does not run", async () => {
    // Trap 2, the "zero" half. The cached blob already holds features, so this
    // is a true zero and a real property of the warm path — not an unmeasured
    // stage. `servedBy` is what lets a reader tell the two apart.
    const store = new MemoryBlobStore();
    const cached = new CachingSource(new TimedSource(), store, {
      monotonicNow: steppingClock(5),
    });

    await cached.fetchTile(TILE);
    const hit = await cached.fetchTile(TILE);

    expect(hit.timings?.parseMs).toBe(0);
    expect(hit.timings?.decodeMs).toBeGreaterThan(0);
  });

  it("charges the awaited cache WRITE to the miss that paid for it", async () => {
    // The write is `await`ed before `fetchTile` resolves, so it is on the click
    // path whether or not anyone thinks of it as fetching. Reported only when a
    // write happened, so a hit cannot look like it wrote.
    const store = new MemoryBlobStore();
    const cached = new CachingSource(new TimedSource(), store, {
      monotonicNow: steppingClock(5),
    });

    const miss = await cached.fetchTile(TILE);
    const hit = await cached.fetchTile(TILE);

    expect(miss.timings?.storeMs).toBeGreaterThan(0);
    expect(hit.timings?.storeMs).toBeUndefined();
  });
});
