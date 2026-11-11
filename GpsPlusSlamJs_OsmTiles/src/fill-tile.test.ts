import { describe, expect, it } from "vitest";
import { latLngToCell } from "h3-js";
import {
  buildTileQuery,
  cellToBoundingBox,
  OVERPASS_SELECT_KEYS,
} from "gps-plus-slam-osm/source";
import { fillTile, type FillDeps } from "./fill-tile";
import { tileObjectKey } from "./tile-cell";
import { readDaily, readFailure } from "./fill-state";
import { FakeBucket } from "./testing/fake-bindings";

// Why these tests matter: the consumer is the only code that writes tiles
// every client is then served. Each test pins one rule whose failure would
// either store a bad tile for everyone (a remark, a cut body, an older tile
// over a newer one), send the operators more than one request per tile, or
// let one failing tile or one busy day spend the whole Overpass budget.

const CELL = latLngToCell(50.9384, 6.9598, 7);
const KEY = tileObjectKey(CELL);
const NOW = Date.parse("2026-11-11T10:00:00Z");

function overpassBody(osmBase: string, extra = ""): string {
  return `{\n  "version": 0.6,\n  "osm3s": {\n    "timestamp_osm_base": "${osmBase}"\n  },\n  "elements": [\n{"type":"node","id":1,"lat":1,"lon":2}\n\n  ]${extra}\n}\n`;
}

const REMARK = ',\n  "remark": "runtime error: Query timed out"';

interface Call {
  readonly url: string;
  readonly body: string;
  readonly userAgent: string | null;
}

function deps(
  bucket: FakeBucket,
  answers: (url: string, index: number) => Response,
  overrides: Partial<FillDeps> = {},
): { deps: FillDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      bucket,
      now: () => NOW,
      userAgent: "test-agent/1",
      dailyUpstreamCap: 100,
      endpoints: [
        "https://lz4.overpass-api.de/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        "https://z.overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://overpass-api.de/api/interpreter",
      ],
      fetchImpl: (input, init) => {
        const url = String(input);
        calls.push({
          url,
          body: String(init?.body),
          userAgent: new Headers(init?.headers).get("user-agent"),
        });
        return Promise.resolve(answers(url, calls.length - 1));
      },
      ...overrides,
    },
  };
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

const fill = { cell: CELL, kind: "fill", at: NOW } as const;
const refresh = { cell: CELL, kind: "refresh", at: NOW } as const;

describe("fillTile", () => {
  it("fetches the client's exact query once, stores it gzip with its metadata, and lists it in the manifest", async () => {
    const bucket = new FakeBucket();
    const raw = overpassBody("2026-11-11T09:00:00Z");
    const { deps: d, calls } = deps(bucket, () => new Response(raw));
    const outcome = await fillTile(fill, d);

    expect(outcome.outcome).toBe("filled");
    expect(calls).toHaveLength(1);
    const query = buildTileQuery(
      cellToBoundingBox(CELL),
      180,
      OVERPASS_SELECT_KEYS,
    );
    expect(new URLSearchParams(calls[0]!.body).get("data")).toBe(query);
    expect(calls[0]!.userAgent).toBe("test-agent/1");

    const stored = bucket.objects.get(KEY)!;
    expect(await gunzip(stored.bytes)).toBe(raw);
    expect(stored.options.httpMetadata?.contentEncoding).toBe("gzip");
    expect(stored.options.httpMetadata?.contentType).toBe("application/json");
    expect(stored.options.customMetadata).toMatchObject({
      osmBase: "2026-11-11T09:00:00Z",
      filledAt: new Date(NOW).toISOString(),
      endpoint: "lz4.overpass-api.de",
      rawBytes: String(raw.length),
    });
    expect(bucket.textOf("osm/v3/manifest.tsv")).toContain(
      `${CELL}\t2026-11-11T09:00:00Z\t`,
    );
    const daily = await readDaily(bucket, NOW);
    expect(daily).toMatchObject({ upstreamRequests: 1, fills: 1 });
  });

  it("is a no-op for a tile already present (duplicate messages cost no request)", async () => {
    const bucket = new FakeBucket();
    await bucket.put(KEY, "x", {
      customMetadata: { osmBase: "2026-11-01T00:00:00Z" },
    });
    const { deps: d, calls } = deps(bucket, () => new Response("never"));
    expect((await fillTile(fill, d)).outcome).toBe("present");
    expect(calls).toHaveLength(0);
  });

  it("does not store a 200 with a remark, tries the next operator, and stores that one's complete answer", async () => {
    const bucket = new FakeBucket();
    const good = overpassBody("2026-11-11T09:00:00Z");
    const { deps: d, calls } = deps(bucket, (_url, i) =>
      i === 0
        ? new Response(overpassBody("2026-11-11T09:00:00Z", REMARK))
        : new Response(good),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.outcome).toBe("filled");
    expect(outcome.attempts.map((a) => a.result)).toEqual(["remark", "ok"]);
    expect(calls[1]!.url).toContain("maps.mail.ru");
  });

  it("after a 429 skips the other entries of the same operator", async () => {
    const bucket = new FakeBucket();
    const { deps: d, calls } = deps(bucket, (url) =>
      url.includes("overpass-api.de")
        ? new Response("busy", { status: 429 })
        : new Response("gateway", { status: 504 }),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.outcome).toBe("failed");
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual([
      "lz4.overpass-api.de",
      "maps.mail.ru",
      "overpass.private.coffee",
    ]);
  });

  it("records a failure with backoff, and a tile in backoff costs no request", async () => {
    const bucket = new FakeBucket();
    const { deps: d } = deps(bucket, () => new Response("x", { status: 504 }));
    expect((await fillTile(fill, d)).outcome).toBe("failed");
    const record = await readFailure(bucket, CELL);
    expect(record?.count).toBe(1);
    expect(record?.retryAt).toBe(NOW + 3_600_000);

    const again = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    expect((await fillTile(fill, again.deps)).outcome).toBe("backoff");
    expect(again.calls).toHaveLength(0);
  });

  it("clears the failure record once the tile fills", async () => {
    const bucket = new FakeBucket();
    const failing = deps(bucket, () => new Response("x", { status: 504 }));
    await fillTile(fill, failing.deps);
    const later = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
      { now: () => NOW + 3_600_001 },
    );
    expect((await fillTile(fill, later.deps)).outcome).toBe("filled");
    expect(await readFailure(bucket, CELL)).toBeUndefined();
  });

  it("stops at the daily upstream cap, counting every request it sends", async () => {
    const bucket = new FakeBucket();
    const { deps: d, calls } = deps(
      bucket,
      () => new Response("x", { status: 504 }),
      { dailyUpstreamCap: 2 },
    );
    const outcome = await fillTile(fill, d);
    expect(calls).toHaveLength(2);
    expect(outcome.outcome).toBe("failed");
    expect((await readDaily(bucket, NOW)).upstreamRequests).toBe(2);

    const other = latLngToCell(47.0468, 8.3745, 7);
    const next = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
      { dailyUpstreamCap: 2 },
    );
    expect(
      (await fillTile({ cell: other, kind: "fill", at: NOW }, next.deps))
        .outcome,
    ).toBe("cap");
    expect(next.calls).toHaveLength(0);
  });

  it("refresh: keeps a young tile without asking anyone", async () => {
    const bucket = new FakeBucket();
    await bucket.put(KEY, "x", {
      customMetadata: { osmBase: "2026-11-01T00:00:00Z" },
    });
    const { deps: d, calls } = deps(bucket, () => new Response("never"));
    expect((await fillTile(refresh, d)).outcome).toBe("fresh");
    expect(calls).toHaveLength(0);
  });

  it("refresh: replaces an old tile with a newer answer", async () => {
    const bucket = new FakeBucket();
    await bucket.put(KEY, "x", {
      customMetadata: { osmBase: "2026-09-01T00:00:00Z" },
    });
    const { deps: d } = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    expect((await fillTile(refresh, d)).outcome).toBe("filled");
    expect(bucket.objects.get(KEY)!.options.customMetadata?.osmBase).toBe(
      "2026-11-11T09:00:00Z",
    );
  });

  it("never replaces a newer tile with an older answer (a lagging operator)", async () => {
    const bucket = new FakeBucket();
    await bucket.put(KEY, "kept", {
      customMetadata: { osmBase: "2026-09-01T00:00:00Z" },
    });
    const { deps: d } = deps(
      bucket,
      () => new Response(overpassBody("2026-08-01T00:00:00Z")),
    );
    expect((await fillTile(refresh, d)).outcome).toBe("kept-newer");
    expect(bucket.textOf(KEY)).toBe("kept");
  });

  it("gives up on an endpoint that does not answer within the attempt timeout", async () => {
    const bucket = new FakeBucket();
    const { deps: d } = deps(bucket, () => new Response("unused"), {
      attemptTimeoutMs: 5,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("timed out"));
          });
        }),
    });
    const outcome = await fillTile(fill, d);
    expect(outcome.outcome).toBe("failed");
    expect(outcome.attempts.length).toBeGreaterThan(0);
    expect(outcome.attempts.every((a) => a.result === "error")).toBe(true);
  });

  it("can store the bytes uncompressed when gzip is switched off", async () => {
    const bucket = new FakeBucket();
    const raw = overpassBody("2026-11-11T09:00:00Z");
    const { deps: d } = deps(bucket, () => new Response(raw), { gzip: false });
    await fillTile(fill, d);
    const stored = bucket.objects.get(KEY)!;
    expect(new TextDecoder().decode(stored.bytes)).toBe(raw);
    expect(stored.options.httpMetadata?.contentEncoding).toBeUndefined();
  });
});
