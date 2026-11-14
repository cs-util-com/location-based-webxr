import { describe, expect, it, vi } from "vitest";
import { latLngToCell } from "h3-js";
import {
  buildTileQuery,
  cellToBoundingBox,
  OVERPASS_SELECT_KEYS,
} from "gps-plus-slam-osm/source";
import { fillTile, type FillDeps } from "./fill-tile";
import { tileObjectKey } from "./tile-cell";
import {
  readDaily,
  readFailure,
  readVerified,
  readLastReplace,
  recordBadTile,
  writeDaily,
  writeVerified,
} from "./fill-state";
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
  readonly acceptEncoding?: string | null;
  readonly encodeResponseBody?: string | undefined;
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
          acceptEncoding: new Headers(init?.headers).get("accept-encoding"),
          encodeResponseBody: (init as { encodeResponseBody?: string })
            .encodeResponseBody,
        });
        return Promise.resolve(answers(url, calls.length - 1));
      },
      ...overrides,
    },
  };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An operator's gzip answer, as `encodeResponseBody: "manual"` delivers it. */
function gzipped(bytes: Uint8Array, encoding = "gzip"): Response {
  return new Response(bytes as BodyInit, {
    headers: { "content-encoding": encoding },
  });
}

const fill = { cell: CELL, kind: "fill", at: NOW } as const;
const refresh = { cell: CELL, kind: "refresh", at: NOW } as const;

describe("fillTile", () => {
  it("fetches the client's exact query once and stores an uncompressed answer as sent", async () => {
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
    // gzip is asked for, and the runtime must hand over the bytes as the
    // operator encoded them, so a gzip answer is stored without inflating.
    expect(calls[0]!.acceptEncoding).toBe("gzip");
    expect(calls[0]!.encodeResponseBody).toBe("manual");

    // No gzip from the operator: stored raw, so the edge compresses it per
    // client; the Worker compresses nothing (CPU).
    const stored = bucket.objects.get(KEY)!;
    expect(new TextDecoder().decode(stored.bytes)).toBe(raw);
    expect(stored.options.httpMetadata?.contentEncoding).toBeUndefined();
    expect(stored.options.httpMetadata?.contentType).toBe("application/json");
    expect(stored.options.customMetadata).toEqual({
      osmBase: "2026-11-11T09:00:00Z",
      filledAt: new Date(NOW).toISOString(),
      endpoint: "lz4.overpass-api.de",
      storedAs: "raw",
      checked: "full",
      rawBytes: String(raw.length),
    });
    // A success leaves no failure record (one is written before the attempt).
    expect(await readFailure(bucket, CELL)).toBeUndefined();
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

  it("stores an operator's gzip answer byte for byte, judged by its head", async () => {
    const bucket = new FakeBucket();
    const raw = overpassBody("2026-11-11T09:00:00Z");
    const body = await gzip(raw);
    const { deps: d } = deps(bucket, () => gzipped(body));
    const outcome = await fillTile(fill, d);
    expect(outcome).toMatchObject({
      outcome: "filled",
      osmBase: "2026-11-11T09:00:00Z",
      storedBytes: body.length,
    });
    // The decoded size is the gzip trailer's ISIZE: no inflate needed.
    expect(outcome.rawBytes).toBe(raw.length);
    const stored = bucket.objects.get(KEY)!;
    expect(stored.bytes).toEqual(body);
    expect(stored.options.httpMetadata?.contentEncoding).toBe("gzip");
    expect(stored.options.customMetadata).toEqual({
      osmBase: "2026-11-11T09:00:00Z",
      filledAt: new Date(NOW).toISOString(),
      endpoint: "lz4.overpass-api.de",
      storedAs: "upstream-gzip",
      checked: "head",
      rawBytes: String(raw.length),
    });
    expect(await readDaily(bucket, NOW)).toMatchObject({
      rawBytes: raw.length,
      storedBytes: body.length,
    });
  });

  it("reads the data timestamp from a large gzip answer's head alone", async () => {
    // A dense tile is tens of MB raw; the head is inflated only to its
    // first 2 KB, whatever the size, and the timestamp is there.
    const bucket = new FakeBucket();
    const many = Array.from(
      { length: 40_000 },
      (_, i) => `{"type":"node","id":${i},"lat":${i % 90},"lon":${i % 180}}`,
    ).join(",\n");
    const raw = overpassBody("2026-11-11T09:00:00Z").replace(
      '{"type":"node","id":1,"lat":1,"lon":2}',
      many,
    );
    const body = await gzip(raw);
    const { deps: d } = deps(bucket, () => gzipped(body));
    const outcome = await fillTile(fill, d);
    expect(outcome).toMatchObject({
      outcome: "filled",
      osmBase: "2026-11-11T09:00:00Z",
    });
  });

  it("refuses a gzip answer whose head is no Overpass JSON (a gzipped error page), and asks the next operator", async () => {
    const bucket = new FakeBucket();
    const page = await gzip("<html><body>502 Bad Gateway</body></html>");
    const good = await gzip(overpassBody("2026-11-11T09:00:00Z"));
    const { deps: d } = deps(bucket, (_url, i) =>
      gzipped(i === 0 ? page : good),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual(["not-json", "ok"]);
  });

  it("refuses a gzip answer with an invalid data timestamp", async () => {
    const bucket = new FakeBucket();
    const bad = await gzip(overpassBody("2026-13-01T00:00:00Z"));
    const { deps: d } = deps(bucket, (_url, i) =>
      i === 0
        ? gzipped(bad)
        : new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual([
      "no-timestamp",
      "ok",
    ]);
  });

  it("refuses an answer labelled gzip that is neither gzip nor JSON, and an encoding it never asked for", async () => {
    const bucket = new FakeBucket();
    const raw = new TextEncoder().encode(overpassBody("2026-11-11T09:00:00Z"));
    const junk = new TextEncoder().encode("<html>busy</html>");
    const { deps: d } = deps(bucket, (_url, i) =>
      i === 0
        ? gzipped(junk)
        : i === 1
          ? gzipped(raw, "br")
          : new Response(raw as BodyInit),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual([
      "encoding",
      "encoding",
      "ok",
    ]);
  });

  it("treats a body labelled gzip that starts with { as raw, with the full head and tail check", async () => {
    // Why: a hop that already decoded the body may keep the gzip header.
    // Such a body is plain JSON and can be checked whole, so it is judged
    // (and stored) as raw instead of being refused; a partial one is still
    // refused.
    const bucket = new FakeBucket();
    const raw = new TextEncoder().encode(overpassBody("2026-11-11T09:00:00Z"));
    const partial = new TextEncoder().encode(
      overpassBody("2026-11-11T09:00:00Z", REMARK),
    );
    const { deps: d } = deps(bucket, (_url, i) =>
      gzipped(i === 0 ? partial : raw),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual(["remark", "ok"]);
    const stored = bucket.objects.get(KEY)!;
    expect(stored.options.httpMetadata?.contentEncoding).toBeUndefined();
    expect(stored.options.customMetadata).toMatchObject({
      storedAs: "raw",
      checked: "full",
    });
  });

  it("refuses a gzip answer whose trailer says it decodes to more than the bound, and asks the next operator", async () => {
    // Why: the fill never inflates the whole answer, so a small gzip that
    // decodes to gigabytes would be stored and every client would have to
    // inflate it. The trailer's ISIZE names the decoded size for free.
    const bucket = new FakeBucket();
    const good = await gzip(overpassBody("2026-11-11T09:00:00Z"));
    const bomb = good.slice();
    new DataView(bomb.buffer).setUint32(bomb.length - 4, 200 * 2 ** 20, true);
    const { deps: d } = deps(bucket, (_url, i) =>
      gzipped(i === 0 ? bomb : good),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual(["too-large", "ok"]);
  });

  it("refuses a gzip answer larger than the stored-size bound", async () => {
    const bucket = new FakeBucket();
    const good = await gzip(overpassBody("2026-11-11T09:00:00Z"));
    const huge = new Uint8Array(21 * 2 ** 20);
    huge.set(good.subarray(0, good.length - 8));
    huge.set(good.subarray(good.length - 8), huge.length - 8);
    const { deps: d } = deps(bucket, (_url, i) =>
      gzipped(i === 0 ? huge : good),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual(["too-large", "ok"]);
  });

  it("stores a gzip answer whose tail carries a remark: the tail is the reader's check", async () => {
    // Known and accepted: inflating the whole answer to see its tail costs
    // CPU per MB the Free plan does not have. The client rejects such a
    // body and reports it; the verify job then deletes it.
    const bucket = new FakeBucket();
    const partial = await gzip(overpassBody("2026-11-11T09:00:00Z", REMARK));
    const { deps: d } = deps(bucket, () => gzipped(partial));
    expect((await fillTile(fill, d)).outcome).toBe("filled");
    expect(bucket.objects.get(KEY)!.options.customMetadata?.checked).toBe(
      "head",
    );
  });

  it("writes the failure record BEFORE the first attempt, so a fill the runtime kills still backs off", async () => {
    // Measured on the Free plan: one fill was killed for CPU mid-way. With
    // `max_retries = 0` and the record written only after the attempts,
    // such a kill left nothing behind, and every later POST queued the
    // same multi-megabyte download again.
    const bucket = new FakeBucket();
    const { deps: d, calls } = deps(bucket, () => new Response("unused"), {
      fetchImpl: (input) => {
        calls.push({ url: String(input), body: "", userAgent: null });
        return new Promise<Response>(() => undefined); // killed mid-download
      },
    });
    void fillTile(fill, d);
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(await readFailure(bucket, CELL)).toMatchObject({
      count: 1,
      retryAt: NOW + 3_600_000,
    });
    const next = deps(bucket, () => new Response("never"));
    expect((await fillTile(fill, next.deps)).outcome).toBe("backoff");
    expect(next.calls).toHaveLength(0);
  });

  it("names the failure's reason without counting it twice", async () => {
    const bucket = new FakeBucket();
    const { deps: d } = deps(bucket, () => new Response("x", { status: 504 }));
    await fillTile(fill, d);
    expect(await readFailure(bucket, CELL)).toEqual({
      count: 1,
      retryAt: NOW + 3_600_000,
      reason: "status",
    });
  });

  it("starts no attempt that could run past the consumer's 15-minute limit", async () => {
    // A consumer invocation has 15 minutes of wall time. An attempt may take
    // its whole 200 s timeout, so one started at 11 minutes would end past
    // 14: the runtime would cut it off with nothing recorded but the count.
    const bucket = new FakeBucket();
    let clock = NOW;
    const { deps: d, calls } = deps(
      bucket,
      () => {
        clock += 11 * 60_000;
        return new Response("x", { status: 504 });
      },
      { now: () => clock, attemptTimeoutMs: 200_000 },
    );
    const outcome = await fillTile(fill, d);
    expect(calls).toHaveLength(1);
    expect(outcome.outcome).toBe("failed");
  });

  it("refuses an answer whose data timestamp lies in the future, and asks the next operator", async () => {
    // A future `timestamp_osm_base` (a wrong operator clock) would win every
    // newer-not-older comparison and block refreshes of the tile for good.
    const bucket = new FakeBucket();
    const { deps: d } = deps(bucket, (_url, i) =>
      i === 0
        ? new Response(overpassBody("2026-11-11T12:00:00Z"))
        : new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    const outcome = await fillTile(fill, d);
    expect(outcome.attempts.map((a) => a.result)).toEqual([
      "future-timestamp",
      "ok",
    ]);
    expect(outcome.osmBase).toBe("2026-11-11T09:00:00Z");
  });
});

describe("fillTile: replace", () => {
  // Why these tests matter: a replace is how a tile stuck past the verify
  // is put right (a report of a tile the verify judged good, or a verify
  // the runtime killed). It must refetch whatever the stored data age,
  // never delete, and count against the cell's bad-tile backoff so forged
  // reports cannot turn it into a refetch loop.
  const replace = { cell: CELL, kind: "replace", at: NOW } as const;

  async function stored(bucket: FakeBucket, osmBase: string): Promise<void> {
    await bucket.put(KEY, "old", { customMetadata: { osmBase } });
  }

  it("refetches and stores the answer even when it is not newer, and forgets the memo", async () => {
    const bucket = new FakeBucket();
    await stored(bucket, "2026-11-11T09:30:00Z");
    await writeVerified(bucket, CELL, '"old"', NOW - 1000);
    const { deps: d, calls } = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    expect((await fillTile(replace, d)).outcome).toBe("filled");
    expect(calls).toHaveLength(1);
    expect(bucket.objects.get(KEY)!.options.customMetadata?.osmBase).toBe(
      "2026-11-11T09:00:00Z",
    );
    expect(await readVerified(bucket, CELL)).toBeUndefined();
  });

  it("does not raise the bad count, and a second replace within 24 h sends nothing", async () => {
    // Why: a replace raising the bad count let forged reports ratchet a
    // cell's later genuine backoff to a week; the gap bounds it instead.
    const bucket = new FakeBucket();
    await stored(bucket, "2026-11-11T09:00:00Z");
    await recordBadTile(bucket, CELL, NOW - 3 * 86_400_000, "remark");
    const { deps: d } = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    expect((await fillTile(replace, d)).outcome).toBe("filled");
    expect(await readFailure(bucket, CELL)).toMatchObject({
      badCount: 1,
      retryAt: 0,
    });
    expect(await readLastReplace(bucket, CELL)).toBe(NOW);
    const soon = deps(bucket, () => new Response("never"), {
      now: () => NOW + 86_400_000 - 1,
    });
    expect((await fillTile(replace, soon.deps)).outcome).toBe("too-soon");
    expect(soon.calls).toHaveLength(0);
    const later = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
      { now: () => NOW + 86_400_000 },
    );
    expect((await fillTile(replace, later.deps)).outcome).toBe("filled");
  });

  it("draws on its own share of the day's upstream budget (a third by default)", async () => {
    // Why: forged reports must not spend the budget real fills need. Each
    // replace request counts in the day's total and in the replace share.
    const bucket = new FakeBucket();
    await stored(bucket, "2026-11-11T09:00:00Z");
    const { deps: d } = deps(bucket, (_url, i) =>
      i === 0
        ? new Response("x", { status: 504 })
        : new Response(overpassBody("2026-11-11T09:00:00Z")),
    );
    expect((await fillTile(replace, d)).outcome).toBe("filled");
    expect(await readDaily(bucket, NOW)).toMatchObject({
      upstreamRequests: 2,
      replaceRequests: 2,
    });
    // A cap of 100 leaves replaces 33 a day by default.
    const day = NOW + 2 * 86_400_000;
    await writeDaily(bucket, day, {
      ...(await readDaily(bucket, NOW)),
      upstreamRequests: 33,
      replaceRequests: 33,
    });
    const spent = deps(bucket, () => new Response("never"), {
      now: () => day,
    });
    expect((await fillTile(replace, spent.deps)).outcome).toBe("cap");
    expect(spent.calls).toHaveLength(0);
  });

  it("stops at the replace share mid-way, while an ordinary fill still runs", async () => {
    const bucket = new FakeBucket();
    await stored(bucket, "2026-11-11T09:00:00Z");
    const { deps: d, calls } = deps(
      bucket,
      () => new Response("x", { status: 504 }),
      { dailyReplaceCap: 2 },
    );
    expect((await fillTile(replace, d)).outcome).toBe("failed");
    expect(calls).toHaveLength(2);
    const other = latLngToCell(47.0468, 8.3745, 7);
    const fillOther = deps(
      bucket,
      () => new Response(overpassBody("2026-11-11T09:00:00Z")),
      { dailyReplaceCap: 2 },
    );
    expect(
      (await fillTile({ cell: other, kind: "fill", at: NOW }, fillOther.deps))
        .outcome,
    ).toBe("filled");
  });

  it("never deletes: a failed refetch keeps the stored tile", async () => {
    const bucket = new FakeBucket();
    await stored(bucket, "2026-11-11T09:00:00Z");
    const { deps: d } = deps(bucket, () => new Response("x", { status: 504 }));
    expect((await fillTile(replace, d)).outcome).toBe("failed");
    expect(bucket.textOf(KEY)).toBe("old");
    const failure = await readFailure(bucket, CELL);
    expect(failure).toMatchObject({ count: 1, reason: "status" });
    expect(failure?.badCount).toBeUndefined();
  });

  it("does nothing for a missing tile, and respects the daily cap", async () => {
    const bucket = new FakeBucket();
    const { deps: d, calls } = deps(bucket, () => new Response("never"));
    expect((await fillTile(replace, d)).outcome).toBe("missing");
    await stored(bucket, "2026-11-11T09:00:00Z");
    await writeDaily(bucket, NOW, {
      upstreamRequests: 100,
      fills: 0,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 0,
      replaceRequests: 0,
    });
    expect((await fillTile(replace, d)).outcome).toBe("cap");
    expect(calls).toHaveLength(0);
  });
});
