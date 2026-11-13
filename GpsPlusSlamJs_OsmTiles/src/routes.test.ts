import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { handleRequest, isAllowedFillOrigin, type RouteDeps } from "./routes";
import {
  TILE_SCHEMA_VERSION as OVERPASS_SCHEMA_VERSION,
  tileObjectKey,
} from "./tile-cell";
import {
  listPending,
  markPending,
  PENDING_STALE_MS,
  recordFailure,
  writeDaily,
  writeVerified,
} from "./fill-state";
import { FakeBucket, FakeLimiter, FakeQueue } from "./testing/fake-bindings";

// Why these tests matter: these are the Worker's whole public surface. The
// GET side must serve a stored tile to ANY origin (the files are open, CORS
// `*`), never cache a 404 (a tile filled a minute later must be visible), and
// pass the stored gzip bytes through untouched. The POST side is the only
// door to the operators' budget: a hotlink origin check, cell validation, a
// per-IP limit, the failure backoff and the daily cap must each answer at
// once without enqueuing, so the client falls back to the direct race.

const BASE = "https://osm-tiles.example.workers.dev";
const CELL = latLngToCell(50.9384, 6.9598, 7);
const KEY = tileObjectKey(CELL);
const NOW = Date.parse("2026-11-11T10:00:00Z");
const PROD = "https://gps.csutil.com";

function setup() {
  const bucket = new FakeBucket();
  const queue = new FakeQueue();
  const limiter = new FakeLimiter();
  const deps: RouteDeps = {
    env: {
      TILES: bucket,
      FILL_QUEUE: queue,
      FILL_LIMITER: limiter,
      DAILY_UPSTREAM_CAP: "10",
    },
    now: () => NOW,
  };
  return { bucket, queue, limiter, deps };
}

function get(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

function post(cell: string, origin: string | null = PROD): Request {
  return new Request(`${BASE}/fill/v${OVERPASS_SCHEMA_VERSION}/${cell}`, {
    method: "POST",
    headers: {
      ...(origin === null ? {} : { Origin: origin }),
      "CF-Connecting-IP": "203.0.113.7",
    },
  });
}

async function storeTile(bucket: FakeBucket, osmBase: string): Promise<void> {
  await bucket.put(KEY, new Uint8Array([31, 139, 8, 0, 1, 2, 3]), {
    httpMetadata: {
      contentType: "application/json",
      contentEncoding: "gzip",
      cacheControl: "public, max-age=86400",
    },
    customMetadata: { osmBase, filledAt: "2026-11-11T09:30:00.000Z" },
  });
}

describe("GET a tile", () => {
  it("serves the stored gzip bytes untouched, open to every origin, cacheable for a day", async () => {
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const response = await handleRequest(get(`/${KEY}`), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("x-osm-base")).toBe("2026-11-11T09:00:00Z");
    expect(response.headers.get("access-control-expose-headers")).toContain(
      "X-Osm-Base",
    );
    // The fill time is not sent: it is a second date per place, and no
    // client needs it (the data's own age is X-Osm-Base and the body).
    // Last-Modified is R2's upload time, i.e. the fill time to the second.
    expect(response.headers.get("x-filled-at")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).not.toMatch(
      /last-modified/i,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([31, 139, 8, 0, 1, 2, 3]),
    );
  });

  it("reads R2 on every request: no edge cache in front of it", async () => {
    // Measured on the deployed Worker: the Cache API kept the stored gzip as
    // if it were plain content and gzipped it again on every hit, so a client
    // decoding once received gzip instead of JSON. The route therefore never
    // touches `caches.default`; browsers still cache by Cache-Control.
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    let reads = 0;
    const read = bucket.get.bind(bucket);
    bucket.get = (key) => {
      reads++;
      return read(key);
    };
    await handleRequest(get(`/${KEY}`), deps);
    const again = await handleRequest(get(`/${KEY}`), deps);
    expect(again.status).toBe(200);
    expect(reads).toBe(2);
  });

  it("hands the runtime the stored gzip with encodeBody manual (no second compression)", async () => {
    // Node's Response ignores `encodeBody`, so the bytes test above passes
    // with or without it; on workerd its absence gzips the stored gzip again
    // under the same header and a browser decoding once gets binary, not
    // JSON. So the init the route builds is checked directly.
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const inits: (ResponseInit | undefined)[] = [];
    const Real = Response;
    vi.stubGlobal(
      "Response",
      class extends Real {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
          super(body, init);
          inits.push(init);
        }
      },
    );
    await handleRequest(get(`/${KEY}`), deps);
    vi.unstubAllGlobals();
    expect(inits).toHaveLength(1);
    expect((inits[0] as { encodeBody?: string }).encodeBody).toBe("manual");
  });

  it("answers a missing tile 404 that nobody may cache", async () => {
    const { deps } = setup();
    const response = await handleRequest(get(`/${KEY}`), deps);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers an invalid cell 404 without touching the store", async () => {
    const { deps, bucket } = setup();
    bucket.get = () => {
      throw new Error("must not read");
    };
    const response = await handleRequest(get("/osm/v3/zz.json.gz"), deps);
    expect(response.status).toBe(404);
  });

  it("answers HEAD with the headers and no body", async () => {
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const response = await handleRequest(
      get(`/${KEY}`, { method: "HEAD" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-osm-base")).toBe("2026-11-11T09:00:00Z");
    expect(response.headers.get("last-modified")).toBeNull();
    expect(response.body).toBeNull();
  });

  it("carries the ODbL notice on every stored tile, GET and HEAD", async () => {
    // With no list of stored tiles, the licence travels with each file.
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    for (const method of ["GET", "HEAD"]) {
      const response = await handleRequest(get(`/${KEY}`, { method }), deps);
      expect(response.headers.get("link")).toBe(
        '<https://www.openstreetmap.org/copyright>; rel="license"',
      );
      expect(response.headers.get("x-data-license")).toBe(
        "ODbL-1.0; (c) OpenStreetMap contributors",
      );
      expect(response.headers.get("access-control-expose-headers")).toContain(
        "X-Data-License",
      );
    }
  });

  it("publishes no list of stored tiles: the old manifest path is a plain 404", async () => {
    // Privacy: a fill follows a viewer's GPS, so a stored cell can be the
    // area around someone's home. A list with dates would show every such
    // place in one request; without it, finding one takes a probe per cell.
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    for (const method of ["GET", "HEAD"]) {
      const response = await handleRequest(
        get("/osm/v3/manifest.tsv", { method }),
        deps,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(bucket.listCalls).toEqual([]);
  });

  it("says what the service is and names the licence at the root", async () => {
    const { deps } = setup();
    const response = await handleRequest(get("/"), deps);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("OpenStreetMap contributors");
    expect(text).toContain("ODbL");
    expect(text).not.toContain("manifest");
    // The paths it names follow the query schema, like the routes do.
    expect(text).toContain(`/osm/v${OVERPASS_SCHEMA_VERSION}/<cell>.json.gz`);
    expect(text).toContain(`/fill/v${OVERPASS_SCHEMA_VERSION}/<cell>`);
  });

  it("answers the fill path of another schema version 404, never a fill", async () => {
    // The fill path is derived from the query schema, as the tile path is: a
    // client of another schema must not fill tiles under this one's key.
    const { deps, queue } = setup();
    const other = OVERPASS_SCHEMA_VERSION + 1;
    const response = await handleRequest(
      new Request(`${BASE}/fill/v${other}/${CELL}`, {
        method: "POST",
        headers: { Origin: PROD },
      }),
      deps,
    );
    expect(response.status).toBe(404);
    expect(queue.sent).toEqual([]);
  });
});

describe("POST /fill", () => {
  it("enqueues a missing tile and answers 202 with Retry-After, CORS for the caller's origin", async () => {
    const { deps, queue, limiter } = setup();
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(202);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("access-control-allow-origin")).toBe(PROD);
    expect(response.headers.get("vary")).toContain("Origin");
    expect(queue.sent).toEqual([{ cell: CELL, kind: "fill", at: NOW }]);
    expect(limiter.keys).toEqual(["203.0.113.7"]);
  });

  it("answers 200 with the file's URL when the tile is already there", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "present",
      url: `${BASE}/${KEY}`,
    });
    expect(queue.sent).toEqual([]);
  });

  it("queues a refresh for a tile older than 30 days and still answers with its URL", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-09-01T00:00:00Z");
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "refreshing" });
    expect(queue.sent).toEqual([{ cell: CELL, kind: "refresh", at: NOW }]);
  });

  it("refuses a request without an allowed origin (the hotlink guard), enqueuing nothing", async () => {
    const { deps, queue } = setup();
    for (const origin of [null, "https://evil.example", "null"]) {
      const response = await handleRequest(post(CELL, origin), deps);
      expect(response.status, String(origin)).toBe(403);
    }
    expect(queue.sent).toEqual([]);
  });

  it("accepts the production site, any branch preview and localhost", async () => {
    for (const origin of [
      PROD,
      "https://r1188-gps-plus-slam.csutil.workers.dev",
      "http://localhost:5173",
      "http://127.0.0.1:4173",
    ]) {
      const { deps } = setup();
      const response = await handleRequest(post(CELL, origin), deps);
      expect(response.status, origin).toBe(202);
    }
  });

  it("refuses an invalid cell 400 before anything else", async () => {
    const { deps, queue, limiter } = setup();
    const response = await handleRequest(post("8a1fa199954ffff"), deps);
    expect(response.status).toBe(400);
    expect(queue.sent).toEqual([]);
    expect(limiter.keys).toEqual([]);
  });

  it("answers 429 at once when the per-IP limit says no", async () => {
    const { deps, queue, limiter } = setup();
    limiter.allow = false;
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(queue.sent).toEqual([]);
  });

  it("answers 503 at once while the tile is in failure backoff", async () => {
    const { bucket, deps, queue } = setup();
    await recordFailure(bucket, CELL, NOW, "remark");
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(queue.sent).toEqual([]);
  });

  it("answers 503 at once when today's upstream cap is spent, until the UTC day ends", async () => {
    const { bucket, deps, queue } = setup();
    await writeDaily(bucket, NOW, {
      upstreamRequests: 10,
      fills: 3,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 0,
    });
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe(String(14 * 3600));
    expect(queue.sent).toEqual([]);
  });

  it("leaves a pending marker for the queued cell, and says how many fills are ahead", async () => {
    const { bucket, deps } = setup();
    const other = latLngToCell(47.0468, 8.3745, 7);
    await markPending(bucket, other, NOW - 10_000, true);
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "queued", ahead: 1 });
    expect((await listPending(bucket, NOW)).map((p) => p.cell)).toContain(CELL);
  });

  it("does not queue a cell twice: a second POST while it waits is told it is queued", async () => {
    const { deps, queue } = setup();
    await handleRequest(post(CELL), deps);
    const again = await handleRequest(post(CELL), deps);
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ status: "queued", ahead: 0 });
    expect(queue.sent).toHaveLength(1);
  });

  it("answers 503 busy at once when the backlog is full, enqueuing nothing", async () => {
    // A viewer must never wait behind a long line of other fills: refused at
    // once, the client goes to its own race.
    const { bucket, deps, queue } = setup();
    for (const [i, lat] of [47.0, 48.0, 49.0, 52.0].entries()) {
      await markPending(bucket, latLngToCell(lat, 8, 7), NOW - i * 1000);
    }
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "busy", ahead: 4 });
    expect(response.headers.get("access-control-allow-origin")).toBe(PROD);
    expect(queue.sent).toEqual([]);
  });

  it("does not count a marker older than the stale age as backlog (a killed fill's leftover)", async () => {
    const { bucket, deps, queue } = setup();
    for (const lat of [47.0, 48.0, 49.0, 52.0]) {
      await markPending(
        bucket,
        latLngToCell(lat, 8, 7),
        NOW - PENDING_STALE_MS,
      );
    }
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(202);
    expect(queue.sent).toHaveLength(1);
  });

  it("reads MAX_PENDING_FILLS from the environment", async () => {
    const { bucket, deps } = setup();
    await markPending(bucket, latLngToCell(47, 8, 7), NOW);
    const strict = { ...deps, env: { ...deps.env, MAX_PENDING_FILLS: "1" } };
    expect((await handleRequest(post(CELL), strict)).status).toBe(503);
  });

  it("answers 503 with CORS when the queue refuses the message, and leaves no marker", async () => {
    const { bucket, deps, queue } = setup();
    queue.failWith = new Error("queue unavailable");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await handleRequest(post(CELL), deps);
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(PROD);
    expect(await response.json()).toMatchObject({ status: "unavailable" });
    expect(await listPending(bucket, NOW)).toEqual([]);
  });

  it("queues no refresh for an old tile in failure backoff, and still answers present", async () => {
    // A refresh is an upstream request like a fill; a cell whose last
    // attempt failed (or was killed) waits out its backoff either way.
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-09-01T00:00:00Z");
    await recordFailure(bucket, CELL, NOW - 60_000, "status");
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "present" });
    expect(queue.sent).toEqual([]);
  });

  it("queues no refresh for an old tile once today's upstream cap is spent", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-09-01T00:00:00Z");
    await writeDaily(bucket, NOW, {
      upstreamRequests: 10,
      fills: 3,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 0,
    });
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "present" });
    expect(queue.sent).toEqual([]);
  });

  it("queues one refresh per old tile, however many viewers ask", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-09-01T00:00:00Z");
    await handleRequest(post(CELL), deps);
    const again = await handleRequest(post(CELL), deps);
    expect(await again.json()).toMatchObject({ status: "refreshing" });
    expect(queue.sent).toHaveLength(1);
  });

  it("answers 503 backoff for a cell whose fill was killed, even with its marker left behind", async () => {
    // The consumer writes the failure record before its first attempt and
    // marks itself running. A kill leaves both; the record must win, so a
    // viewer is refused at once instead of waiting a minute for nothing.
    const { bucket, deps, queue } = setup();
    await markPending(bucket, CELL, NOW - 30_000, true);
    await recordFailure(bucket, CELL, NOW - 30_000, "unfinished");
    const response = await handleRequest(post(CELL), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "backoff" });
    expect(queue.sent).toEqual([]);
  });

  it("answers the CORS preflight for an allowed origin only", async () => {
    const { deps } = setup();
    const ok = await handleRequest(
      new Request(`${BASE}/fill/v3/${CELL}`, {
        method: "OPTIONS",
        headers: { Origin: PROD },
      }),
      deps,
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");
    const refused = await handleRequest(
      new Request(`${BASE}/fill/v3/${CELL}`, {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      deps,
    );
    expect(refused.status).toBe(403);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("everything else", () => {
  it("answers 404 for unknown paths and 405 for other methods on a tile", async () => {
    const { deps } = setup();
    expect((await handleRequest(get("/api/anything"), deps)).status).toBe(404);
    expect(
      (await handleRequest(get(`/${KEY}`, { method: "PUT" }), deps)).status,
    ).toBe(405);
  });
});

describe("isAllowedFillOrigin", () => {
  it("property: an origin is allowed only in one of the three listed shapes", () => {
    fc.assert(
      fc.property(fc.webUrl(), fc.string(), (url, junk) => {
        for (const origin of [new URL(url).origin, junk]) {
          if (isAllowedFillOrigin(origin)) {
            expect(origin).toMatch(
              /^(https:\/\/gps\.csutil\.com|https:\/\/[a-z0-9-]+\.csutil\.workers\.dev|http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?)$/,
            );
          }
        }
      }),
    );
  });

  it("refuses look-alike hosts", () => {
    for (const origin of [
      "https://gps.csutil.com.evil.example",
      "https://evil.example/https://gps.csutil.com",
      "https://a.b.csutil.workers.dev",
      "http://gps.csutil.com",
      "https://localhost:5173",
    ]) {
      expect(isAllowedFillOrigin(origin), origin).toBe(false);
    }
  });
});

describe("GET a tile stored uncompressed", () => {
  // Why: an operator that answers without gzip is stored raw; the edge must
  // then compress it per client, which it does only for a response without
  // a Content-Encoding and without the manual-encoding flag.
  it("serves it with no Content-Encoding and lets the runtime encode it", async () => {
    const { bucket, deps } = setup();
    await bucket.put(KEY, '{"elements":[]}', {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { osmBase: "2026-11-11T09:00:00Z", storedAs: "raw" },
    });
    const inits: (ResponseInit | undefined)[] = [];
    const Real = Response;
    vi.stubGlobal(
      "Response",
      class extends Real {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
          super(body, init);
          inits.push(init);
        }
      },
    );
    const response = await handleRequest(get(`/${KEY}`), deps);
    vi.unstubAllGlobals();
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("x-osm-base")).toBe("2026-11-11T09:00:00Z");
    expect(await response.text()).toBe('{"elements":[]}');
    expect((inits[0] as { encodeBody?: string }).encodeBody).toBeUndefined();
  });
});

describe("POST a bad-tile report", () => {
  // Why these tests matter: a report is the only request that can lead to a
  // stored tile being deleted, and its Origin header is free for any script.
  // So it only ever queues a verify of the stored bytes (bounded per IP and
  // per day), never deletes by itself, and costs nothing for an object that
  // was already replaced or already verified good.
  const REPORT = `/report/v${OVERPASS_SCHEMA_VERSION}/`;

  function report(
    cell: string,
    etag: string | null,
    origin: string | null = PROD,
    method = "POST",
  ): Request {
    const query = etag === null ? "" : `?etag=${encodeURIComponent(etag)}`;
    return new Request(`${BASE}${REPORT}${cell}${query}`, {
      method,
      headers: {
        ...(origin === null ? {} : { Origin: origin }),
        "CF-Connecting-IP": "203.0.113.7",
      },
    });
  }

  async function etagOf(bucket: FakeBucket): Promise<string> {
    return (await bucket.head(KEY))!.httpEtag;
  }

  it("queues one verify of the reported object and deletes nothing", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    const response = await handleRequest(report(CELL, etag), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "checking" });
    expect(response.headers.get("access-control-allow-origin")).toBe(PROD);
    expect(queue.sent).toEqual([{ cell: CELL, kind: "verify", at: NOW, etag }]);
    expect(bucket.objects.has(KEY)).toBe(true);
  });

  it("matches the ETag a browser saw weakened by the edge's compression", async () => {
    // The edge compresses a raw tile per client and then sends W/"...".
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    const response = await handleRequest(report(CELL, `W/${etag}`), deps);
    expect(response.status).toBe(202);
    expect(queue.sent[0]?.etag).toBe(etag);
  });

  it("answers stale for an object already replaced, and queues nothing", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const response = await handleRequest(report(CELL, '"older"'), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "stale" });
    expect(queue.sent).toEqual([]);
  });

  it("answers missing for a cell with no tile", async () => {
    const { deps, queue } = setup();
    const response = await handleRequest(report(CELL, '"x"'), deps);
    expect(await response.json()).toEqual({ status: "missing" });
    expect(queue.sent).toEqual([]);
  });

  it("answers verified, at the cost of one read, for an object already verified good", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag);
    const response = await handleRequest(report(CELL, etag), deps);
    expect(await response.json()).toEqual({ status: "verified" });
    expect(queue.sent).toEqual([]);
  });

  it("answers cap once today's verifies are spent", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    await writeDaily(bucket, NOW, {
      upstreamRequests: 0,
      fills: 0,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 50,
    });
    const response = await handleRequest(
      report(CELL, await etagOf(bucket)),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "cap" });
    expect(queue.sent).toEqual([]);
  });

  it("applies the fill endpoint's guards: origin, cell, per-IP limit under its own key", async () => {
    const { bucket, deps, queue, limiter } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    expect(
      (await handleRequest(report(CELL, etag, "https://evil.example"), deps))
        .status,
    ).toBe(403);
    expect((await handleRequest(report(CELL, etag, null), deps)).status).toBe(
      403,
    );
    expect(
      (await handleRequest(report("871fa4ac9ffffff0", etag), deps)).status,
    ).toBe(400);
    expect((await handleRequest(report(CELL, null), deps)).status).toBe(400);
    limiter.allow = false;
    expect((await handleRequest(report(CELL, etag), deps)).status).toBe(429);
    // Reports draw on their own per-IP budget, never on the fill one.
    expect(new Set(limiter.keys)).toEqual(new Set(["report:203.0.113.7"]));
    expect(queue.sent).toEqual([]);
  });

  it("answers the preflight, refuses other methods", async () => {
    const { deps } = setup();
    const preflight = await handleRequest(
      report(CELL, '"x"', PROD, "OPTIONS"),
      deps,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    expect(
      (await handleRequest(report(CELL, '"x"', PROD, "GET"), deps)).status,
    ).toBe(405);
  });

  it("answers a queue outage 503 with CORS", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    queue.failWith = new Error("queue down");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await handleRequest(
      report(CELL, await etagOf(bucket)),
      deps,
    );
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(response.headers.get("access-control-allow-origin")).toBe(PROD);
  });

  it("property: no sequence of reports removes a stored tile", async () => {
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(fc.constant(etag), fc.string({ maxLength: 12 })), {
          maxLength: 8,
        }),
        async (etags) => {
          for (const e of etags) await handleRequest(report(CELL, e), deps);
          expect(bucket.objects.has(KEY)).toBe(true);
        },
      ),
      { numRuns: 30 },
    );
  });
});
