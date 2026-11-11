import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  failureBackoffMs,
  msUntilNextUtcDay,
  readDaily,
  readFailure,
  recordFailure,
  upsertManifestLine,
  utcDay,
  writeDaily,
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
    });
    await writeDaily(bucket, now, {
      upstreamRequests: 3,
      fills: 1,
      failures: 0,
      rawBytes: 10,
      storedBytes: 4,
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

describe("upsertManifestLine", () => {
  it("appends a new cell and replaces an existing cell's line", () => {
    const one = upsertManifestLine("", "a", "2026-11-11T00:00:00Z", 5);
    expect(one).toBe("a\t2026-11-11T00:00:00Z\t5\n");
    const two = upsertManifestLine(one, "b", "2026-11-11T00:00:00Z", 6);
    const three = upsertManifestLine(two, "a", "2026-12-11T00:00:00Z", 7);
    expect(three).toBe(
      "a\t2026-12-11T00:00:00Z\t7\nb\t2026-11-11T00:00:00Z\t6\n",
    );
  });
});
