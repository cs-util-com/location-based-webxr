import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { StaticTileSource } from "./static-tile-source.js";
import type {
  FetchTileOptions,
  OsmDataSource,
  OsmTileResult,
} from "./osm-data-source.js";
import { OVERPASS_SCHEMA_VERSION } from "./overpass-query.js";

// Why these tests matter: the static tile host is an opt-in in front of the
// direct Overpass race, and its whole promise is that it can never make a
// tile slower to get than today. So every way the host can say no (a refusal,
// an error, a fill that takes too long) must hand the tile to the race at
// once, never both at the same time, and the host must then be left alone
// for a while instead of being asked again for every tile.

const TILE = latLngToCell(50.9384, 6.9598, 7);
const BASE = "https://tiles.example.dev";
const TILE_URL = `${BASE}/osm/v${OVERPASS_SCHEMA_VERSION}/${TILE}.json.gz`;
const FILL_URL = `${BASE}/fill/v${OVERPASS_SCHEMA_VERSION}/${TILE}`;

const PAYLOAD = JSON.stringify({
  version: 0.6,
  osm3s: { timestamp_osm_base: "2026-11-11T09:00:00Z" },
  elements: [
    {
      type: "node",
      id: 1,
      lat: 50.9384,
      lon: 6.9598,
      tags: { amenity: "bench" },
    },
  ],
});

type Reply = Response | Error;

/** A fetch that answers from a script and records every call. */
function scriptedFetch(script: Record<string, Reply[]>) {
  const calls: { method: string; url: string }[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const queue = script[`${method} ${url}`];
    const next = queue?.shift();
    if (next === undefined) {
      return Promise.reject(new Error(`unscripted ${method} ${url}`));
    }
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }) as typeof fetch;
  return { impl, calls };
}

/** The direct race, recorded: the tests only need to know it was asked. */
class FallbackSpy implements OsmDataSource {
  readonly attribution = "fallback";
  readonly sourceId = "overpass";
  readonly calls: { tile: string; options?: FetchTileOptions }[] = [];
  private readonly started: (() => void) | undefined;
  constructor(started?: () => void) {
    this.started = started;
  }
  fetchTile(tile: string, options?: FetchTileOptions): Promise<OsmTileResult> {
    this.started?.();
    this.calls.push({ tile, ...(options === undefined ? {} : { options }) });
    return Promise.resolve({
      tile,
      features: [],
      fetchedAt: 1,
      sourceId: "overpass:test",
      schemaVersion: OVERPASS_SCHEMA_VERSION,
      skipped: [],
    });
  }
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup(
  script: Record<string, Reply[]>,
  extra: { maxWaitMs?: number; refusalMemoryMs?: number } = {},
) {
  let clock = 1_000_000;
  const slept: number[] = [];
  const fetchMock = scriptedFetch(script);
  const fallback = new FallbackSpy();
  const source = new StaticTileSource({
    baseUrl: BASE,
    fallback,
    fetchImpl: fetchMock.impl,
    now: () => clock,
    sleepImpl: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    pollIntervalMs: 5_000,
    maxWaitMs: extra.maxWaitMs ?? 60_000,
    refusalMemoryMs: extra.refusalMemoryMs ?? 600_000,
  });
  return {
    source,
    fallback,
    calls: fetchMock.calls,
    slept,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("StaticTileSource", () => {
  it("serves a stored tile from the host, parsed exactly like an Overpass answer", async () => {
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [new Response(PAYLOAD, { status: 200 })],
    });
    const result = await source.fetchTile(TILE);
    expect(result.tile).toBe(TILE);
    // Provenance is the data's age (its osm_base), not when we read the file:
    // a month-old file must not look freshly fetched to the cache.
    expect(result.fetchedAt).toBe(Date.parse("2026-11-11T09:00:00Z"));
    expect(result.features).toHaveLength(1);
    expect(result.osmBaseTimestamp).toBe("2026-11-11T09:00:00Z");
    expect(result.schemaVersion).toBe(OVERPASS_SCHEMA_VERSION);
    expect(result.sourceId).toBe("static:tiles.example.dev");
    expect(result.timings?.servedBy).toBe("network");
    expect(fallback.calls).toEqual([]);
    expect(calls).toEqual([{ method: "GET", url: TILE_URL }]);
  });

  it("dates a stored tile without an osm_base by the time it was read", async () => {
    const bare = JSON.stringify({ version: 0.6, elements: [] });
    const { source } = setup({
      [`GET ${TILE_URL}`]: [new Response(bare, { status: 200 })],
    });
    expect((await source.fetchTile(TILE)).fetchedAt).toBe(1_000_000);
  });

  it("asks for a missing tile to be filled, polls, and serves it once it is there", async () => {
    const { source, fallback, calls, slept } = setup({
      [`GET ${TILE_URL}`]: [
        new Response("not found", { status: 404 }),
        new Response("not found", { status: 404 }),
        new Response(PAYLOAD, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [json(202, { status: "queued" })],
    });
    const result = await source.fetchTile(TILE);
    expect(result.features).toHaveLength(1);
    expect(fallback.calls).toEqual([]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "GET"]);
    expect(slept).toEqual([5_000, 5_000]);
  });

  it("reads the tile at once when the fill answer says it is already there", async () => {
    const { source, calls, slept } = setup({
      [`GET ${TILE_URL}`]: [
        new Response("not found", { status: 404 }),
        new Response(PAYLOAD, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [json(200, { status: "present" })],
    });
    await source.fetchTile(TILE);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
    expect(slept).toEqual([]);
  });

  for (const status of [429, 503, 403, 500]) {
    it(`falls back to the race at once when the fill answers ${status}, and remembers it`, async () => {
      const controller = new AbortController();
      const { source, fallback, calls } = setup({
        [`GET ${TILE_URL}`]: [
          new Response("not found", { status: 404 }),
          new Response("not found", { status: 404 }),
        ],
        [`POST ${FILL_URL}`]: [json(status, { status: "no" })],
      });
      const result = await source.fetchTile(TILE, {
        signal: controller.signal,
      });
      expect(result.sourceId).toBe("overpass:test");
      expect(fallback.calls).toEqual([
        { tile: TILE, options: { signal: controller.signal } },
      ]);
      // Remembered: the next tile is still looked up, but not filled.
      await source.fetchTile(TILE);
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
      expect(fallback.calls).toHaveLength(2);
    });
  }

  it("still serves stored tiles while the host's fill refusal is remembered", async () => {
    // A refused fill (the daily cap, the per-IP limit) says nothing about
    // the files already stored, which cost the host nothing to serve.
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [
        new Response("nf", { status: 404 }),
        new Response(PAYLOAD, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [json(503, { status: "cap" })],
    });
    await source.fetchTile(TILE);
    const second = await source.fetchTile(TILE);
    expect(second.sourceId).toBe("static:tiles.example.dev");
    expect(fallback.calls).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("a speculative fetch only reads: a missing tile goes to the race without a fill request", async () => {
    // Nobody waits on a ring warm, so it must neither wait a minute for a
    // fill nor spend the host's fill budget on a tile nobody asked for.
    const { source, fallback, calls, slept } = setup({
      [`GET ${TILE_URL}`]: [new Response("nf", { status: 404 })],
    });
    const result = await source.fetchTile(TILE, { speculative: true });
    expect(result.sourceId).toBe("overpass:test");
    expect(fallback.calls).toEqual([
      { tile: TILE, options: { speculative: true } },
    ]);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    expect(slept).toEqual([]);
  });

  it("a speculative fetch serves a stored tile from the host", async () => {
    const { source, fallback } = setup({
      [`GET ${TILE_URL}`]: [new Response(PAYLOAD, { status: 200 })],
    });
    const result = await source.fetchTile(TILE, { speculative: true });
    expect(result.sourceId).toBe("static:tiles.example.dev");
    expect(fallback.calls).toEqual([]);
  });

  it("a speculative miss is not a refusal: the next waited-for tile still asks for a fill", async () => {
    const { source, calls } = setup({
      [`GET ${TILE_URL}`]: [
        new Response("nf", { status: 404 }),
        new Response("nf", { status: 404 }),
        new Response(PAYLOAD, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [json(202, { status: "queued", ahead: 0 })],
    });
    await source.fetchTile(TILE, { speculative: true });
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("static:tiles.example.dev");
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST", "GET"]);
  });

  it("a tile in fill backoff goes to the race without the host refusing other tiles", async () => {
    // The host answers 503 backoff for one cell whose fill failed, was
    // killed, or is running right now: a fact about that cell, not the host.
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [
        new Response("nf", { status: 404 }),
        new Response("nf", { status: 404 }),
      ],
      [`POST ${FILL_URL}`]: [
        json(503, { status: "backoff" }),
        json(202, { status: "queued", ahead: 2 }),
      ],
    });
    await source.fetchTile(TILE);
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(2);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "POST"]);
  });

  it("does not wait behind other fills: a queued answer with fills ahead goes to the race at once", async () => {
    // A fill takes 30-75 s; behind another one the viewer would wait past
    // the bounded wait for nothing. The host still fills the tile for later.
    const { source, fallback, calls, slept } = setup({
      [`GET ${TILE_URL}`]: [
        new Response("nf", { status: 404 }),
        new Response("nf", { status: 404 }),
      ],
      [`POST ${FILL_URL}`]: [
        json(202, { status: "queued", ahead: 2 }),
        json(202, { status: "queued", ahead: 0 }),
      ],
    });
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("overpass:test");
    expect(slept).toEqual([]);
    expect(fallback.calls).toHaveLength(1);
    // Not a refusal: the next tile asks for a fill again.
    await source.fetchTile(TILE).catch(() => undefined);
    expect(calls.map((c) => c.method).slice(0, 4)).toEqual([
      "GET",
      "POST",
      "GET",
      "POST",
    ]);
  });

  it("asks the host to refresh a tile whose data is older than 30 days, once, and serves the old file meanwhile", async () => {
    const old = PAYLOAD.replace("2026-11-11T09:00:00Z", "1970-01-01T00:00:00Z");
    const { source, calls, advance } = setup({
      [`GET ${TILE_URL}`]: [
        new Response(old, { status: 200 }),
        new Response(old, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [json(200, { status: "refreshing" })],
    });
    advance(31 * 86_400_000);
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("static:tiles.example.dev");
    await source.fetchTile(TILE);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("sends no refresh for a young tile, and a failed refresh changes nothing", async () => {
    const old = PAYLOAD.replace("2026-11-11T09:00:00Z", "1970-01-01T00:00:00Z");
    const young = setup({
      [`GET ${TILE_URL}`]: [new Response(old, { status: 200 })],
    });
    await young.source.fetchTile(TILE);
    expect(young.calls.map((c) => c.method)).toEqual(["GET"]);

    const failing = setup({
      [`GET ${TILE_URL}`]: [
        new Response(old, { status: 200 }),
        new Response(PAYLOAD, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [new TypeError("offline")],
    });
    failing.advance(31 * 86_400_000);
    await failing.source.fetchTile(TILE);
    const next = await failing.source.fetchTile(TILE);
    expect(next.sourceId).toBe("static:tiles.example.dev");
    expect(failing.fallback.calls).toEqual([]);
  });

  it("falls back when the host cannot be reached at all", async () => {
    const { source, fallback } = setup({
      [`GET ${TILE_URL}`]: [new TypeError("Failed to fetch")],
    });
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(1);
  });

  it("falls back when a stored file is not valid JSON", async () => {
    const { source, fallback } = setup({
      [`GET ${TILE_URL}`]: [new Response("<html>", { status: 200 })],
    });
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(1);
  });

  it("stops polling at the bounded wait and falls back, never both at once", async () => {
    const notFound = (): Response => new Response("nf", { status: 404 });
    const hostCalls = scriptedFetch({
      [`GET ${TILE_URL}`]: Array.from({ length: 20 }, notFound),
      [`POST ${FILL_URL}`]: [json(202, { status: "queued" })],
    });
    let hostCallsWhenRaceStarted = -1;
    const fallback = new FallbackSpy(() => {
      hostCallsWhenRaceStarted = hostCalls.calls.length;
    });
    let clock = 0;
    const slept: number[] = [];
    const source = new StaticTileSource({
      baseUrl: BASE,
      fallback,
      fetchImpl: hostCalls.impl,
      now: () => clock,
      sleepImpl: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
      pollIntervalMs: 5_000,
      maxWaitMs: 20_000,
    });
    await source.fetchTile(TILE);
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000);
    expect(fallback.calls).toHaveLength(1);
    // Nothing reached the host after the race began.
    expect(hostCalls.calls).toHaveLength(hostCallsWhenRaceStarted);
  });

  it("asks the host again once the refusal memory has passed", async () => {
    const { source, fallback, calls, advance } = setup(
      {
        [`GET ${TILE_URL}`]: [
          new Response("nf", { status: 404 }),
          new Response(PAYLOAD, { status: 200 }),
        ],
        [`POST ${FILL_URL}`]: [json(503, { status: "cap" })],
      },
      { refusalMemoryMs: 60_000 },
    );
    await source.fetchTile(TILE);
    advance(60_001);
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("static:tiles.example.dev");
    expect(fallback.calls).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET"]);
  });

  it("rethrows an abort instead of falling back", async () => {
    const controller = new AbortController();
    controller.abort();
    const { source, fallback } = setup({});
    await expect(
      source.fetchTile(TILE, { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(fallback.calls).toEqual([]);
  });

  it("refuses a base URL that is not http(s)", () => {
    expect(
      () =>
        new StaticTileSource({
          baseUrl: "ftp://x",
          fallback: new FallbackSpy(),
        }),
    ).toThrow(RangeError);
  });

  it("property: whatever the host answers, the tile is served exactly once and the race runs at most once", async () => {
    const reply = fc.oneof(
      fc.constantFrom(200, 202, 404, 429, 500, 503).map((s) => ({ s })),
      fc.constant({ s: -1 }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(reply, { maxLength: 12 }), async (replies) => {
        const make = (r: { s: number }): Reply =>
          r.s === -1
            ? new TypeError("offline")
            : r.s === 200
              ? new Response(PAYLOAD, { status: 200 })
              : json(r.s, { status: "x" });
        const { source, fallback } = setup(
          {
            [`GET ${TILE_URL}`]: replies.map(make),
            [`POST ${FILL_URL}`]: replies.map(make),
          },
          { maxWaitMs: 15_000 },
        );
        const result = await source.fetchTile(TILE);
        expect(result.tile).toBe(TILE);
        expect(fallback.calls.length).toBeLessThanOrEqual(1);
        // Served by the host unless the race ran.
        const expectedSource =
          fallback.calls.length === 0
            ? "static:tiles.example.dev"
            : "overpass:test";
        expect(result.sourceId).toBe(expectedSource);
      }),
    );
  });
});
