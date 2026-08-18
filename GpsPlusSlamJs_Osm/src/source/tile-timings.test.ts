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
import { OverpassSource, RateLimitedError } from "./overpass-source.js";
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
 * **Adequate only for "did this stage get a number at all".** It cannot pin
 * ATTRIBUTION, and believing otherwise was a real defect in the first version
 * of this file: with a uniform step every stage is exactly one step wide, so
 * transport, decode and parse are numerically indistinguishable and no
 * assertion over them can tell a swapped clock from a correct one. Use
 * {@link advanceableClock} for anything that claims a stage got the RIGHT
 * interval.
 */
function steppingClock(stepMs: number, start = 0) {
  let t = start;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

/**
 * A clock the TEST advances, so one stage can be made expensive on purpose.
 *
 * This is what makes attribution assertable. Charge 1000 ms inside
 * `response.text()` and only `transportMs` may move; charge it inside the
 * parser and only `parseMs` may. A start/stop pair straddling the wrong
 * `await` — the realistic bug, and the one plan §5 names — then fails loudly
 * instead of producing three identical plausible numbers.
 */
function advanceableClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
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
  it("charges a slow BODY READ to transport and to nothing else", async () => {
    // ATTRIBUTION, not presence. The first version of this test asserted
    // `toBeGreaterThan(0)` on all three stages under a uniform stepping clock,
    // which made them numerically identical — so moving the transport stop to
    // the far side of `JSON.parse`, the realistic straddle bug, kept it green.
    // Making exactly one stage expensive is what turns that into a failure.
    const clock = advanceableClock();
    const source = makeSource({
      monotonicNow: clock.now,
      fetchImpl: vi.fn(() => {
        const body = JSON.stringify(OK_BODY);
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => {
            clock.advance(1000);
            return Promise.resolve(body);
          },
        } as unknown as Response);
      }),
    });

    const { timings } = await source.fetchTile(TILE);
    expect(timings?.servedBy).toBe("network");
    expect(timings?.transportMs).toBe(1000);
    // The other two stages did nothing expensive, so they must read zero — a
    // non-zero here means transport's interval leaked into them.
    expect(timings?.decodeMs).toBe(0);
    expect(timings?.parseMs).toBe(0);
    expect(timings?.attempts).toBe(1);
  });

  it("separates decode from parse on real work, each getting a real number", async () => {
    // THE HONEST LIMIT OF THIS FILE, stated rather than papered over. The test
    // above can charge a fake clock inside `response.text()` because the test
    // owns the Response; it cannot do the same to `JSON.parse` or to
    // `parseOverpassJson`, which are called directly. So the decode/parse
    // boundary is pinned two weaker ways instead:
    //
    //  - By CONSTRUCTION: `readAndDecode` stops the decode clock before
    //    returning and `toResult` starts the parse clock after, so the two
    //    intervals cannot overlap without an edit that is visible in the diff.
    //  - By this test: over a payload big enough for both to cost real time on
    //    a real clock, both must be non-zero. An instrument that folded one
    //    into the other would leave the other at zero.
    //
    // What neither pins is the two being SWAPPED. Recorded as a known gap
    // rather than left implied — see the plan's §10.
    const elements = Array.from({ length: 20_000 }, (_, i) => ({
      type: "node",
      id: i,
      lat: 50.9 + i * 1e-6,
      lon: 6.9 + i * 1e-6,
      tags: { amenity: "bench", name: `bench ${i}` },
    }));
    const source = makeSource({
      monotonicNow: undefined, // the real clock: this measures real work
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse({ version: 0.6, elements })),
    });

    const { timings } = await source.fetchTile(TILE);
    expect(timings?.decodeMs).toBeGreaterThan(0);
    expect(timings?.parseMs).toBeGreaterThan(0);
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

  it("keeps the backoff sleep INSIDE transportMs, which is the documented claim", async () => {
    // The headline sentence on `transportMs` is "includes retry backoff", and
    // it was asserted nowhere. Moving `transportStart` inside the retry loop is
    // the obvious refactor a later reader makes, it silently deletes the sleep
    // from the number, and nothing would have gone red.
    const clock = advanceableClock();
    const slept: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 502 }))
      .mockResolvedValue(jsonResponse(OK_BODY));
    const source = makeSource({
      monotonicNow: clock.now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: (ms: number) => {
        slept.push(ms);
        clock.advance(ms);
        return Promise.resolve();
      },
      // Full jitter means `random: () => 0` yields a ZERO delay, so the shared
      // `makeSource` default would have made this test assert nothing. Drawing
      // near the top of the range is what puts a real sleep on the clock.
      random: () => 0.999,
      backoff: { baseDelayMs: 500 },
    });

    const { timings } = await source.fetchTile(TILE);
    const totalSlept = slept.reduce((sum, ms) => sum + ms, 0);

    expect(timings?.attempts).toBe(2);
    expect(totalSlept).toBeGreaterThan(0);
    // ASSERTED AGAINST WHAT ACTUALLY SLEPT, not against the base delay — full
    // jitter draws a random fraction of it, so a literal here would pin the
    // jitter formula rather than the claim. The claim is that the sleep is
    // inside the transport interval; a transport clocked per-attempt reads 0.
    expect(timings?.transportMs).toBeGreaterThanOrEqual(totalSlept);
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

  it("charges the probe to the MISS that paid for it, not to nobody", async () => {
    // The gap milestone 1 shipped and milestone 2 closes. `readCached` runs on
    // every path, so a miss pays a full `store.get` plus `JSON.parse` before it
    // reaches the network — and on a stale hit that is a ~21 MB read. Left
    // unattributed it would surface in the residual looking like an
    // unenumerated ninth stage, which is exactly the reading that wastes a
    // session.
    const store = new MemoryBlobStore();
    const cached = new CachingSource(new TimedSource(), store, {
      monotonicNow: steppingClock(5),
    });

    const miss = await cached.fetchTile(TILE);
    expect(miss.timings?.probeMs).toBeGreaterThan(0);
  });

  it("gives a joiner its own joinedMs, at the layer that actually dedups", async () => {
    // THE FIX FOR A REAL DEFECT, not a hypothetical. The joiner copy was first
    // built in `OverpassSource` alone — and `CachingSource` dedups FIRST, so in
    // the demo's wiring the inner client sees one caller and that branch never
    // ran. Two colliding refresh passes were both told the click cost a full
    // network fetch, which is verbatim the overstatement the field exists to
    // prevent.
    //
    // And `joinedMs` rather than `transportMs`: a joiner's wait spans somebody
    // else's transport AND decode AND parse, so filing it under "bytes in hand"
    // would charge another caller's parse to the network stage.
    const store = new MemoryBlobStore();
    const inner = new TimedSource();
    const cached = new CachingSource(inner, store, {
      monotonicNow: steppingClock(5),
    });

    const [a, b] = await Promise.all([
      cached.fetchTile(TILE),
      cached.fetchTile(TILE),
    ]);

    expect(inner.calls).toBe(1);
    expect(a.timings?.servedBy).toBe("network");
    expect(b.timings?.servedBy).toBe("joined");
    expect(b.timings?.joinedMs).toBeGreaterThan(0);
    // The joiner must NOT inherit the 60 s network transport above.
    expect(b.timings?.transportMs).toBe(0);
    expect(b.features).toBe(a.features);
  });

  it("reports a stale-on-rate-limit answer as itself, with the probe it paid", async () => {
    // A new `servedBy` value and a five-field literal shipped with no test at
    // all. Its first version reported four hard zeros — "this delivery cost
    // nothing" — about a path that had just paid a full read and decode, which
    // is the absent-vs-zero confusion this type is shaped to prevent, committed
    // by the type's own author.
    const store = new MemoryBlobStore();
    let calls = 0;
    const flaky: OsmDataSource = {
      attribution: "© OpenStreetMap contributors",
      sourceId: "flaky",
      fetchTile: (tile) => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve({
            tile,
            features: [],
            fetchedAt: 1000,
            sourceId: "flaky",
            schemaVersion: OVERPASS_SCHEMA_VERSION,
            skipped: [],
          });
        }
        return Promise.reject(new RateLimitedError("no slots", 1000));
      },
    };
    const cached = new CachingSource(flaky, store, {
      monotonicNow: steppingClock(5),
      now: () => 10_000,
    });

    await cached.fetchTile(TILE);
    // Force a refetch of the now-"stale" entry, which the rate limit refuses.
    const stale = await cached.ensureTile(TILE, { maxAgeMs: 1 });

    expect(cached.stats.staleOnRateLimit).toBe(1);
    expect(stale.timings?.servedBy).toBe("stale-on-rate-limit");
    expect(stale.timings?.probeMs).toBeGreaterThan(0);
    expect(stale.timings?.transportMs).toBe(0);
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

describe("a failed cache WRITE does not throw away the tile it just paid for", () => {
  /**
   * Why this matters: a res-7 tile costs 15–90 s of somebody else's donated
   * infrastructure. Losing one because the LOCAL write failed inverts the whole
   * point of the cache — it turns a storage problem into a data problem, and
   * the caller renders nothing while holding a perfectly good tile.
   *
   * OPFS quota-exceeded is the realistic trigger, and it is not exotic: the
   * store holds ~21 MB per tile and the library never evicts on its own by
   * design (eviction is the host app's policy). A user who browses enough
   * ground WILL hit it, and the failure they would have seen is "the map stopped
   * working", not "storage is full".
   */
  class FullStore extends MemoryBlobStore {
    override put(): Promise<void> {
      return Promise.reject(
        new DOMException("The quota has been exceeded.", "QuotaExceededError"),
      );
    }
  }

  it("returns the fetched tile even though it could not be cached", async () => {
    const inner = new TimedSource();
    const cached = new CachingSource(inner, new FullStore(), {
      monotonicNow: steppingClock(5),
    });

    const result = await cached.fetchTile(TILE);

    expect(result.features).toEqual((await inner.fetchTile(TILE)).features);
    expect(cached.stats.storeFailures).toBe(1);
  });

  it("counts the failure rather than swallowing it silently", async () => {
    // A dropped write is invisible otherwise: the tile renders, and the only
    // symptom is that every later click refetches it — which reads as a slow
    // network rather than as a full disk. The counter is what makes the real
    // cause findable from the status line.
    const cached = new CachingSource(new TimedSource(), new FullStore(), {
      monotonicNow: steppingClock(5),
    });

    await cached.fetchTile(TILE);
    await cached.fetchTile(TILE);

    expect(cached.stats.storeFailures).toBe(2);
    // And the tile really was NOT cached, so both were misses.
    expect(cached.stats.misses).toBe(2);
  });

  it("still reports the timings, so the failed write is not invisible in the breakdown", async () => {
    const cached = new CachingSource(new TimedSource(), new FullStore(), {
      monotonicNow: steppingClock(5),
    });

    const result = await cached.fetchTile(TILE);

    expect(result.timings?.servedBy).toBe("network");
    expect(result.timings?.storeMs).toBeGreaterThanOrEqual(0);
  });
});
