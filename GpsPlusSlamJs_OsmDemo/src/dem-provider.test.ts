/**
 * The DEM composition: Mapterhorn primary, AWS Terrarium fallback, one shared
 * caching fetch in front of both.
 *
 * WHY THESE TESTS MATTER. The composition is pure wiring over library pieces
 * that carry their own tests (`fallbackProvider`, `TerrariumProvider`,
 * `createCachingTileFetch`), so what can break here is exactly the wiring:
 * which host is asked first, whether the fallback is consulted at all, and
 * whether both providers really share the one persistent cache. None of that
 * is observable in the worker (its construction needs `navigator.storage` and
 * `OffscreenCanvas`), so the factory is extracted and pinned here with fakes.
 *
 * No property-based spec, deliberately: every behaviour here is a composition
 * of already-property-tested library parts, and a property over the wiring
 * would re-test those parts through one fixed configuration.
 */

import { describe, expect, it } from "vitest";

import {
  MemoryBlobStore,
  decodeTerrarium,
  type DecodedImage,
  type LatLng,
} from "gps-plus-slam-osm";

import {
  DEM_ATTRIBUTION_ENTRIES,
  DEM_SOURCE_ID,
  FAST_DEM_SOURCE_ID,
  PREFERRED_DEM_SOURCE_ID,
  FALLBACK_DEM_TIMEOUT_MS,
  PRIMARY_DEM_TIMEOUT_MS,
  PUBLISH_DEADLINE_MS,
  createDemProvider,
} from "./dem-provider.js";
import { TERRAIN_WAIT_TIMEOUT_MS } from "./worker/terrain-gate.js";

const COLOGNE: LatLng = { lat: 50.9413, lng: 6.9583 };

/** One-byte body markers, so the fake decoder can tell the sources apart. */
const MAPTERHORN_BODY = 7;
const AWS_BODY = 9;

/** Heights the two fake sources encode, metres. Distinct on purpose. */
const MAPTERHORN_HEIGHT = decodeTerrarium(128, 10, 0);
const AWS_HEIGHT = decodeTerrarium(128, 42, 0);

/**
 * A decoder keyed off the body marker instead of a real image codec — the
 * same seam the library's own tests use, so no codec runs in Node.
 */
function fakeDecodePng(bytes: ArrayBuffer): Promise<DecodedImage> {
  const marker = new Uint8Array(bytes)[0];
  const g = marker === MAPTERHORN_BODY ? 10 : 42;
  // A 1×1 tile: TerrariumProvider is tile-size-invariant, so the smallest
  // square exercises the same sampling path as a real 256/512 px tile.
  return Promise.resolve({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([128, g, 0, 255]),
  });
}

/** A network that answers per host and records every URL it was asked for. */
function fakeNetwork(
  options: {
    mapterhornStatus?: number;
    /**
     * Mapterhorn accepts the request and then never answers.
     *
     * THE FIELD CASE, and it is NOT the same as an error. The 2026-08-19
     * session measured Mapterhorn at 10-21 s for the four tiles one window
     * needs while AWS served the same four in 1.0 s. A slow primary produces
     * no gap for `fallbackProvider` to fill, so before the deadline existed
     * the fallback was unreachable rather than broken. A `never` here is the
     * limit of that behaviour and is what the deadline has to survive.
     *
     * It respects the request's signal so an aborted or timed-out fetch
     * settles the way a real one does; without that the pending promise
     * outlives the test and vitest reports an unhandled rejection.
     */
    mapterhornNeverAnswers?: boolean;
    /**
     * Mapterhorn answers correctly, but LATE — the field case the race exists
     * for.
     *
     * Microtask ticks rather than timers, so the suite stays synchronous and
     * deterministic: the point is only that AWS settles first, not how much
     * wall-clock separates them.
     */
    mapterhornDelayTicks?: number;
  } = {},
): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    // The providers pass plain URL strings; the branches keep the fake honest
    // (and the linter quiet) should that ever change.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    urls.push(url);
    if (url.includes("mapterhorn")) {
      if (options.mapterhornNeverAnswers === true) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal ?? undefined;
          if (signal == null) return;
          // `signal.reason` is typed `any` and `prefer-promise-reject-errors`
          // is right to refuse it — a fake that rejected with a non-Error would
          // offer production a path a real `fetch` never does. In practice it
          // IS an Error (Node's DOMException extends it), which is exactly what
          // lets the provider tell an AbortError from a TimeoutError by name.
          signal.addEventListener(
            "abort",
            () => {
              const reason: unknown = signal.reason;
              reject(reason instanceof Error ? reason : new Error("aborted"));
            },
            { once: true },
          );
        });
      }
      const status = options.mapterhornStatus ?? 200;
      const response =
        status === 200
          ? new Response(new Uint8Array([MAPTERHORN_BODY]), { status })
          : new Response(null, { status });
      const ticks = options.mapterhornDelayTicks ?? 0;
      if (ticks <= 0) return Promise.resolve(response);
      return (async () => {
        for (let i = 0; i < ticks; i++) await Promise.resolve();
        return response;
      })();
    }
    return Promise.resolve(
      new Response(new Uint8Array([AWS_BODY]), { status: 200 }),
    );
  }) as typeof fetch;
  return { fetchImpl, urls };
}

/**
 * Short enough that the suite stays fast, long enough not to race the fake
 * network's own microtasks. Real deadlines are seconds — see `dem-provider.ts`.
 */
const TEST_TIMEOUT_MS = 25;

describe("createDemProvider", () => {
  it("asks BOTH sources at once instead of the fallback only on a gap", async () => {
    // CHANGED 2026-08-19 WITH THE RACE. This test used to assert the opposite —
    // that AWS is never asked while Mapterhorn has data — which was
    // `fallbackProvider`'s defining behaviour and, as the twelfth testing
    // session found, its defect: the fallback is consulted only for positions
    // the primary returned `undefined` for, so a merely SLOW primary leaves no
    // gap and the fallback is unreachable rather than broken. Asking both is
    // now the point, and the extra request is what makes the fast answer
    // available at all.
    const { fetchImpl, urls } = fakeNetwork();
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl,
    });

    await provider.elevationAt([COLOGNE]);

    expect(urls.some((url) => url.includes("tiles.mapterhorn.com"))).toBe(true);
    expect(urls.some((url) => url.includes("s3.amazonaws.com"))).toBe(true);
  });

  it("publishes AWS immediately and UPGRADES to Mapterhorn when it lands", async () => {
    // THE MILESTONE, in one test. Measured 2026-08-19, Mapterhorn took
    // 3.0–21.7 s per tile against AWS's ~1.0 s from the same machine. Round
    // one's deadline made the fallback reachable by cutting Mapterhorn off at
    // 3 s, which fixed the stall and permanently gave up the LiDAR heights.
    // The race gives back both: the fast answer now, the good one shortly
    // after.
    //
    // The assertion that matters is the UPGRADE. A race that publishes AWS and
    // never upgrades looks identical on screen to a working one — the map shows
    // terrain either way, just always the coarse kind.
    const upgrades: (readonly (number | undefined)[])[] = [];
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork({ mapterhornDelayTicks: 8 }).fetchImpl,
      onUpgrade: (_positions, heights) => upgrades.push(heights),
    });

    const [first] = await provider.elevationAt([COLOGNE]);
    expect(first).toBe(AWS_HEIGHT);
    expect(provider.stats.servedBy).toBe(FAST_DEM_SOURCE_ID);

    await provider.awaitUpgrades();

    expect(upgrades).toEqual([[MAPTERHORN_HEIGHT]]);
    expect(provider.stats.servedBy).toBe(PREFERRED_DEM_SOURCE_ID);
  });

  it("falls back to the AWS tiles where Mapterhorn has no tile", async () => {
    // A 404 is Mapterhorn's honest "no coverage here"; the fallback exists so
    // that answer degrades to the coarser global DEM instead of to a hole.
    const { fetchImpl, urls } = fakeNetwork({ mapterhornStatus: 404 });
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl,
    });

    const [height] = await provider.elevationAt([COLOGNE]);

    expect(height).toBe(AWS_HEIGHT);
    expect(urls.some((url) => url.includes("tiles.mapterhorn.com"))).toBe(true);
    expect(urls.some((url) => url.includes("s3.amazonaws.com"))).toBe(true);
  });

  it("serves a repeat query from the injected store, not the network", async () => {
    // THE OFFLINE COLD START. A second provider instance sharing the same
    // store models a reload: its in-memory tile cache is empty, so an answer
    // without any network fetch can only have come through the caching fetch's
    // persistence — which is the whole reason the store is injected.
    const store = new MemoryBlobStore();
    const first = fakeNetwork();
    await createDemProvider({
      store,
      decodePng: fakeDecodePng,
      fetchImpl: first.fetchImpl,
    }).elevationAt([COLOGNE]);
    expect(first.urls.length).toBeGreaterThan(0);

    const second = fakeNetwork();
    const [height] = await createDemProvider({
      store,
      decodePng: fakeDecodePng,
      fetchImpl: second.fetchImpl,
    }).elevationAt([COLOGNE]);

    expect(height).toBe(MAPTERHORN_HEIGHT);
    expect(second.urls).toHaveLength(0);
  });

  it("exposes serving stats so a session can tell which DEM actually served", async () => {
    // WHY THIS TEST MATTERS. The composed id names what was ASKED; the stats
    // are the only surface saying what ANSWERED. A session that silently fell
    // back to the ~30 m AWS tiles reads identically to a LiDAR-served one on
    // every other number, and the residuals differ by an order of magnitude.
    // CHANGED WITH THE RACE. The stats used to be three position counts and
    // the HUD showed the primary's share of them. That share was only
    // meaningful because `fallbackProvider` guaranteed the two sources answered
    // DISJOINT positions; under a race both answer every position, so the ratio
    // stops partitioning anything and becomes arithmetically undefined rather
    // than merely stale. `servedBy` is what stays true.
    const fellBack = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork({ mapterhornStatus: 404 }).fetchImpl,
    });
    await fellBack.elevationAt([COLOGNE]);
    expect(fellBack.stats.servedBy).toBe(FAST_DEM_SOURCE_ID);

    const upgraded = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork({ mapterhornDelayTicks: 8 }).fetchImpl,
      onUpgrade: () => {},
    });
    await upgraded.elevationAt([COLOGNE]);
    await upgraded.awaitUpgrades();
    expect(upgraded.stats.servedBy).toBe(PREFERRED_DEM_SOURCE_ID);
  });

  it("lets the fallback serve when the primary is SLOW rather than failing", async () => {
    // THE ASSERTION WHOSE ABSENCE LET cf797bc3 SHIP, and the whole of M1.
    //
    // The existing cases cover a primary that says 404 and a fallback that
    // throws. Neither catches the field failure the twelfth testing session
    // reported: `fallbackProvider` awaits the primary unconditionally and only
    // consults the fallback for positions the primary returned `undefined`, so
    // a primary that never answers produces no gap and the fallback is never
    // asked at all. The user saw "the fallback is broken"; it was unreachable.
    //
    // Note this test CANNOT live against `fallbackProvider` directly: that
    // combinator carries no deadline of its own, so a never-settling fake
    // primary would hang there forever. The deadline lives on the tile fetch,
    // which is why the seam that can express this is `createDemProvider`.
    const { fetchImpl, urls } = fakeNetwork({ mapterhornNeverAnswers: true });
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl,
      primaryTimeoutMs: TEST_TIMEOUT_MS,
    });

    const [height] = await provider.elevationAt([COLOGNE]);

    expect(height).toBe(AWS_HEIGHT);
    expect(urls.some((url) => url.includes("tiles.mapterhorn.com"))).toBe(true);
    expect(urls.some((url) => url.includes("s3.amazonaws.com"))).toBe(true);
    // Attributed to the source that actually served, not silently blamed on
    // nobody — the readout has to stay honest about which DEM is underfoot.
    expect(provider.stats.servedBy).toBe(FAST_DEM_SOURCE_ID);
  });

  it("degrades on a DEADLINE but still propagates a caller's ABORT", async () => {
    // WHY THIS TEST MATTERS: it pins the COMPOSITION's two cancellation
    // outcomes, which a caller of `createDemProvider` has to be able to tell
    // apart — a deadline yields heights, an abort yields a rejection.
    //
    // WHAT IT DOES NOT PIN, corrected after review. An earlier version of this
    // comment claimed it covered `TerrariumProvider.load`'s rethrow of
    // `AbortError`. It does not: the caller's rejection is delivered by
    // `InFlightRequests.attach`, which races the caller's own signal and
    // rejects it directly, so `load`'s catch is never consulted on this path.
    // Replacing that catch with a bare `catch { return undefined }` would leave
    // this test passing. The rethrow is genuinely pinned one layer down, by
    // `terrarium.test.ts`'s "propagates an abort instead of degrading", which
    // rejects the fetch itself with an `AbortError` and no signal in play.
    const deadlineOnly = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork({ mapterhornNeverAnswers: true }).fetchImpl,
      primaryTimeoutMs: TEST_TIMEOUT_MS,
    });
    await expect(deadlineOnly.elevationAt([COLOGNE])).resolves.toEqual([
      AWS_HEIGHT,
    ]);

    // A caller that walks away is asking for NO answer, not a degraded one.
    const controller = new AbortController();
    const aborted = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork({ mapterhornNeverAnswers: true }).fetchImpl,
      primaryTimeoutMs: 10_000,
    }).elevationAt([COLOGNE], controller.signal);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps both deadlines in the order and the budget the design depends on", () => {
    // WHY THIS TEST MATTERS, and why the constants are exported at all.
    //
    // The two values are not independent settings — three relationships between
    // them carry the whole argument, and each is easy to break with a plausible
    // one-line edit:
    //
    // REWRITTEN 2026-08-19: THE RELATIONSHIPS INVERTED when the race landed,
    // because the deadlines' jobs changed. Under `fallbackProvider` the two
    // were serial and the primary's had to be short — it was the only thing
    // making the fallback reachable — so the invariants were "primary shorter"
    // and "their sum inside the gate". Under a race they are CONCURRENT and
    // nothing waits for the primary, so:
    //
    // 1. THE PUBLISH DEADLINE is what must fit inside the terrain gate. An
    //    earlier version of this test asserted the FAST source's deadline
    //    instead, on the theory that it "is now the entire guarantee that
    //    something is published". That was false and the milestone review
    //    caught it: `racingProvider` waits for a usable answer from EITHER arm,
    //    so a fast source answering "no coverage" at 8 s leaves the batch
    //    waiting on the preferred arm until ITS 30 s. Breaking this rebuilds
    //    the mesh flat, which is the originally reported bug.
    // 2. The publish deadline must exceed the fast source's own, or a
    //    slow-but-answering AWS is cut off before it can serve.
    // 3. The PREFERRED source's is now LONGER than either, deliberately: a pure
    //    anti-hang guard on a request nobody waits for. Shortening it below the
    //    measured worst case would ship a race that can never be won — the
    //    upgrade would never fire and the LiDAR heights would be lost exactly as
    //    they were under the 3 s deadline.
    // 4. It must clear the measured worst case with room — Mapterhorn was
    //    measured at up to 21.7 s per tile on 2026-08-19.
    expect(PUBLISH_DEADLINE_MS).toBeLessThan(TERRAIN_WAIT_TIMEOUT_MS);
    expect(PUBLISH_DEADLINE_MS).toBeGreaterThan(FALLBACK_DEM_TIMEOUT_MS);
    expect(PRIMARY_DEM_TIMEOUT_MS).toBeGreaterThan(PUBLISH_DEADLINE_MS);
    expect(PRIMARY_DEM_TIMEOUT_MS).toBeGreaterThan(22_000);
  });

  it("identifies the composition for the HUD, and credits BOTH sources", () => {
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork().fetchImpl,
    });

    // The id the AR readout renders next to the terrain height — composed,
    // because per-sample source attribution is not observable through the
    // `ElevationProvider` seam (see the sidecar's follow-up note).
    expect(provider.sourceId).toBe(DEM_SOURCE_ID);
    expect(DEM_SOURCE_ID).toBe("mapterhorn+terrarium");

    // Attribution is an obligation to BOTH upstreams the moment the fallback
    // can serve a tile, so the displayed credits must name each of them.
    //
    // ASSERTED ON THE ENTRIES, not on a composed string (round three, DEC-W1).
    // The attribution line shows a visible SHORT NAME per source and hides only
    // the long sentence, so the two credits have to stay apart all the way to
    // the DOM — and both halves of each entry matter now: the short name is
    // what a user reads without tapping, the full text is what the licence
    // wording lives in. A composed string could satisfy an assertion here and
    // still render as one undifferentiated blob.
    expect(DEM_ATTRIBUTION_ENTRIES.map((entry) => entry.short)).toEqual([
      "Mapterhorn",
      "Mapzen/AWS",
    ]);
    const full = DEM_ATTRIBUTION_ENTRIES.map((entry) => entry.full).join(" ");
    expect(full).toContain("Mapterhorn");
    expect(full).toContain("Mapzen");
  });
});
