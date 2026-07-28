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
  DEFAULT_OVERPASS_ENDPOINTS,
} from "./overpass-source.js";
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
    random: () => 0, // deterministic endpoint choice + zero jitter
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
    expect(body).toContain('nwr[~"."~"."]'); // "has at least one tag"
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
    expect(result.sourceId).toBe("overpass:overpass-api.de");
    expect(result.schemaVersion).toBe(1);
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

  it("passes the signal through to fetch", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(OK_BODY)));
    const { source } = makeSource(fetchImpl);
    const controller = new AbortController();

    await source.fetchTile(TILE, controller.signal);
    expect(fetchImpl.mock.calls[0]![1].signal).toBe(controller.signal);
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
