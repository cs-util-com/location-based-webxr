import { afterEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import {
  handleRequest,
  isAllowedFillOrigin,
  rateLimitKey,
  type RouteDeps,
} from "./routes";
import {
  TILE_SCHEMA_VERSION as OVERPASS_SCHEMA_VERSION,
  tileObjectKey,
} from "./tile-cell";
import {
  listPending,
  listVerifying,
  markPending,
  markVerifying,
  PENDING_STALE_MS,
  recordFailure,
  writeDaily,
  writeLastReplace,
  writeVerified,
} from "./fill-state";
import { FakeBucket, FakeLimiter, FakeQueue } from "./testing/fake-bindings";
import { fillTile } from "./fill-tile";
import { verifyTile } from "./verify-tile";

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

function post(
  cell: string,
  origin: string | null = PROD,
  ip = "203.0.113.7",
): Request {
  return new Request(`${BASE}/fill/v${OVERPASS_SCHEMA_VERSION}/${cell}`, {
    method: "POST",
    headers: {
      ...(origin === null ? {} : { Origin: origin }),
      "CF-Connecting-IP": ip,
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
      replaceRequests: 0,
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
      replaceRequests: 0,
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

describe("rateLimitKey", () => {
  // Why these tests matter: one IPv6 host holds a whole /64 (2^64
  // addresses), so a limit keyed on the full address is no limit at all
  // for it. IPv4 stays per address, and an IPv4 client seen through a
  // v4-mapped IPv6 address must share its IPv4 budget.
  it("keys IPv4 on the address", () => {
    expect(rateLimitKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("keys IPv6 on its /64, whatever the spelling", () => {
    for (const ip of [
      "2001:db8:1:2:3:4:5:6",
      "2001:db8:1:2::ffff",
      "2001:DB8:0001:0002:aaaa::1",
      "2001:db8:1:2::",
      "2001:db8:1:2::1%eth0",
    ]) {
      expect(rateLimitKey(ip), ip).toBe("2001:db8:1:2::/64");
    }
    expect(rateLimitKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitKey("::1")).toBe("0:0:0:0::/64");
  });

  it("keys a v4-mapped IPv6 address on its IPv4 address", () => {
    expect(rateLimitKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitKey("::FFFF:cb00:7107")).toBe("203.0.113.7");
  });

  it("keeps an address it cannot read as it came (never one shared key)", () => {
    expect(rateLimitKey("1:2:3")).toBe("1:2:3");
    expect(rateLimitKey("unknown")).toBe("unknown");
  });

  it("property: two IPv6 addresses share a key exactly when their first 64 bits match", () => {
    const hextet = fc.integer({ min: 0, max: 0xffff });
    const address = fc.array(hextet, { minLength: 8, maxLength: 8 });
    const text = (h: number[]) => h.map((x) => x.toString(16)).join(":");
    const mapped = (h: number[]) =>
      h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
    fc.assert(
      fc.property(address, address, (a, b) => {
        // The v4-mapped range is keyed per IPv4 address instead.
        fc.pre(!mapped(a) && !mapped(b));
        const samePrefix = a.slice(0, 4).every((x, i) => x === b[i]);
        expect(rateLimitKey(text(a)) === rateLimitKey(text(b))).toBe(
          samePrefix,
        );
      }),
    );
  });

  it("is what the fill endpoint keys its limit on", async () => {
    const { deps, limiter } = setup();
    await handleRequest(post(CELL, PROD, "2001:db8:1:2:aa::7"), deps);
    await handleRequest(post(CELL, PROD, "::ffff:203.0.113.7"), deps);
    expect(limiter.keys).toEqual(["2001:db8:1:2::/64", "203.0.113.7"]);
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
    ip = "203.0.113.7",
  ): Request {
    const query = etag === null ? "" : `?etag=${encodeURIComponent(etag)}`;
    return new Request(`${BASE}${REPORT}${cell}${query}`, {
      method,
      headers: {
        ...(origin === null ? {} : { Origin: origin }),
        "CF-Connecting-IP": ip,
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

  it("queues a replace, not a second verify, for an object already verified good", async () => {
    // Why: the verify found the bytes good but a viewer still cannot use
    // them; another verify would say the same, so the tile is refetched
    // instead (never deleted), under the cell's bad-tile backoff.
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - 60_000);
    const response = await handleRequest(report(CELL, etag), deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "replacing" });
    expect(queue.sent).toEqual([{ cell: CELL, kind: "replace", at: NOW }]);
    expect((await listPending(bucket, NOW)).map((p) => p.cell)).toEqual([CELL]);
    expect(bucket.objects.has(KEY)).toBe(true);
  });

  it("verifies again once the good memo is older than a week", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - 7 * 86_400_000 - 1);
    await handleRequest(report(CELL, etag), deps);
    expect(queue.sent.map((m) => m.kind)).toEqual(["verify"]);
  });

  it("queues a replace for an object whose verify started and never finished", async () => {
    // Why: a verify the runtime killed (CPU) would be killed again; without
    // a refetch such a tile stays stuck however often it is reported.
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - PENDING_STALE_MS, "started");
    const response = await handleRequest(report(CELL, etag), deps);
    expect(await response.json()).toEqual({ status: "replacing" });
    expect(queue.sent.map((m) => m.kind)).toEqual(["replace"]);
  });

  it("answers checking while a started verify may still be running", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - 60_000, "started");
    const response = await handleRequest(report(CELL, etag), deps);
    expect(await response.json()).toEqual({ status: "checking" });
    expect(queue.sent).toEqual([]);
  });

  it("bounds the replace like a fill: backoff, cap, one per cell, the backlog", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - 60_000);
    // The cell already pending: no second message.
    await markPending(bucket, CELL, NOW - 1000);
    expect(
      await (await handleRequest(report(CELL, etag), deps)).json(),
    ).toEqual({ status: "replacing" });
    expect(queue.sent).toEqual([]);
    await bucket.delete(`state/pending/${CELL}`);
    // Backlog full.
    for (let i = 0; i < 4; i++) {
      await markPending(bucket, latLngToCell(40 + i, 8, 7), NOW - 1000);
    }
    const busy = await handleRequest(report(CELL, etag), deps);
    expect(busy.status).toBe(503);
    expect(await busy.json()).toMatchObject({ status: "busy" });
    for (let i = 0; i < 4; i++) {
      await bucket.delete(`state/pending/${latLngToCell(40 + i, 8, 7)}`);
    }
    // Daily upstream cap spent.
    await writeDaily(bucket, NOW, {
      upstreamRequests: 10,
      fills: 0,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 0,
      replaceRequests: 0,
    });
    const cap = await handleRequest(report(CELL, etag), deps);
    expect(cap.status).toBe(503);
    expect(await cap.json()).toEqual({ status: "cap" });
    // Bad-tile backoff of the cell.
    await recordFailure(bucket, CELL, NOW, "remark");
    const backoff = await handleRequest(report(CELL, etag), deps);
    expect(backoff.status).toBe(503);
    expect(await backoff.json()).toEqual({ status: "backoff" });
    expect(queue.sent).toEqual([]);
  });

  it("draws on one budget for all reports besides the per-IP one", async () => {
    // Why: the per-cell bounds are check-then-act, so reports from many
    // addresses at once all pass them before any marker exists; one key
    // for every report bounds what such a burst can queue.
    const { bucket, deps, queue, limiter } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    limiter.denyKeys.add("report:all");
    const response = await handleRequest(
      report(CELL, await etagOf(bucket)),
      deps,
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ status: "limited" });
    expect(limiter.keys).toEqual(["report:203.0.113.7", "report:all"]);
    expect(queue.sent).toEqual([]);
  });

  it("spends the shared report budget only on a report of the current object", async () => {
    // Why: a report naming an object that is gone costs nothing to send,
    // so it must not drain the budget the real reports share.
    const { bucket, deps, limiter } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const response = await handleRequest(report(CELL, '"another"'), deps);
    expect(await response.json()).toEqual({ status: "stale" });
    expect(limiter.keys).toEqual(["report:203.0.113.7"]);
  });

  describe("the shared report budget is spent only on a queue send", () => {
    // Why these tests matter: the `report:all` budget bounds what a burst
    // of reports can queue. A repeat that queues nothing (a verify already
    // open or running, a cell in backoff) must not drain it, or a client
    // reporting one tile again and again would lock every other viewer's
    // real report out of it.
    const IP_KEY = "report:203.0.113.7";

    async function stored() {
      const ctx = setup();
      await storeTile(ctx.bucket, "2026-11-11T09:00:00Z");
      return { ...ctx, etag: await etagOf(ctx.bucket) };
    }

    it("a queued verify takes the token, its open repeat does not", async () => {
      const { deps, limiter, queue, etag } = await stored();
      await handleRequest(report(CELL, etag), deps);
      expect(limiter.keys).toEqual([IP_KEY, "report:all"]);
      const repeat = await handleRequest(report(CELL, etag), deps);
      expect(await repeat.json()).toEqual({ status: "checking" });
      expect(limiter.keys).toEqual([IP_KEY, "report:all", IP_KEY]);
      expect(queue.sent).toHaveLength(1);
    });

    it("a repeat while a started verify may still run does not take it", async () => {
      const { bucket, deps, limiter, etag } = await stored();
      await writeVerified(bucket, CELL, etag, NOW - 60_000, "started");
      const response = await handleRequest(report(CELL, etag), deps);
      expect(await response.json()).toEqual({ status: "checking" });
      expect(limiter.keys).toEqual([IP_KEY]);
    });

    it("a replace in either backoff, or already pending, does not take it", async () => {
      for (const prepare of [
        (bucket: FakeBucket) => writeLastReplace(bucket, CELL, NOW - 3_600_000),
        (bucket: FakeBucket) =>
          recordFailure(bucket, CELL, NOW - 60_000, "timeout"),
        (bucket: FakeBucket) => markPending(bucket, CELL, NOW - 60_000),
      ]) {
        const { bucket, deps, limiter, queue, etag } = await stored();
        await writeVerified(bucket, CELL, etag, NOW - 60_000);
        await prepare(bucket);
        const response = await handleRequest(report(CELL, etag), deps);
        expect([503, 202]).toContain(response.status);
        expect(limiter.keys).toEqual([IP_KEY]);
        expect(queue.sent).toEqual([]);
      }
    });

    it("a queued replace takes the token, and a spent budget sends nothing", async () => {
      const { bucket, deps, limiter, queue, etag } = await stored();
      await writeVerified(bucket, CELL, etag, NOW - 60_000);
      limiter.denyKeys.add("report:all");
      const refused = await handleRequest(report(CELL, etag), deps);
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({ status: "limited" });
      expect(queue.sent).toEqual([]);
      expect(await listPending(bucket, NOW)).toEqual([]);
      limiter.denyKeys.clear();
      const queued = await handleRequest(report(CELL, etag), deps);
      expect(await queued.json()).toEqual({ status: "replacing" });
      expect(limiter.keys).toEqual([
        IP_KEY,
        "report:all",
        IP_KEY,
        "report:all",
      ]);
    });
  });

  it("answers backoff for a replace within 24 h of the cell's last one", async () => {
    // Why: a replace costs the operators a request and anyone can report,
    // so one cell is refetched this way at most once a day.
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - 60_000);
    await writeLastReplace(bucket, CELL, NOW - 3_600_000);
    const response = await handleRequest(report(CELL, etag), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "backoff" });
    expect(response.headers.get("retry-after")).toBe(String(23 * 3600));
    expect(queue.sent).toEqual([]);
    await writeLastReplace(bucket, CELL, NOW - 86_400_000);
    const due = await handleRequest(report(CELL, etag), deps);
    expect(await due.json()).toEqual({ status: "replacing" });
  });

  it("answers cap once the day's replace share is spent, while fills still queue", async () => {
    // Why: forged reports must not crowd out real fills; with a cap of 10
    // the replace share is 3 unless DAILY_REPLACE_CAP says otherwise.
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await writeVerified(bucket, CELL, etag, NOW - 60_000);
    await writeDaily(bucket, NOW, {
      upstreamRequests: 3,
      fills: 0,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 0,
      replaceRequests: 3,
    });
    const cap = await handleRequest(report(CELL, etag), deps);
    expect(cap.status).toBe(503);
    expect(await cap.json()).toEqual({ status: "cap" });
    expect(queue.sent).toEqual([]);
    const other = latLngToCell(47.0468, 8.3745, 7);
    expect((await handleRequest(post(other), deps)).status).toBe(202);
    const widened: RouteDeps = {
      ...deps,
      env: { ...deps.env, DAILY_REPLACE_CAP: "5" },
    };
    const replacing = await handleRequest(report(CELL, etag), widened);
    expect(await replacing.json()).toEqual({ status: "replacing" });
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
      replaceRequests: 0,
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

  it("queues one verify per object: further reports while it is open send nothing", async () => {
    // A forged Origin is free, so without this a script could push verify
    // messages faster than the serial consumer drains them, starving fills
    // and spending the Free plan's daily queue operations.
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    for (let i = 0; i < 5; i++) {
      const response = await handleRequest(report(CELL, etag), deps);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ status: "checking" });
    }
    expect(queue.sent).toHaveLength(1);
    expect((await listVerifying(bucket, NOW)).map((m) => m.cell)).toEqual([
      CELL,
    ]);
  });

  it("sends a verify again once the open one is older than the stale age (a lost run)", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    const etag = await etagOf(bucket);
    await markVerifying(bucket, CELL, etag, NOW - PENDING_STALE_MS);
    expect((await handleRequest(report(CELL, etag), deps)).status).toBe(202);
    expect(queue.sent).toHaveLength(1);
  });

  it("answers 503 busy while the open verifies reach the bound, enqueuing nothing", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    for (let i = 0; i < 8; i++) {
      await markVerifying(
        bucket,
        latLngToCell(40 + i, 8, 7),
        '"other"',
        NOW - i * 1000,
      );
    }
    const response = await handleRequest(
      report(CELL, await etagOf(bucket)),
      deps,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "busy" });
    expect(response.headers.get("retry-after")).toBe("60");
    expect(queue.sent).toEqual([]);
  });

  it("removes its marker again when the queue refuses the message", async () => {
    const { bucket, deps, queue } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    queue.failWith = new Error("queue down");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await handleRequest(report(CELL, await etagOf(bucket)), deps);
    log.mockRestore();
    expect(await listVerifying(bucket, NOW)).toEqual([]);
  });

  it("keys the per-IP limit of a report from IPv6 on the /64", async () => {
    const { bucket, deps, limiter } = setup();
    await storeTile(bucket, "2026-11-11T09:00:00Z");
    await handleRequest(
      report(CELL, await etagOf(bucket), PROD, "POST", "2001:db8:1:2:aa::7"),
      deps,
    );
    expect(limiter.keys).toEqual(["report:2001:db8:1:2::/64", "report:all"]);
  });

  it("property: no sequence of reports, verifies and refetches removes a good stored tile", async () => {
    // Why: the report endpoint alone never deletes; what could delete is the
    // verify it queues, and the refetch a report of a tile judged good
    // queues. So the queued messages are run here too, by the real consumer
    // steps, over days (memos expire, backoffs pass), against a real gzip
    // answer: a good tile, or its refetched successor, must always remain.
    const answer = (i: number): string =>
      `{
  "version": 0.6,
  "osm3s": {
    "timestamp_osm_base": "2026-11-11T09:00:00Z"
  },
  "elements": [
{"type":"node","id":${String(i)},"lat":1,"lon":2}

  ]
}
`;
    async function gzipText(text: string): Promise<Uint8Array> {
      const stream = new Blob([text])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const step = fc.record({
      etag: fc.oneof(
        fc.constant("current"),
        fc.constant("weak"),
        fc.string({ maxLength: 12 }),
      ),
      advanceMs: fc.integer({ min: 0, max: 8 * 86_400_000 }),
      upstreamUp: fc.boolean(),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(step, { maxLength: 10 }), async (steps) => {
        const bucket = new FakeBucket();
        const queue = new FakeQueue();
        let clock = NOW;
        const routeDeps: RouteDeps = {
          env: { TILES: bucket, FILL_QUEUE: queue, DAILY_UPSTREAM_CAP: "10" },
          now: () => clock,
        };
        await bucket.put(KEY, await gzipText(answer(0)), {
          httpMetadata: { contentEncoding: "gzip" },
          customMetadata: {
            osmBase: "2026-11-11T09:00:00Z",
            storedAs: "upstream-gzip",
          },
        });
        let refills = 0;
        for (const s of steps) {
          clock += s.advanceMs;
          const current = (await bucket.head(KEY))!.httpEtag;
          const named =
            s.etag === "current"
              ? current
              : s.etag === "weak"
                ? `W/${current}`
                : s.etag;
          await handleRequest(report(CELL, named), routeDeps);
          for (const message of queue.sent.splice(0)) {
            if (message.kind === "verify") {
              await verifyTile(message, {
                bucket,
                now: () => clock,
                dailyVerifyCap: 50,
              });
            } else {
              await fillTile(message, {
                bucket,
                now: () => clock,
                userAgent: "test",
                endpoints: ["https://overpass.example/api/interpreter"],
                dailyUpstreamCap: 10,
                fetchImpl: () =>
                  Promise.resolve(
                    s.upstreamUp
                      ? new Response(answer(++refills))
                      : new Response("busy", { status: 504 }),
                  ),
              });
            }
          }
          expect(bucket.objects.has(KEY)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });
});
