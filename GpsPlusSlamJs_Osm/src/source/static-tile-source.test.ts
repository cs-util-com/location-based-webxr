import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { StaticTileSource } from "./static-tile-source.js";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "./overpass-source.js";
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
const REPORT_URL = `${BASE}/report/v${OVERPASS_SCHEMA_VERSION}/${TILE}`;

/** A response whose body's cancel() rejects, as a torn stream's can. */
function uncancellable(status: number): Response {
  const response = new Response("x", { status });
  Object.defineProperty(response, "body", {
    value: { cancel: () => Promise.reject(new Error("cancel failed")) },
  });
  return response;
}

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

/** A scripted answer: a response, a network error, or one built per call. */
type Reply = Response | Error | ((init?: RequestInit) => Promise<Response>);

interface RecordedCall {
  method: string;
  url: string;
  signal?: AbortSignal;
  cache?: RequestCache;
}

/** The parts of a request's init the tests look at. */
function initParts(
  init: RequestInit | undefined,
): Pick<RecordedCall, "signal" | "cache"> {
  return {
    ...(init?.signal == null ? {} : { signal: init.signal }),
    ...(init?.cache === undefined ? {} : { cache: init.cache }),
  };
}

/** A fetch that answers from a script and records every call. */
function scriptedFetch(script: Record<string, Reply[]>) {
  const calls: RecordedCall[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url, ...initParts(init) });
    const queue = script[`${method} ${url}`];
    const next = queue?.shift();
    if (next === undefined) {
      return Promise.reject(new Error(`unscripted ${method} ${url}`));
    }
    if (next instanceof Error) return Promise.reject(next);
    if (typeof next === "function") return next(init);
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
  extra: {
    maxWaitMs?: number;
    refusalMemoryMs?: number;
    requestTimeoutMs?: number;
    /** Extra clock time per sleep call, by index: a sleep that overshoots. */
    oversleepMs?: readonly number[];
  } = {},
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
      clock += ms + (extra.oversleepMs?.[slept.length] ?? 0);
      slept.push(ms);
      return Promise.resolve();
    },
    pollIntervalMs: 5_000,
    maxWaitMs: extra.maxWaitMs ?? 60_000,
    refusalMemoryMs: extra.refusalMemoryMs ?? 600_000,
    ...(extra.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: extra.requestTimeoutMs }),
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
    expect(calls.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: "GET", url: TILE_URL },
    ]);
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
    // The wait for the host's fill is time before the bytes existed, not
    // transport: the delivering read took no clock time here.
    expect(result.timings?.transportMs).toBe(0);
    expect(result.timings?.slotWaitMs).toBe(10_000);
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

  it("sends no refresh for a speculative read of an old tile", async () => {
    // A ring warm has nobody waiting on it and asks the host for nothing;
    // the next waited-for read of the tile still asks once.
    const old = PAYLOAD.replace("2026-11-11T09:00:00Z", "1970-01-01T00:00:00Z");
    const { source, calls, advance } = setup({
      [`GET ${TILE_URL}`]: [
        new Response(old, { status: 200 }),
        new Response(old, { status: 200 }),
      ],
      [`POST ${FILL_URL}`]: [json(200, { status: "refreshing" })],
    });
    advance(31 * 86_400_000);
    await source.fetchTile(TILE, { speculative: true });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    await source.fetchTile(TILE);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST"]);
  });

  it("a refresh answer whose body cannot be cancelled raises nothing", async () => {
    // The refresh is fire-and-forget; a rejected cancel() there was an
    // unhandled rejection, which the test runner reports as an error.
    const old = PAYLOAD.replace("2026-11-11T09:00:00Z", "1970-01-01T00:00:00Z");
    const { source, calls, advance } = setup({
      [`GET ${TILE_URL}`]: [new Response(old, { status: 200 })],
      [`POST ${FILL_URL}`]: [uncancellable(200)],
    });
    advance(31 * 86_400_000);
    const result = await source.fetchTile(TILE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.features).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("a speculative miss whose body cannot be cancelled is still no refusal", async () => {
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [uncancellable(404), uncancellable(404)],
      [`POST ${FILL_URL}`]: [json(202, { status: "queued", ahead: 2 })],
    });
    await source.fetchTile(TILE, { speculative: true });
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(2);
    // The second, waited-for fetch still asked for a fill.
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "POST"]);
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

  it("rejects a stored partial answer (a remark), races the tile, and reports it once", async () => {
    // Overpass marks a timeout or memory abort with a top-level `remark`
    // and a partial elements array; the host stores an operator's gzip
    // answer on its head alone, so the reader is where it is caught.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: 'runtime error: Query timed out in "query" at line 3',
    });
    const stored = (): Response =>
      new Response(partial, { status: 200, headers: { etag: '"e1"' } });
    const reportUrl = `${REPORT_URL}?etag=${encodeURIComponent('"e1"')}`;
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [stored(), stored(), stored(), stored()],
      [`POST ${reportUrl}`]: [json(202, { status: "checking" })],
      [`POST ${FILL_URL}`]: [json(200, { status: "present" })],
    });
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("overpass:test");
    expect(fallback.calls).toHaveLength(1);
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(2);
    // The first bad read is read once more past the browser cache, later
    // ones not; one report per tile per session, and no fill asked for a
    // stored tile.
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${TILE_URL}`,
      `GET ${TILE_URL}`,
      `POST ${reportUrl}`,
      `GET ${TILE_URL}`,
    ]);
  });

  it("re-reads a bad tile past the browser cache at most once per session, speculative reads included", async () => {
    // Why this test matters: a re-read past the cache is a full download
    // from the host. A bad tile that stays bad (its replace is bounded to
    // once a day) would otherwise cost two downloads on every visit and
    // every ring warm.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const stored = (): Response =>
      new Response(partial, { status: 200, headers: { etag: '"e1"' } });
    const reportUrl = `${REPORT_URL}?etag=${encodeURIComponent('"e1"')}`;
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [stored(), stored(), stored(), stored()],
      [`POST ${reportUrl}`]: [json(202, { status: "checking" })],
    });
    await source.fetchTile(TILE, { speculative: true });
    await source.fetchTile(TILE, { speculative: true });
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(3);
    expect(calls.map((c) => `${c.method} ${c.cache ?? ""}`)).toEqual([
      "GET ",
      "GET no-cache",
      "GET ",
      "GET ",
      "POST ",
    ]);
  });

  it("serves a stored answer whose remark is empty or whitespace", async () => {
    // Why this test matters: an empty remark is no mark of a cut answer;
    // refusing it would race and report a good tile.
    for (const remark of ["", " \n "]) {
      const body = JSON.stringify({ ...JSON.parse(PAYLOAD), remark });
      const { source, fallback, calls } = setup({
        [`GET ${TILE_URL}`]: [
          new Response(body, { status: 200, headers: { etag: '"e1"' } }),
        ],
      });
      const result = await source.fetchTile(TILE);
      expect(result.sourceId).toBe("static:tiles.example.dev");
      expect(fallback.calls).toEqual([]);
      expect(calls).toHaveLength(1);
    }
  });

  it("logs a refused stored remark on one bounded line", async () => {
    // Why this test matters: the remark is what tells a reader why a stored
    // tile was refused; the host's operator wrote it, so its length and
    // line breaks are bounded before it reaches the console.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: `runtime error: Query timed out\n${"y".repeat(2_000)}`,
    });
    const stored = (): Response => new Response(partial, { status: 200 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { source } = setup({
        [`GET ${TILE_URL}`]: [stored(), stored()],
      });
      await source.fetchTile(TILE);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toMatch(/partial answer: runtime error: Query timed out y/);
      expect(line).not.toMatch(/\n/);
      expect(line.length).toBeLessThan(500);
    } finally {
      warn.mockRestore();
    }
  });

  it("re-reads a bad tile once past the browser cache and serves the fresh copy without a report", async () => {
    // Why this test matters: the host replaces a bad tile, but the browser
    // may still hold the old bad copy in its HTTP cache. Without a re-read
    // that bypasses the cache, every visit would race the tile and report
    // an object the host no longer stores.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [
        new Response(partial, { status: 200, headers: { etag: '"old"' } }),
        new Response(PAYLOAD, { status: 200, headers: { etag: '"new"' } }),
      ],
    });
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("static:tiles.example.dev");
    expect(fallback.calls).toEqual([]);
    expect(calls.map((c) => [c.method, c.cache])).toEqual([
      ["GET", undefined],
      ["GET", "no-cache"],
    ]);
  });

  it("a speculative read of a bad tile sends no report", async () => {
    // Why this test matters: a speculative read (a ring warm) asks the host
    // for nothing. A report queues work on the host, so warming tiles nobody
    // looks at must not send one; the tile still goes to the race.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const stored = (): Response =>
      new Response(partial, { status: 200, headers: { etag: '"e1"' } });
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [stored(), stored()],
    });
    await source.fetchTile(TILE, { speculative: true });
    expect(fallback.calls).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
  });

  it("rejects a stored body without an elements array, and a bad tile is no refusal", async () => {
    const other = latLngToCell(47.0468, 8.3745, 7);
    const otherUrl = `${BASE}/osm/v${OVERPASS_SCHEMA_VERSION}/${other}.json.gz`;
    const otherFill = `${BASE}/fill/v${OVERPASS_SCHEMA_VERSION}/${other}`;
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [
        new Response(JSON.stringify({ version: 0.6 }), { status: 200 }),
        new Response(JSON.stringify({ version: 0.6 }), { status: 200 }),
      ],
      [`GET ${otherUrl}`]: [
        new Response("nf", { status: 404 }),
        new Response(PAYLOAD, { status: 200 }),
      ],
      [`POST ${otherFill}`]: [json(200, { status: "present" })],
    });
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(1);
    // Without an ETag nothing can be reported; the next tile is still
    // filled by the host (the bad file said nothing about the host).
    const next = await source.fetchTile(other);
    expect(next.sourceId).toBe("static:tiles.example.dev");
    expect(calls.map((c) => c.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "POST",
      "GET",
    ]);
  });

  it("gives every host request a time limit, and a host that does not answer in it goes to the race", async () => {
    // Without one a stalled connection to the host held the tile for as
    // long as the browser let it, while the race would have delivered it.
    const fallback = new FallbackSpy();
    const signals: AbortSignal[] = [];
    const source = new StaticTileSource({
      baseUrl: BASE,
      fallback,
      requestTimeoutMs: 20,
      fetchImpl: (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal == null) return;
          signals.push(signal);
          signal.addEventListener("abort", () => {
            reject(signal.reason as Error);
          });
        }),
    });
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("overpass:test");
    expect(signals).toHaveLength(1);
    expect((signals[0]?.reason as Error).name).toBe("TimeoutError");
  });

  it("the time limit also covers a body that stalls after the headers", async () => {
    // Why this test matters: a host can send its headers at once and then
    // stall the body. If the limit only covered the wait for the headers,
    // the tile would hang on the body read for as long as the browser let
    // it. A real fetch ties the body to the request's signal; this fake does
    // the same.
    const fallback = new FallbackSpy();
    const source = new StaticTileSource({
      baseUrl: BASE,
      fallback,
      requestTimeoutMs: 20,
      fetchImpl: (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"elements":['));
            init?.signal?.addEventListener("abort", () => {
              controller.error(init.signal?.reason);
            });
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      },
    });
    const result = await source.fetchTile(TILE);
    expect(result.sourceId).toBe("overpass:test");
    expect(fallback.calls).toHaveLength(1);
  });

  it("keeps the caller's abort a hard abort under the time limit", async () => {
    const controller = new AbortController();
    const { source, fallback, calls } = setup({
      [`GET ${TILE_URL}`]: [new Response(PAYLOAD, { status: 200 })],
    });
    await source.fetchTile(TILE, { signal: controller.signal });
    // The signal handed to fetch follows the caller's as well as the limit.
    const signal = calls[0]?.signal;
    expect(signal).toBeDefined();
    expect(signal).not.toBe(controller.signal);
    controller.abort();
    expect(signal?.aborted).toBe(true);
    expect(fallback.calls).toEqual([]);
  });

  it("uses the direct race's per-request deadline as its default time limit", async () => {
    // The host must never give up sooner than the race would at any
    // bandwidth: both fetch the same compressed bytes under one deadline.
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const { source } = setup({
        [`GET ${TILE_URL}`]: [new Response(PAYLOAD, { status: 200 })],
      });
      await source.fetchTile(TILE);
      expect(timeout.mock.calls).toEqual([[DEFAULT_REQUEST_TIMEOUT_MS]]);
    } finally {
      timeout.mockRestore();
    }
  });

  it("keeps the wait for each fill-wait answer's headers within the time left of it", async () => {
    // Why this test matters: the wait for a fill is bounded by maxWaitMs,
    // but a poll started near its end with the full per-request limit could
    // hold the tile far past it. What is left bounds the wait for the
    // headers only; every request, body included, keeps the plain limit.
    // The first read of a stored file is not part of the fill wait.
    const notFound = (): Response => new Response("nf", { status: 404 });
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const timer = vi.spyOn(globalThis, "setTimeout");
    try {
      const { source, fallback } = setup(
        {
          [`GET ${TILE_URL}`]: Array.from({ length: 5 }, notFound),
          [`POST ${FILL_URL}`]: [json(202, { status: "queued" })],
        },
        { maxWaitMs: 20_000 },
      );
      await source.fetchTile(TILE);
      expect(fallback.calls).toHaveLength(1);
      expect(timeout.mock.calls).toEqual(
        Array.from({ length: 5 }, () => [DEFAULT_REQUEST_TIMEOUT_MS]),
      );
      expect(timer.mock.calls.map((call) => call[1])).toEqual([
        20_000, 15_000, 10_000, 5_000,
      ]);
    } finally {
      timeout.mockRestore();
      timer.mockRestore();
    }
  });

  for (const [requestTimeoutMs, delays] of [
    [4_999, []],
    [5_000, []],
    [5_001, [5_000]],
    [9_999, [5_000]],
    [10_000, [5_000]],
    [10_001, [10_000, 5_000]],
  ] as const) {
    it(`sets a header timer only where the wait left is under the ${requestTimeoutMs} ms request limit`, async () => {
      // Why this test matters: with at least the request limit left, that
      // limit already bounds the headers; a timer there is one more to
      // clear, and a wait above about 24.8 days would overflow setTimeout.
      const notFound = (): Response => new Response("nf", { status: 404 });
      const timer = vi.spyOn(globalThis, "setTimeout");
      try {
        const { source } = setup(
          {
            [`GET ${TILE_URL}`]: Array.from({ length: 5 }, notFound),
            [`POST ${FILL_URL}`]: [json(202, { status: "queued" })],
          },
          { maxWaitMs: 20_000, requestTimeoutMs },
        );
        await source.fetchTile(TILE);
        expect(timer.mock.calls.map((call) => call[1])).toEqual(delays);
      } finally {
        timer.mockRestore();
      }
    });
  }

  /** Headers after `headersMs`, then the body after `bodyMs` more (real ms). */
  function slowStored(
    body: string,
    { headersMs = 0, bodyMs = 0 }: { headersMs?: number; bodyMs?: number },
  ): (init?: RequestInit) => Promise<Response> {
    return (init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const done = setTimeout(() => {
              controller.enqueue(new TextEncoder().encode(body));
              controller.close();
            }, bodyMs);
            signal?.addEventListener("abort", () => {
              clearTimeout(done);
              controller.error(signal.reason);
            });
          },
        });
        const headers = setTimeout(() => {
          resolve(new Response(stream, { status: 200 }));
        }, headersMs);
        signal?.addEventListener("abort", () => {
          clearTimeout(headers);
          reject(signal.reason as Error);
        });
      });
  }

  /**
   * A fill wait of `10 s + leftMs` (polls every 5 s) leaves `leftMs` for
   * the third read: two misses, then `late` (the third read, and any
   * re-read of it).
   */
  function lateFill(
    leftMs: number,
    late: readonly Reply[],
    requestTimeoutMs?: number,
    more: Record<string, Reply[]> = {},
  ) {
    return setup(
      {
        ...more,
        [`GET ${TILE_URL}`]: [
          new Response("nf", { status: 404 }),
          new Response("nf", { status: 404 }),
          ...late,
        ],
        [`POST ${FILL_URL}`]: [json(202, { status: "queued" })],
      },
      {
        maxWaitMs: 10_000 + leftMs,
        ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      },
    );
  }

  // The wait left and the body time in real ms, scaled down from the case
  // that matters (1 s left, a 3 s body: a dense tile at a few Mbps) so the
  // test stays fast; the pairs sit on both sides of "body longer than what
  // is left".
  for (const [leftMs, bodyMs] of [
    [100, 30],
    [300, 100],
    [100, 300],
    [40, 200],
  ] as const) {
    it(`serves a tile filled late in the wait when its body takes ${bodyMs} ms with ${leftMs} ms left`, async () => {
      // Why this test matters: fills take 30-75 s against a 60 s wait, so
      // the tile often appears near the end of it, and a dense tile's body
      // takes seconds at low bandwidth. Cutting that body at the wait's end
      // read as a host refusal: every tile read-only for the refusal
      // memory, and the race spent an Overpass request on a tile the host
      // had just stored.
      const { source, fallback, calls } = lateFill(leftMs, [
        slowStored(PAYLOAD, { bodyMs }),
      ]);
      const result = await source.fetchTile(TILE);
      expect(result.sourceId).toBe("static:tiles.example.dev");
      expect(fallback.calls).toEqual([]);
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "GET"]);
    });
  }

  for (const [leftMs, headersMs, served] of [
    [300, 30, true],
    [100, 30, true],
    [100, 300, false],
    [40, 200, false],
  ] as const) {
    it(`${served ? "serves" : "races"} a poll whose headers take ${headersMs} ms with ${leftMs} ms left`, async () => {
      // Why this test matters: what is left of the wait still bounds the
      // wait for the answer itself, so a host that does not answer a poll
      // before the wait is spent cannot hold the tile past it.
      const { source, fallback } = lateFill(leftMs, [
        slowStored(PAYLOAD, { headersMs }),
      ]);
      const result = await source.fetchTile(TILE);
      expect(result.sourceId).toBe(
        served ? "static:tiles.example.dev" : "overpass:test",
      );
      expect(fallback.calls).toHaveLength(served ? 0 : 1);
    });
  }

  for (const [bodyMs, served] of [
    [40, true],
    [400, false],
  ] as const) {
    it(`keeps the per-request limit on a body read after the fill wait (${bodyMs} ms body, 150 ms limit)`, async () => {
      // Why this test matters: the body is free of the wait, not of every
      // bound; a body that stalls past requestTimeoutMs still goes to the
      // race.
      const { source, fallback } = lateFill(
        100,
        [slowStored(PAYLOAD, { bodyMs })],
        150,
      );
      const result = await source.fetchTile(TILE);
      expect(result.sourceId).toBe(
        served ? "static:tiles.example.dev" : "overpass:test",
      );
      expect(fallback.calls).toHaveLength(served ? 0 : 1);
    });
  }

  // How far the second sleep overshoots, against the 1 000 ms it leaves:
  // 999 leaves 1 ms, 1 000 nothing, more a negative remainder.
  for (const [overshootMs, polled] of [
    [998, true],
    [999, true],
    [1_000, false],
    [1_001, false],
    [6_000, false],
  ] as const) {
    it(`a sleep overshooting by ${overshootMs} ms ${polled ? "still polls" : "polls no more and races"}`, async () => {
      // Why this test matters: a sleep can overshoot (a throttled tab). A
      // poll with no wait left is pointless, and a negative remainder must
      // never reach a timer API: AbortSignal.timeout throws on one.
      const timer = vi.spyOn(globalThis, "setTimeout");
      try {
        const { source, fallback, calls } = setup(
          {
            [`GET ${TILE_URL}`]: [
              new Response("nf", { status: 404 }),
              new Response("nf", { status: 404 }),
              new Response(PAYLOAD, { status: 200 }),
            ],
            [`POST ${FILL_URL}`]: [json(202, { status: "queued" })],
          },
          { maxWaitMs: 11_000, oversleepMs: [0, overshootMs] },
        );
        const result = await source.fetchTile(TILE);
        expect(result.sourceId).toBe(
          polled ? "static:tiles.example.dev" : "overpass:test",
        );
        expect(fallback.calls).toHaveLength(polled ? 0 : 1);
        expect(calls.map((c) => c.method)).toEqual(
          polled ? ["GET", "POST", "GET", "GET"] : ["GET", "POST", "GET"],
        );
        // The header timers of the fill ask and the first poll, and of the
        // second poll only when it was made: none ever gets 0 or less.
        const delays = timer.mock.calls.map((call) => call[1]);
        expect(delays).toEqual(
          polled ? [11_000, 6_000, 1_000 - overshootMs] : [11_000, 6_000],
        );
      } finally {
        timer.mockRestore();
      }
    });
  }

  // The first, bad read of a poll with 1 000 ms left uses `readMs` of it on
  // the clock; the re-read past the browser cache answers after `headersMs`
  // real ms. Served only when the re-read fits in what is left.
  // When the re-read cannot finish its headers in time (or no time is
  // left for it), the first read's bad copy decides: the tile is raced and
  // reported with its ETag, and the host is not counted as refusing.
  for (const [readMs, headersMs, reread, served] of [
    [500, 20, true, true],
    [800, 20, true, true],
    [900, 300, true, false],
    [800, 400, true, false],
    [1_000, 0, false, false],
    [1_100, 0, false, false],
  ] as const) {
    it(`bounds a poll's re-read by what is left after a ${readMs} ms bad read (re-read headers ${headersMs} ms)`, async () => {
      // Why this test matters: the re-read past the browser cache is a
      // second request inside the same poll. Bounded by the poll's starting
      // remainder it could overrun the wait by up to a whole request.
      const partial = JSON.stringify({
        ...JSON.parse(PAYLOAD),
        remark: "runtime error: Query timed out",
      });
      const clock = { advance: (_ms: number): void => undefined };
      const warn = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      try {
        const other = latLngToCell(47.0468, 8.3745, 7);
        const otherUrl = `${BASE}/osm/v${OVERPASS_SCHEMA_VERSION}/${other}.json.gz`;
        const otherFill = `${BASE}/fill/v${OVERPASS_SCHEMA_VERSION}/${other}`;
        const reportUrl = `${REPORT_URL}?etag=${encodeURIComponent('"first"')}`;
        const ctx = lateFill(
          1_000,
          [
            () => {
              clock.advance(readMs);
              return Promise.resolve(
                new Response(partial, {
                  status: 200,
                  headers: { etag: '"first"' },
                }),
              );
            },
            slowStored(PAYLOAD, { headersMs }),
          ],
          undefined,
          {
            [`POST ${reportUrl}`]: [json(202, { status: "checking" })],
            [`GET ${otherUrl}`]: [
              new Response("nf", { status: 404 }),
              new Response(PAYLOAD, { status: 200 }),
            ],
            [`POST ${otherFill}`]: [json(200, { status: "present" })],
          },
        );
        clock.advance = ctx.advance;
        const result = await ctx.source.fetchTile(TILE);
        expect(result.sourceId).toBe(
          served ? "static:tiles.example.dev" : "overpass:test",
        );
        expect(ctx.calls.filter((c) => c.cache === "no-cache")).toHaveLength(
          reread ? 1 : 0,
        );
        expect(
          ctx.calls.filter((c) => c.url === reportUrl).map((c) => c.method),
        ).toEqual(served ? [] : ["POST"]);
        // No refusal remembered: the next missing tile is still filled.
        const next = await ctx.source.fetchTile(other);
        expect(next.sourceId).toBe("static:tiles.example.dev");
        expect(ctx.calls.some((c) => c.url === otherFill)).toBe(true);
      } finally {
        warn.mockRestore();
      }
    });
  }

  it("a caller abort during the re-read of a bad tile stays an abort: no report, no race, no refusal", async () => {
    // Why this test matters: a re-read that fails leaves the first, bad
    // copy to decide, which reports the tile and races it. A caller who
    // gave up must get the abort instead, with nothing sent on its behalf.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { source, fallback, calls } = setup({
        [`GET ${TILE_URL}`]: [
          new Response(partial, { status: 200, headers: { etag: '"first"' } }),
          (init) =>
            new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              signal?.addEventListener("abort", () => {
                reject(signal.reason as Error);
              });
              queueMicrotask(() => {
                controller.abort();
              });
            }),
        ],
      });
      const outcome = source.fetchTile(TILE, { signal: controller.signal });
      await expect(outcome).rejects.toMatchObject({ name: "AbortError" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls.map((c) => `${c.method} ${c.cache ?? ""}`)).toEqual([
        "GET ",
        "GET no-cache",
      ]);
      expect(fallback.calls).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("a re-read the fill wait had no time for leaves the allowance for the next read of the tile", async () => {
    // Why this test matters: the re-read past the browser cache is allowed
    // once per tile per session. When no request went out (no wait left),
    // nothing was learnt about the host's copy, so a later read of the same
    // tile must still be able to look past the cache and find a good one.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const bad = (): Response =>
      new Response(partial, { status: 200, headers: { etag: '"first"' } });
    const reportUrl = `${REPORT_URL}?etag=${encodeURIComponent('"first"')}`;
    const clock = { advance: (_ms: number): void => undefined };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const ctx = lateFill(
        1_000,
        [
          () => {
            clock.advance(1_000);
            return Promise.resolve(bad());
          },
          bad(),
          new Response(PAYLOAD, { status: 200, headers: { etag: '"new"' } }),
        ],
        undefined,
        { [`POST ${reportUrl}`]: [json(202, { status: "checking" })] },
      );
      clock.advance = ctx.advance;
      const first = await ctx.source.fetchTile(TILE);
      expect(first.sourceId).toBe("overpass:test");
      expect(ctx.calls.filter((c) => c.cache === "no-cache")).toHaveLength(0);
      const second = await ctx.source.fetchTile(TILE);
      expect(second.sourceId).toBe("static:tiles.example.dev");
      expect(ctx.calls.filter((c) => c.cache === "no-cache")).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("a caller abort before the re-read went out leaves the allowance too", async () => {
    // Why this test matters: an abort says nothing about the host's copy
    // either; the next read of the tile may still look past the cache.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const bad = (): Response =>
      new Response(partial, { status: 200, headers: { etag: '"first"' } });
    const controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { source, calls } = setup({
        [`GET ${TILE_URL}`]: [
          bad(),
          (init) => {
            controller.abort();
            return Promise.reject(init?.signal?.reason as Error);
          },
          bad(),
          new Response(PAYLOAD, { status: 200, headers: { etag: '"new"' } }),
        ],
      });
      await expect(
        source.fetchTile(TILE, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: "AbortError" });
      const next = await source.fetchTile(TILE);
      expect(next.sourceId).toBe("static:tiles.example.dev");
      expect(calls.map((c) => c.cache ?? "")).toEqual([
        "",
        "no-cache",
        "",
        "no-cache",
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a bad tile once per tile per session, and never for a speculative read", async () => {
    // Why this test matters: a tile that stays bad is read again on every
    // visit; a warning per read would flood the console, and a ring warm
    // nobody looks at should not speak at all.
    const partial = JSON.stringify({
      ...JSON.parse(PAYLOAD),
      remark: "runtime error: Query timed out",
    });
    const stored = (): Response => new Response(partial, { status: 200 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { source, fallback } = setup({
        [`GET ${TILE_URL}`]: Array.from({ length: 5 }, stored),
      });
      await source.fetchTile(TILE, { speculative: true });
      await source.fetchTile(TILE, { speculative: true });
      expect(warn).not.toHaveBeenCalled();
      await source.fetchTile(TILE);
      await source.fetchTile(TILE);
      expect(fallback.calls).toHaveLength(4);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("asks for no fill once the wait is spent before the ask", async () => {
    // Why this test matters: a fill request with no time left would be
    // cut at once; the tile goes to the race without it.
    const { source, fallback, calls } = setup(
      { [`GET ${TILE_URL}`]: [new Response("nf", { status: 404 })] },
      { maxWaitMs: 0 },
    );
    await source.fetchTile(TILE);
    expect(fallback.calls).toHaveLength(1);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
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
