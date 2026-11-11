import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { handleRequest, isAllowedFillOrigin, type RouteDeps } from "./routes";
import { tileObjectKey } from "./tile-cell";
import {
  listPending,
  markPending,
  PENDING_STALE_MS,
  recordFailure,
  writeDaily,
} from "./fill-state";
import type { ResponseCache } from "./bindings";
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
  return new Request(`${BASE}/fill/v3/${cell}`, {
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
    expect(response.body).toBeNull();
  });

  it("serves the manifest read from the stored tiles, open to everyone", async () => {
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const response = await handleRequest(get("/osm/v3/manifest.tsv"), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await response.text()).toContain(
      `${CELL}\t2026-11-11T09:00:00Z\t7\n`,
    );
  });

  it("answers repeated manifest requests from the edge cache, listing R2 once", async () => {
    // A listing costs one R2 operation per thousand tiles and the route is
    // open to anyone, so its cost must not scale with the request rate.
    const { bucket, deps } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const cached = new Map<string, Response>();
    const cache: ResponseCache = {
      match: (request) => Promise.resolve(cached.get(request.url)?.clone()),
      put: (request, response) => {
        cached.set(request.url, response);
        return Promise.resolve();
      },
    };
    const withCache = { ...deps, cache };
    const first = await handleRequest(get("/osm/v3/manifest.tsv"), withCache);
    const second = await handleRequest(get("/osm/v3/manifest.tsv"), withCache);
    expect(await second.text()).toBe(await first.text());
    expect(bucket.listCalls).toHaveLength(1);
  });

  it("says what the service is and names the licence at the root", async () => {
    const { deps } = setup();
    const response = await handleRequest(get("/"), deps);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("OpenStreetMap contributors");
    expect(text).toContain("ODbL");
    expect(text).toContain("/osm/v3/manifest.tsv");
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
