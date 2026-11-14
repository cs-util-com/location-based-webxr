import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  clearFailure,
  clearVerified,
  readVerified,
  recordBadTile,
  writeVerified,
  failureBackoffMs,
  msUntilNextUtcDay,
  readDaily,
  readFailure,
  clearPending,
  clearVerifying,
  listPending,
  listVerifying,
  markPending,
  markVerifying,
  readVerifying,
  sweepVerifying,
  PENDING_STALE_MS,
  recordFailure,
  sweepPending,
  utcDay,
  writeDaily,
  writeFailure,
} from "./fill-state";
import { FakeBucket } from "./testing/fake-bindings";

// Why these tests matter: the daily cap and the per-tile failure record are
// what keep one script, or one tile that always times out, from spending the
// whole day's Overpass budget. Both live in small R2 objects that only the
// serial consumer writes; a wrong key or a backoff that shrinks would quietly
// remove the bound.

describe("failureBackoffMs", () => {
  it("starts at an hour and doubles", () => {
    expect(failureBackoffMs(1)).toBe(3_600_000);
    expect(failureBackoffMs(2)).toBe(7_200_000);
  });

  it("property: never shrinks with more failures and never exceeds a week", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (count) => {
        expect(failureBackoffMs(count + 1)).toBeGreaterThanOrEqual(
          failureBackoffMs(count),
        );
        expect(failureBackoffMs(count)).toBeLessThanOrEqual(7 * 86_400_000);
      }),
    );
  });
});

describe("the daily counter", () => {
  it("is keyed by the UTC day and starts empty", async () => {
    const bucket = new FakeBucket();
    const now = Date.parse("2026-11-11T23:59:00Z");
    expect(utcDay(now)).toBe("2026-11-11");
    expect(await readDaily(bucket, now)).toEqual({
      upstreamRequests: 0,
      fills: 0,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 0,
    });
    await writeDaily(bucket, now, {
      upstreamRequests: 3,
      fills: 1,
      failures: 0,
      rawBytes: 10,
      storedBytes: 4,
      verifies: 0,
    });
    expect((await readDaily(bucket, now)).upstreamRequests).toBe(3);
    const nextDay = Date.parse("2026-11-12T00:00:01Z");
    expect((await readDaily(bucket, nextDay)).upstreamRequests).toBe(0);
  });

  it("reads a damaged counter as empty rather than throwing", async () => {
    const bucket = new FakeBucket();
    const now = Date.parse("2026-11-11T12:00:00Z");
    await bucket.put("state/daily/2026-11-11.json", "{not json");
    expect((await readDaily(bucket, now)).upstreamRequests).toBe(0);
  });

  it("knows how long until the counter resets", () => {
    expect(msUntilNextUtcDay(Date.parse("2026-11-11T23:59:00Z"))).toBe(60_000);
  });
});

describe("the failure record", () => {
  it("counts up and sets the next allowed time", async () => {
    const bucket = new FakeBucket();
    const now = 1_000_000;
    const first = await recordFailure(bucket, "871fa", now, "remark");
    expect(first).toEqual({
      count: 1,
      retryAt: now + 3_600_000,
      reason: "remark",
    });
    const second = await recordFailure(bucket, "871fa", now, "timeout");
    expect(second.count).toBe(2);
    expect((await readFailure(bucket, "871fa"))?.retryAt).toBe(now + 7_200_000);
  });
});

describe("a bad tile's record", () => {
  // Why: a verify that finds a stored tile bad deletes it; without a record
  // that outlives the next successful fill, a cell whose answer is always
  // partial would loop fill, report, delete, fill once an hour.
  it("backs the cell off by its bad count, and survives a successful fill", async () => {
    const bucket = new FakeBucket();
    const first = await recordBadTile(bucket, "871fa", 0, "remark");
    expect(first).toMatchObject({ retryAt: 3_600_000, badCount: 1 });
    await clearFailure(bucket, "871fa");
    expect(await readFailure(bucket, "871fa")).toMatchObject({
      count: 0,
      retryAt: 0,
      badCount: 1,
    });
    const second = await recordBadTile(bucket, "871fa", 10, "remark");
    expect(second).toMatchObject({ retryAt: 10 + 7_200_000, badCount: 2 });
  });

  it("keeps its bad count through ordinary failures", async () => {
    const bucket = new FakeBucket();
    await recordBadTile(bucket, "871fa", 0, "incomplete");
    const failed = await recordFailure(bucket, "871fa", 0, "status");
    expect(failed).toMatchObject({ count: 1, badCount: 1 });
  });

  it("is removed by a successful fill when no tile of the cell was ever bad", async () => {
    const bucket = new FakeBucket();
    await recordFailure(bucket, "871fa", 0, "status");
    await clearFailure(bucket, "871fa");
    expect(await readFailure(bucket, "871fa")).toBeUndefined();
  });
});

describe("the verified memo", () => {
  it("holds the ETag of the object last verified good", async () => {
    const bucket = new FakeBucket();
    expect(await readVerified(bucket, "871fa")).toBeUndefined();
    await writeVerified(bucket, "871fa", '"abc"', 5);
    expect((await readVerified(bucket, "871fa"))?.etag).toBe('"abc"');
    await clearVerified(bucket, "871fa");
    expect(await readVerified(bucket, "871fa")).toBeUndefined();
  });

  it("holds the verify's state and time: started before the inflate, good after", async () => {
    // Why: a verify the runtime kills (CPU, on a huge tile) must leave a
    // trace, or every later report would start the same killed verify again
    // and the tile would stay stuck; and a good memo must expire, or a tile
    // the verify misjudged would be stuck for good.
    const bucket = new FakeBucket();
    await writeVerified(bucket, "871fa", '"abc"', 5, "started");
    expect(await readVerified(bucket, "871fa")).toEqual({
      etag: '"abc"',
      state: "started",
      at: 5,
    });
    await writeVerified(bucket, "871fa", '"abc"', 9);
    expect(await readVerified(bucket, "871fa")).toEqual({
      etag: '"abc"',
      state: "good",
      at: 9,
    });
  });

  it("reads a memo written before it held a state as good and long expired", async () => {
    const bucket = new FakeBucket();
    await bucket.put("state/verified/871fa", "", {
      customMetadata: { etag: '"abc"' },
    });
    expect(await readVerified(bucket, "871fa")).toEqual({
      etag: '"abc"',
      state: "good",
      at: 0,
    });
  });
});

describe("writeFailure", () => {
  it("replaces the reason without counting another failure", async () => {
    // The fill writes its record BEFORE the first attempt (a runtime kill
    // must still leave backoff behind) and only names the reason at the end;
    // naming it must not double the backoff.
    const bucket = new FakeBucket();
    const started = await recordFailure(bucket, "871fa", 0, "unfinished");
    await writeFailure(bucket, "871fa", { ...started, reason: "remark" });
    expect(await readFailure(bucket, "871fa")).toEqual({
      count: 1,
      retryAt: 3_600_000,
      reason: "remark",
    });
  });
});

describe("the pending-fill markers", () => {
  // Why these tests matter: the markers are the backlog the fill endpoint
  // reads to answer "busy" at once instead of letting a viewer wait behind
  // other fills, and to never queue one cell twice. A marker that outlived
  // its fill (the runtime killed the consumer) must stop counting, or the
  // endpoint would refuse every fill for good.
  const NOW = Date.parse("2026-11-11T10:00:00Z");

  it("lists fresh markers with their state, oldest first", async () => {
    const bucket = new FakeBucket();
    await markPending(bucket, "b", NOW - 1000);
    await markPending(bucket, "a", NOW - 2000, true);
    expect(await listPending(bucket, NOW)).toEqual([
      { cell: "a", queuedAt: NOW - 2000, running: true },
      { cell: "b", queuedAt: NOW - 1000, running: false },
    ]);
    await clearPending(bucket, "a");
    expect((await listPending(bucket, NOW)).map((p) => p.cell)).toEqual(["b"]);
  });

  it("ignores a marker older than the stale age", async () => {
    const bucket = new FakeBucket();
    await markPending(bucket, "old", NOW - PENDING_STALE_MS - 1);
    await markPending(bucket, "new", NOW - PENDING_STALE_MS + 1);
    expect((await listPending(bucket, NOW)).map((p) => p.cell)).toEqual([
      "new",
    ]);
  });

  it("sweep: removes running markers (their consumer is gone) and stale ones, keeps queued ones", async () => {
    // The consumer is serial, so when a message starts, any marker still
    // flagged running belongs to a run the runtime killed.
    const bucket = new FakeBucket();
    await markPending(bucket, "dead", NOW - 60_000, true);
    await markPending(bucket, "stale", NOW - PENDING_STALE_MS - 1);
    await markPending(bucket, "queued", NOW - 30_000);
    await sweepPending(bucket, NOW);
    expect((await listPending(bucket, NOW)).map((p) => p.cell)).toEqual([
      "queued",
    ]);
    expect(bucket.objects.has("state/pending/stale")).toBe(false);
  });

  it("property: a listing holds exactly the fresh markers, each once", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.record({
            cell: fc.stringMatching(/^[0-9a-f]{15}$/),
            age: fc.integer({ min: 0, max: 2 * PENDING_STALE_MS }),
          }),
          { selector: (m) => m.cell, maxLength: 20 },
        ),
        async (markers) => {
          const bucket = new FakeBucket();
          for (const m of markers)
            await markPending(bucket, m.cell, NOW - m.age);
          const listed = (await listPending(bucket, NOW)).map((p) => p.cell);
          const fresh = markers
            .filter((m) => m.age < PENDING_STALE_MS)
            .map((m) => m.cell);
          expect([...listed].sort()).toEqual([...fresh].sort());
        },
      ),
    );
  });
});

describe("verifying markers", () => {
  // Why these tests matter: a report writes one marker per cell before it
  // queues a verify, and the report endpoint reads them to send at most one
  // message per open verify and to bound how many are open at all. A
  // marker that never went stale, or a sweep that missed one, would either
  // refuse every later report of that cell or let the backlog grow.
  const NOW = Date.parse("2026-11-11T10:00:00Z");
  it("holds the reported ETag and lists only fresh markers", async () => {
    const bucket = new FakeBucket();
    await markVerifying(bucket, "fresh", '"a"', NOW - 1000);
    await markVerifying(bucket, "stale", '"b"', NOW - PENDING_STALE_MS);
    expect(await readVerifying(bucket, "fresh", NOW)).toEqual({
      cell: "fresh",
      etag: '"a"',
      queuedAt: NOW - 1000,
    });
    expect(await readVerifying(bucket, "stale", NOW)).toBeUndefined();
    expect((await listVerifying(bucket, NOW)).map((m) => m.cell)).toEqual([
      "fresh",
    ]);
  });

  it("clears one marker, and sweeps the stale ones", async () => {
    const bucket = new FakeBucket();
    await markVerifying(bucket, "fresh", '"a"', NOW - 1000);
    await markVerifying(bucket, "stale", '"b"', NOW - PENDING_STALE_MS);
    await markVerifying(bucket, "done", '"c"', NOW);
    await clearVerifying(bucket, "done");
    await sweepVerifying(bucket, NOW);
    expect(
      [...bucket.objects.keys()].filter((k) =>
        k.startsWith("state/verifying/"),
      ),
    ).toEqual(["state/verifying/fresh"]);
  });
});
