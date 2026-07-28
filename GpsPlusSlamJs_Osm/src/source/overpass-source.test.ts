/**
 * Overpass network-discipline tests.
 *
 * Why these tests matter:
 * The plan calls §5.3 "non-negotiable, and each item gets a test", and the
 * reason is not tidiness. The public Overpass servers are donated
 * infrastructure with roughly 1,000,000 requests/day of capacity shared by
 * every OSM application worldwide; the informal safe budget is <10,000
 * queries/day per consumer. A missing dedup or a retry storm in a library that
 * ships to phones is not a performance bug, it is an abuse of a shared resource
 * that gets everyone blocked.
 *
 * Every dependency is injected (fetch, clock, sleeper, RNG) so this file runs
 * offline, deterministically, in milliseconds, and never hits a real server.
 *
 * @see overpass-source.ts.md
 */

import { describe, it, expect, vi } from "vitest";
import { latLngToCell } from "h3-js";
import {
  OverpassSource,
  RateLimitedError,
  DEFAULT_OVERPASS_ENDPOINTS,
} from "./overpass-source.js";
import { OverpassSlotBudget } from "./slot-budget.js";
import { OVERPASS_SCHEMA_VERSION } from "./overpass-query.js";
import { FETCH_RES } from "../spatial/resolutions.js";

const TILE = latLngToCell(50.9413, 6.9583, FETCH_RES);
const TILE_B = latLngToCell(52.52, 13.405, FETCH_RES);

const OK_BODY = {
  version: 0.6,
  osm3s: { timestamp_osm_base: "2026-05-06T03:25:00Z" },
  elements: [
    { type: "node", id: 1, lat: 50.94, lon: 6.95, tags: { amenity: "bench" } },
  ],
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function errorResponse(status: number, headers: Record<string, string> = {}) {
  return new Response("upstream error", { status, headers });
}

/** A source wired entirely to fakes: no timers, no randomness, no network. */
function makeSource(
  fetchImpl: ReturnType<typeof vi.fn>,
  overrides: Partial<ConstructorParameters<typeof OverpassSource>[0]> = {},
) {
  const sleeps: number[] = [];
  const source = new OverpassSource({
    userAgent: "gps-plus-slam-osm-tests/1.0 (+https://example.invalid)",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    // Zero jitter. Endpoint choice no longer depends on `random` at all — the
    // pool is walked in preference order — so this only pins the backoff.
    random: () => 0,
    now: () => 1_000_000,
    sleepImpl: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...overrides,
  });
  return { source, sleeps };
}

describe("construction guards", () => {
  it("refuses to be built without a User-Agent", () => {
    // Deliberately no default: a shared default would make every consumer of
    // this library indistinguishable to the servers, so one bad actor would
    // get all of them blocked.
    expect(() => new OverpassSource({ userAgent: "  " })).toThrow(/userAgent/);
  });

  it("refuses an empty endpoint pool", () => {
    expect(() => new OverpassSource({ userAgent: "x", endpoints: [] })).toThrow(
      /at least one endpoint/,
    );
  });
});

describe("the request itself", () => {
  it("POSTs the Overpass QL query with the identifying headers", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);

    await source.fetchTile(TILE);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(DEFAULT_OVERPASS_ENDPOINTS[0]);
    expect(init.method).toBe("POST");
    expect(init.headers["User-Agent"]).toMatch(/gps-plus-slam-osm-tests/);
    expect(init.headers["Referer"]).toMatch(/gps-plus-slam-osm-tests/);

    const body = new URLSearchParams(init.body as string).get("data")!;
    expect(body).toContain("[out:json]");
    // A UNION of exact-key statements, not a key regex — the regex form was
    // measured to 504 on every tile size tried (see overpass-query.ts).
    expect(body).toContain('nwr["highway"];');
    expect(body).not.toContain('[~"^(');
    expect(body).toContain("out geom;");
    expect(body).toMatch(/\[bbox:[-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+\]/);
  });

  it("records provenance: tile, timestamp, source host and schema version", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);

    const result = await source.fetchTile(TILE);

    expect(result.tile).toBe(TILE);
    expect(result.fetchedAt).toBe(1_000_000);
    // Derived from the pool rather than hardcoded: the order is a measured
    // preference that is expected to change when the hosts are re-timed, and a
    // literal here turns a deliberate reorder into a spurious test failure.
    expect(result.sourceId).toBe(
      `overpass:${new URL(DEFAULT_OVERPASS_ENDPOINTS[0]!).host}`,
    );
    expect(result.schemaVersion).toBe(OVERPASS_SCHEMA_VERSION);
    expect(result.osmBaseTimestamp).toBe("2026-05-06T03:25:00Z");
    expect(result.features).toHaveLength(1);
  });
});

describe("single in-flight request per tile — the quota-burning bug", () => {
  it("two concurrent requests for the same tile make ONE network call", async () => {
    let release!: (r: Response) => void;
    const fetchImpl = vi
      .fn()
      .mockReturnValue(new Promise<Response>((r) => (release = r)));
    const { source } = makeSource(fetchImpl);

    const a = source.fetchTile(TILE);
    const b = source.fetchTile(TILE);
    release(jsonResponse(OK_BODY));

    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(source.stats.deduplicated).toBe(1);
    expect(ra).toBe(rb); // the very same promise result
  });

  it("different tiles are NOT deduplicated", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);

    await Promise.all([source.fetchTile(TILE), source.fetchTile(TILE_B)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight slot after completion, so a later refetch works", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);

    await source.fetchTile(TILE);
    await source.fetchTile(TILE);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight slot after FAILURE too — a failed tile is retryable", async () => {
    // Without the `.finally`, one failure would poison the tile forever: every
    // later request would await the same rejected promise.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(errorResponse(400)));
    const { source } = makeSource(fetchImpl, { maxRetries: 0 });

    await expect(source.fetchTile(TILE)).rejects.toThrow();
    await expect(source.fetchTile(TILE)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("bounded concurrency", () => {
  it("never runs more than `maxConcurrent` requests at once", async () => {
    let concurrent = 0;
    let peak = 0;
    const resolvers: (() => void)[] = [];
    const fetchImpl = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          concurrent++;
          peak = Math.max(peak, concurrent);
          resolvers.push(() => {
            concurrent--;
            resolve(jsonResponse(OK_BODY));
          });
        }),
    );
    const { source } = makeSource(fetchImpl, { maxConcurrent: 2 });

    const tiles = [
      TILE,
      TILE_B,
      latLngToCell(48.137, 11.575, FETCH_RES),
      latLngToCell(53.55, 9.99, FETCH_RES),
      latLngToCell(50.11, 8.68, FETCH_RES),
    ];
    const all = Promise.all(tiles.map((t) => source.fetchTile(t)));

    // Drain one request at a time, yielding enough for the semaphore's
    // release -> next-task-starts chain to run between releases. `setTimeout`
    // rather than a microtask because that chain crosses several awaits.
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    for (let released = 0; released < tiles.length; released++) {
      await tick();
      const next = resolvers.shift();
      expect(next).toBeDefined();
      next?.();
    }
    await all;

    expect(peak).toBeLessThanOrEqual(2);
    expect(fetchImpl).toHaveBeenCalledTimes(tiles.length);
  });

  it("stays bounded whatever microtask a fresh caller arrives in", async () => {
    // Why this test matters: a queued waiter cannot increment `active` at the
    // moment its slot is released — it only learns about it one microtask
    // later, in its continuation. If the slot is merely *released* rather than
    // *handed over*, a caller arriving inside that window reads a free slot,
    // takes it, and then the waiter takes it too. The cap is exceeded, which is
    // precisely what earns a 429 from donated infrastructure.
    //
    // Which microtask the third caller lands in depends entirely on the
    // caller's own promise chain, so guessing one offset would be a coin flip
    // (the test above starts every request in a single synchronous burst and
    // therefore never opens the window at all). This sweeps the whole window.
    const tiles = [TILE, TILE_B, latLngToCell(48.137, 11.575, FETCH_RES)];

    for (let arrivalTicks = 0; arrivalTicks < 10; arrivalTicks++) {
      let concurrent = 0;
      let peak = 0;
      const resolvers: (() => void)[] = [];
      const fetchImpl = vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            concurrent++;
            peak = Math.max(peak, concurrent);
            resolvers.push(() => {
              concurrent--;
              resolve(jsonResponse(OK_BODY));
            });
          }),
      );
      const { source } = makeSource(fetchImpl, { maxConcurrent: 1 });

      const pending: Promise<unknown>[] = [
        source.fetchTile(tiles[0]!), // takes the only slot
        source.fetchTile(tiles[1]!), // queues behind it
      ];

      // Queued BEFORE the release, so it advances alongside the release chain
      // and `arrivalTicks` slides it across the whole hand-over window.
      let arrival = Promise.resolve();
      for (let i = 0; i < arrivalTicks; i++) arrival = arrival.then(() => {});
      pending.push(
        arrival.then(() => source.fetchTile(tiles[2]!)).catch(() => undefined),
      );

      resolvers.shift()?.();

      const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));
      for (let i = 0; i < 12; i++) {
        await macrotask();
        while (resolvers.length > 0) resolvers.shift()?.();
      }
      await Promise.allSettled(pending);

      expect(peak, `third caller arriving ${arrivalTicks} microtasks in`).toBe(
        1,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(tiles.length);
    }
  });
});

describe("retry, rotation and backoff", () => {
  it.each([429, 502, 503, 504])(
    "retries a %i on the NEXT endpoint",
    async (status) => {
      const fetchImpl = vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve(errorResponse(status)))
        .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
      const { source } = makeSource(fetchImpl);

      const result = await source.fetchTile(TILE);

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[0]![0]).toBe(DEFAULT_OVERPASS_ENDPOINTS[0]);
      expect(fetchImpl.mock.calls[1]![0]).toBe(DEFAULT_OVERPASS_ENDPOINTS[1]);
      expect(result.sourceId).toContain(
        new URL(DEFAULT_OVERPASS_ENDPOINTS[1]!).host,
      );
      expect(source.stats.retries).toBe(1);
    },
  );

  it("always starts at the FIRST endpoint, whatever `random` returns", async () => {
    /**
     * WHY THIS MATTERS. The pool is a PREFERENCE ORDER, measured
     * 2026-07-28: `lz4` and VK answered the same res-7 tile in 27.6 s and
     * 22.9 s, `private.coffee` in 110.4 s, and the FOSSGIS main entry 504'd.
     * A 4.2x spread is the difference between a usable demo and one that
     * looks broken.
     *
     * `pickEndpoint` used to start at a RANDOM offset, which spread load but
     * also made the order decorative — every client drew uniformly, so the
     * slowest instance served a quarter of all traffic. Ordering the list
     * without this change would have looked like a fix and done nothing, so
     * the test pins the property rather than the list.
     *
     * `random` is still injected — it drives backoff jitter (see the
     * exponential-growth test below), which is the one place randomness is
     * still wanted.
     */
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(errorResponse(504)))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
    // Under the old behaviour this offset started at the LAST endpoint.
    const { source } = makeSource(fetchImpl, { random: () => 0.999999 });

    await source.fetchTile(TILE);

    expect(fetchImpl.mock.calls[0]![0]).toBe(DEFAULT_OVERPASS_ENDPOINTS[0]);
    expect(fetchImpl.mock.calls[1]![0]).toBe(DEFAULT_OVERPASS_ENDPOINTS[1]);
  });

  it("does NOT retry a non-retryable status", async () => {
    // A 400 means our query is wrong. Retrying it just burns quota to get the
    // same answer four times.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(errorResponse(400)));
    const { source } = makeSource(fetchImpl);

    await expect(source.fetchTile(TILE)).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honours `Retry-After` in seconds over its own backoff", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { "Retry-After": "7" }))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source, sleeps } = makeSource(fetchImpl);

    await source.fetchTile(TILE);
    expect(sleeps).toEqual([7000]);
  });

  it("honours an HTTP-date `Retry-After`", async () => {
    const now = Date.parse("2026-05-06T03:25:00Z");
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(503, { "Retry-After": "Wed, 06 May 2026 03:25:05 GMT" }),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source, sleeps } = makeSource(fetchImpl, { now: () => now });

    await source.fetchTile(TILE);
    expect(sleeps).toEqual([5000]);
  });

  it("falls back to jittered exponential backoff when there is no header", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(errorResponse(504)))
      .mockImplementationOnce(() => Promise.resolve(errorResponse(504)))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
    // random() = 1 - epsilon puts us at the top of each jitter window, which
    // makes the exponential growth visible instead of averaged away.
    const { source, sleeps } = makeSource(fetchImpl, {
      random: () => 0.999999,
      backoff: { baseDelayMs: 100, maxDelayMs: 10_000 },
    });

    await source.fetchTile(TILE);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]!).toBeGreaterThan(sleeps[0]!);
  });

  it("gives up after maxRetries and reports how many attempts it made", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(errorResponse(504)));
    const { source } = makeSource(fetchImpl, { maxRetries: 2 });

    await expect(source.fetchTile(TILE)).rejects.toThrow(/3 attempt\(s\)/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retries a transport-level throw (DNS failure, connection reset)", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);

    await expect(source.fetchTile(TILE)).resolves.toMatchObject({ tile: TILE });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries an HTML error page served with status 200", async () => {
    // Real behaviour of loaded public instances: a 200 whose body is an HTML
    // "OSM3S Response" page. `.json()` throws, and that must be retryable
    // rather than a hard failure.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>504 Gateway Timeout</html>", { status: 200 }),
      )
      .mockImplementationOnce(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);

    await expect(source.fetchTile(TILE)).resolves.toMatchObject({ tile: TILE });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("AbortSignal support, end to end", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);
    const controller = new AbortController();
    controller.abort();

    await expect(source.fetchTile(TILE, controller.signal)).rejects.toThrow(
      /aborted/i,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels the underlying fetch when the caller aborts", async () => {
    // Asserts the BEHAVIOUR, not signal identity. The signal handed to `fetch`
    // is deliberately an internal one — see `in-flight-requests.ts` — because
    // de-duplicated callers must not inherit each other's lifetimes. What has
    // to remain true is that a lone caller's abort still reaches the wire.
    let seen: AbortSignal | undefined;
    const fetchImpl = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => {
        seen = init.signal ?? undefined;
        return new Promise<Response>(() => {
          /* never settles: the abort is the only way out */
        });
      });
    const { source } = makeSource(fetchImpl);
    const controller = new AbortController();

    const pending = source.fetchTile(TILE, controller.signal);
    pending.catch(() => undefined); // observed below; keep Node quiet meanwhile
    await Promise.resolve();

    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
    controller.abort();
    expect(seen?.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
  });

  it("an abort during a retry wait is NOT swallowed as a retryable failure", async () => {
    // Leaving an area must stop work promptly. If the abort were treated as
    // "another failed attempt" the client would keep retrying an area the user
    // has already walked away from — exactly the quota waste this class exists
    // to prevent.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(errorResponse(504)));
    const { source } = makeSource(fetchImpl, {
      sleepImpl: () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      },
    });

    await expect(source.fetchTile(TILE)).rejects.toThrow(/aborted/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("the slot budget gates dispatch", () => {
  // Why these tests matter:
  // This is where "do not trip the rate limit on a phone" is actually enforced.
  // Everything else in this file is about recovering WELL from a failure; these
  // are about not making the request at all.

  it("does NOT dispatch when the budget is spent, and says how long to wait", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const budget = new OverpassSlotBudget({ slots: 1, now: () => 1_000_000 });
    budget.penalise(30_000);

    const { source } = makeSource(fetchImpl, { budget });

    await expect(source.fetchTile(TILE)).rejects.toThrow(RateLimitedError);
    // The assertion that matters: ZERO requests, not "a request that failed".
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(source.stats.requests).toBe(0);
    expect(source.stats.rateLimited).toBe(1);
  });

  it("carries the wait on the error, so a caller can schedule a retry", async () => {
    const budget = new OverpassSlotBudget({ slots: 1, now: () => 1_000_000 });
    budget.penalise(30_000);
    const { source } = makeSource(vi.fn(), { budget });

    await expect(source.fetchTile(TILE)).rejects.toMatchObject({
      name: "RateLimitedError",
      retryAfterMs: 30_000,
    });
  });

  it("releases the slot after success, so the next tile can be fetched", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const budget = new OverpassSlotBudget({ slots: 1 });
    const { source } = makeSource(fetchImpl, { budget });

    await source.fetchTile(TILE);
    expect(budget.available).toBe(1);
    await source.fetchTile(TILE_B);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("releases the slot after FAILURE too — otherwise one bad tile costs the allocation", async () => {
    // The leak this guards: a slot taken and never returned looks exactly like
    // a permanent rate limit, and it would compound with every failed tile
    // until the client stopped fetching entirely.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(errorResponse(400)));
    const budget = new OverpassSlotBudget({ slots: 1 });
    const { source } = makeSource(fetchImpl, { budget });

    await expect(source.fetchTile(TILE)).rejects.toThrow();
    expect(budget.available).toBe(1);
  });

  it("penalises the SHARED budget on a 429, not just this request's retry", async () => {
    // A second tile requested in the same tick must not walk into the same wall
    // and earn a second strike. The penalty belongs to the client, not to the
    // request that discovered it.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(errorResponse(429, { "Retry-After": "42" })),
      );
    const budget = new OverpassSlotBudget({ slots: 2, now: () => 1_000_000 });
    const { source } = makeSource(fetchImpl, { budget, maxRetries: 0 });

    await expect(source.fetchTile(TILE)).rejects.toThrow();
    expect(budget.msUntilAvailable()).toBe(42_000);
    await expect(source.fetchTile(TILE_B)).rejects.toThrow(RateLimitedError);
  });

  it("falls back to a measured default penalty when 429 carries no Retry-After", async () => {
    // Measured recovery on the public instances is ~30 s. Erring slightly long
    // costs latency; erring short costs another strike.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(errorResponse(429)));
    const budget = new OverpassSlotBudget({ slots: 2, now: () => 1_000_000 });
    const { source } = makeSource(fetchImpl, { budget, maxRetries: 0 });

    await expect(source.fetchTile(TILE)).rejects.toThrow();
    expect(budget.msUntilAvailable()).toBeGreaterThanOrEqual(30_000);
  });
});

describe("syncBudget", () => {
  const STATUS_BODY = [
    "Connected as: 1354464119",
    "Current time: 2026-07-28T08:40:04Z",
    "Rate limit: 2",
    "Currently running queries (pid, space limit, time limit, start time):",
  ].join("\n");

  it("reads /api/status on the SAME instance it queries", async () => {
    // Reading one server's budget while querying another's would be worse than
    // not checking at all, so the URL is derived rather than configured apart.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(STATUS_BODY)));
    const { source } = makeSource(fetchImpl, {
      endpoints: ["https://example.invalid/api/interpreter"],
    });

    await source.syncBudget();
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      "https://example.invalid/api/status",
    );
  });

  it("costs no slot — checking the budget must not consume it", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(STATUS_BODY)));
    const budget = new OverpassSlotBudget({ slots: 2 });
    const { source } = makeSource(fetchImpl, { budget });

    await source.syncBudget();
    expect(budget.available).toBe(2);
  });

  it("swallows a failure rather than blocking tile fetches", async () => {
    // A status endpoint that is down, moved, or has changed shape must not stop
    // us fetching. It only means we fly on local accounting, which is the
    // authority anyway.
    const { source: onReject } = makeSource(
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(onReject.syncBudget()).resolves.toBeUndefined();

    const { source: onGarbage } = makeSource(
      vi.fn().mockResolvedValue(new Response("<html>nope</html>")),
    );
    await expect(onGarbage.syncBudget()).resolves.toBeUndefined();

    const { source: onError } = makeSource(
      vi.fn().mockResolvedValue(new Response("nope", { status: 500 })),
    );
    await expect(onError.syncBudget()).resolves.toBeUndefined();
  });

  it("adopts the reported allocation", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(STATUS_BODY.replace("Rate limit: 2", "Rate limit: 6")),
        ),
      );
    const { source } = makeSource(fetchImpl);

    const status = await source.syncBudget();
    expect(status?.rateLimit).toBe(6);
    expect(source.budget.capacity).toBe(6);
  });
});

describe("the select-key list is overridable", () => {
  it("uses a narrowed list when one is supplied", async () => {
    // For a self-hosted or otherwise unusual instance. Widening is the safe
    // direction; the option exists so a consumer is not stuck with our list.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl, {
      selectKeys: ["building", "highway"],
    });

    await source.fetchTile(TILE);
    const init = fetchImpl.mock.calls[0]![1];
    const body = new URLSearchParams(init.body as string).get("data")!;
    expect(body).toContain('nwr["building"];');
    expect(body).not.toContain('nwr["landuse"];');
  });
});

describe("attempt-level diagnostics", () => {
  // Why these tests matter:
  // The first real end-to-end fetch took FOUR requests to land one tile, with
  // stats.rateLimited === 0 — so three attempts failed on something else and
  // retry-with-rotation is what produced the data. `stats` counted the retries
  // but not what they were, so the cause was unknowable without re-running
  // against the live API and burning quota to find out.
  //
  // The on-device walk needs this answered, and the walk is expensive to repeat.
  // Recording the outcome of each attempt is the cheap way to make one walk
  // conclusive instead of suggestive.

  it("records the status of every attempt, in order", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(504))
      .mockResolvedValueOnce(errorResponse(504))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const { source } = makeSource(fetchImpl);

    await source.fetchTile(TILE);

    expect(source.stats.attempts.map((a) => a.status)).toEqual([504, 504, 200]);
  });

  it("names the endpoint each attempt used, so rotation can be judged", async () => {
    // Rotation buys failover across one operator's backends. Whether it is
    // actually helping — or whether every attempt hit the same backend — is not
    // answerable from a retry count.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(504))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const { source } = makeSource(fetchImpl);

    await source.fetchTile(TILE);

    for (const attempt of source.stats.attempts) {
      expect(attempt.endpoint).toMatch(/^https:\/\//);
    }
    expect(source.stats.attempts).toHaveLength(2);
  });

  it("records a transport failure with no status rather than dropping it", async () => {
    // A DNS failure or a dropped connection has no HTTP status. Omitting those
    // attempts would make the log claim fewer requests than were really made —
    // the one direction of error that under-reports quota use.
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const { source } = makeSource(fetchImpl);

    await source.fetchTile(TILE);

    expect(source.stats.attempts).toHaveLength(2);
    expect(source.stats.attempts[0]!.status).toBeUndefined();
    expect(source.stats.attempts[0]!.error).toMatch(/ECONNRESET/);
  });

  it("keeps the attempt log bounded, so a long session cannot grow it forever", async () => {
    // A walking user fetches for hours. An unbounded diagnostic array is a slow
    // memory leak in the one component that must survive a long field session.
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl, { maxAttemptLog: 3 });

    for (let i = 0; i < 10; i++) {
      await source.fetchTile(`${TILE.slice(0, -1)}${i}`);
    }

    expect(source.stats.attempts.length).toBeLessThanOrEqual(3);
    // The RECENT attempts are the ones worth keeping — a failure being
    // diagnosed is nearly always the latest one.
    expect(source.stats.requests).toBe(10);
  });

  it("counts requests and attempts consistently", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(504))
      .mockResolvedValueOnce(jsonResponse(OK_BODY));
    const { source } = makeSource(fetchImpl);

    await source.fetchTile(TILE);
    expect(source.stats.attempts).toHaveLength(source.stats.requests);
  });
});

describe("the attempt log stays consistent with the request count", () => {
  /**
   * WHY THIS MATTERS. `stats.attempts` is the diagnostic the on-device walk
   * depends on to answer "how much quota did a tile actually cost?", and the
   * suite already asserts `attempts.length === requests`. That invariant had a
   * hole: a 200 whose body is not JSON is recorded once with its status, then
   * `toResult`'s `.json()` throws and the catch recorded it a SECOND time.
   *
   * An instance answering 200 with an HTML error page is precisely the case the
   * log exists to diagnose — it is what "four requests, rateLimited === 0"
   * looked like — so over-reporting exactly there is the worst place for it.
   */
  it("records ONE attempt for a 200 whose body is not JSON", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response("<html>Gateway problem</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    ) as unknown as typeof fetch;

    const source = new OverpassSource({
      userAgent: "test",
      fetchImpl,
      maxRetries: 1,
      sleepImpl: () => Promise.resolve(),
    });

    await expect(source.fetchTile(TILE)).rejects.toThrow();
    expect(source.stats.attempts).toHaveLength(source.stats.requests);
  });

  it("still records an attempt when the dispatch itself fails", async () => {
    // The other direction: a transport failure produced no status and no
    // record above, so the catch must add one. Dropping it would make the log
    // claim fewer requests than were made — under-reporting quota use.
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError("network down")),
    ) as unknown as typeof fetch;

    const source = new OverpassSource({
      userAgent: "test",
      fetchImpl,
      maxRetries: 1,
      sleepImpl: () => Promise.resolve(),
    });

    await expect(source.fetchTile(TILE)).rejects.toThrow();
    expect(source.stats.attempts).toHaveLength(source.stats.requests);
    expect(source.stats.attempts.every((a) => a.error !== undefined)).toBe(
      true,
    );
  });
});
