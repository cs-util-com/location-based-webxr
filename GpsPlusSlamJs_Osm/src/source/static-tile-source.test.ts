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
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const queue = script[`${method} ${url}`];
    const next = queue?.shift();
    if (next === undefined) throw new Error(`unscripted ${method} ${url}`);
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

/** The direct race, recorded: the tests only need to know it was asked. */
class FallbackSpy implements OsmDataSource {
  readonly attribution = "fallback";
  readonly sourceId = "overpass";
  readonly calls: { tile: string; options?: FetchTileOptions }[] = [];
  constructor(private readonly started?: () => void) {}
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
      [`GET ${TILE_URL}`]: [
        new Response(PAYLOAD, {
          status: 200,
          headers: { "x-filled-at": "2026-11-11T09:30:00.000Z" },
        }),
      ],
    });
    const result = await source.fetchTile(TILE);
    expect(result.tile).toBe(TILE);
    // Provenance is when the host fetched the data, not when we read the file.
    expect(result.fetchedAt).toBe(Date.parse("2026-11-11T09:30:00.000Z"));
    expect(result.features).toHaveLength(1);
    expect(result.osmBaseTimestamp).toBe("2026-11-11T09:00:00Z");
    expect(result.schemaVersion).toBe(OVERPASS_SCHEMA_VERSION);
    expect(result.sourceId).toBe("static:tiles.example.dev");
    expect(result.timings?.servedBy).toBe("network");
    expect(fallback.calls).toEqual([]);
    expect(calls).toEqual([{ method: "GET", url: TILE_URL }]);
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
      const { source, fallback, calls } = setup({
        [`GET ${TILE_URL}`]: [new Response("not found", { status: 404 })],
        [`POST ${FILL_URL}`]: [json(status, { status: "no" })],
      });
      const result = await source.fetchTile(TILE, { speculative: true });
      expect(result.sourceId).toBe("overpass:test");
      expect(fallback.calls).toEqual([
        { tile: TILE, options: { speculative: true } },
      ]);
      // Remembered: the next tile goes straight to the race.
      await source.fetchTile(TILE);
      expect(calls).toHaveLength(2);
      expect(fallback.calls).toHaveLength(2);
    });
  }

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
        if (fallback.calls.length === 0) {
          expect(result.sourceId).toBe("static:tiles.example.dev");
        }
      }),
    );
  });
});
