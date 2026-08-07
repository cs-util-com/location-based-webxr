/**
 * The point-query fallback.
 *
 * WHY THESE TESTS MATTER. This provider talks to donated infrastructure with a
 * hard global ceiling — 100 locations/request, 1 request/second, 1,000
 * requests/day for every user of this library combined. The tests that matter
 * are therefore not "does it parse the response" but "does it refuse to be
 * misused", because the alternative to a local refusal is spending a shared
 * quota and finding out afterwards.
 */

import { describe, expect, it, vi } from "vitest";

import {
  OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST,
  OPENTOPODATA_MIN_REQUEST_INTERVAL_MS,
  OpenTopoDataProvider,
  TooManyElevationPointsError,
} from "./opentopodata-provider.js";

const AT = [
  { lat: 50.94, lng: 6.95 },
  { lat: 50.95, lng: 6.96 },
];

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  ) as unknown as typeof fetch;
}

/** No real waiting: the throttle is driven by an injected clock and sleep. */
function providerWith(fetchImpl: typeof fetch, now = () => 1_000_000) {
  const sleeps: number[] = [];
  const provider = new OpenTopoDataProvider({
    fetchImpl,
    now,
    sleepImpl: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { provider, sleeps };
}

describe("refusing to be misused", () => {
  it("throws BEFORE spending a request when asked for too many points", async () => {
    // One res-7 fetch tile holds ~117,649 res-13 cells against a 100,000
    // point/day GLOBAL ceiling. Discovering that by being rate-limited would
    // mean the quota was already gone — for everyone, not just us.
    const fetchImpl = jsonFetch({ results: [] });
    const { provider } = providerWith(fetchImpl);

    const many = Array.from({ length: 500 }, () => AT[0]!);
    await expect(provider.elevationAt(many)).rejects.toBeInstanceOf(
      TooManyElevationPointsError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("defaults the cap to exactly one request's worth", () => {
    expect(OPENTOPODATA_MAX_LOCATIONS_PER_REQUEST).toBe(100);
  });

  it("waits out the 1 req/s limit rather than being refused", async () => {
    let clock = 1_000_000;
    const fetchImpl = jsonFetch({ results: [{ elevation: 50 }] });
    const { provider, sleeps } = providerWith(fetchImpl, () => clock);

    await provider.elevationAt([AT[0]!]);
    clock += 200; // only 200 ms later
    await provider.elevationAt([AT[0]!]);

    expect(sleeps).toEqual([800]);
  });
});

describe("reading the response", () => {
  it("returns elevations in the order asked", async () => {
    const fetchImpl = jsonFetch({
      results: [{ elevation: 50.5 }, { elevation: 61 }],
    });
    const { provider } = providerWith(fetchImpl);
    await expect(provider.elevationAt(AT)).resolves.toEqual([50.5, 61]);
  });

  it("maps a null elevation to undefined, never 0", async () => {
    // `null` is OpenTopoData saying "outside the dataset" — a real answer
    // meaning no data. Turning it into 0 would put the Alps at sea level.
    const fetchImpl = jsonFetch({
      results: [{ elevation: null }, { elevation: 61 }],
    });
    const { provider } = providerWith(fetchImpl);
    await expect(provider.elevationAt(AT)).resolves.toEqual([undefined, 61]);
  });

  it("degrades to undefined on a non-OK status", async () => {
    const { provider } = providerWith(jsonFetch({}, 503));
    await expect(provider.elevationAt(AT)).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("survives a malformed body without throwing", async () => {
    // A rate-limit page, an HTML error, a truncated response: all arrive as
    // "not the shape I expected", and none of them should fail the batch.
    const { provider } = providerWith(jsonFetch({ nonsense: true }));
    await expect(provider.elevationAt(AT)).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("pads a short results array rather than misaligning it", async () => {
    // The dangerous failure: fewer results than locations, silently shifting
    // every elevation onto the wrong position.
    const { provider } = providerWith(
      jsonFetch({ results: [{ elevation: 50 }] }),
    );
    await expect(provider.elevationAt(AT)).resolves.toEqual([50, undefined]);
  });

  it("returns [] for [] without touching the network", async () => {
    const fetchImpl = jsonFetch({ results: [] });
    const { provider } = providerWith(fetchImpl);
    await expect(provider.elevationAt([])).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the 1 req/s limit under CONCURRENCY", () => {
  it("gives each overlapping call its own slot, not the same one", async () => {
    // WHY THIS TEST MATTERS. The sequential case above was already covered, and
    // it is the case that cannot go wrong: the second call reads a
    // `lastRequestAt` the first has already written. Concurrent calls are the
    // case the module header says this guard exists for — "rate-limited HERE, in
    // the client, rather than discovered by being refused" — and they were the
    // case it did not cover.
    //
    // The defect was a read-modify-write across an await: every overlapping
    // caller read the same last-request time, computed the same wait, slept it
    // in parallel and fired together. N concurrent callers meant N requests in
    // one second against a documented 1 req/s limit on donated infrastructure —
    // and `maxPointsPerRun` cannot catch it, because each call is independently
    // under the cap. Raised in review on #270.
    //
    // THE SLEEP LIST IS THE SCHEDULE. With a frozen clock, the delay each caller
    // is handed IS its send time relative to the others, so asserting the list
    // asserts that three overlapping calls become three seconds of traffic
    // rather than one burst. Under the old code it was empty.
    const fetchImpl = jsonFetch({ results: [{ elevation: 50 }] });
    const { provider, sleeps } = providerWith(fetchImpl);

    await Promise.all([
      provider.elevationAt([AT[0]!]),
      provider.elevationAt([AT[1]!]),
      provider.elevationAt([AT[0]!]),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([
      OPENTOPODATA_MIN_REQUEST_INTERVAL_MS,
      2 * OPENTOPODATA_MIN_REQUEST_INTERVAL_MS,
    ]);
  });

  it("does not hold a slot that was reserved and then abandoned", async () => {
    // The counterweight to reserving eagerly: a caller whose request fails must
    // not leave the next one waiting behind a slot nobody used. Asserted through
    // the NEXT call's wait rather than through internals — a failed request
    // still consumed its own slot, so the following one is spaced from it and
    // not from it plus a phantom.
    const fetchImpl = jsonFetch({ results: [] }, 500);
    const { provider, sleeps } = providerWith(fetchImpl);

    await provider.elevationAt([AT[0]!]);
    await provider.elevationAt([AT[0]!]);

    expect(sleeps).toEqual([OPENTOPODATA_MIN_REQUEST_INTERVAL_MS]);
  });
});
