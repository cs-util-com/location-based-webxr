import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { verifyTile, type VerifyDeps } from "./verify-tile";
import { tileObjectKey } from "./tile-cell";
import {
  readDaily,
  readFailure,
  readVerifiedEtag,
  writeDaily,
  writeVerified,
} from "./fill-state";
import { FakeBucket } from "./testing/fake-bindings";

// Why these tests matter: a viewer's report of a bad tile is the only way a
// stored tile is ever deleted, and anyone can send one. The verify job is
// what makes that safe: it judges the stored bytes itself, so a good tile
// survives any number of reports, a bad one (a partial answer stored on its
// head alone, or a cut file) is removed with a growing backoff, and each
// object costs at most one verify however often it is reported.

const CELL = latLngToCell(50.9384, 6.9598, 7);
const KEY = tileObjectKey(CELL);
const NOW = Date.parse("2026-11-13T12:00:00Z");

function overpassBody(elements = 1, extra = ""): string {
  const items = Array.from(
    { length: elements },
    (_, i) => `{"type":"node","id":${i + 1},"lat":1,"lon":2}`,
  ).join(",\n");
  return `{\n  "version": 0.6,\n  "osm3s": {\n    "timestamp_osm_base": "2026-11-13T11:00:00Z"\n  },\n  "elements": [\n${items}\n\n  ]${extra}\n}\n`;
}

const REMARK = ',\n  "remark": "runtime error: Query run out of memory"';

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function storeGzip(
  bucket: FakeBucket,
  text: string,
  legacy = false,
): Promise<string> {
  await bucket.put(KEY, await gzip(text), {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
    customMetadata: legacy
      ? { osmBase: "2026-11-13T11:00:00Z" }
      : { osmBase: "2026-11-13T11:00:00Z", storedAs: "upstream-gzip" },
  });
  return (await bucket.head(KEY))!.httpEtag;
}

async function storeRaw(bucket: FakeBucket, text: string): Promise<string> {
  await bucket.put(KEY, text, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { osmBase: "2026-11-13T11:00:00Z", storedAs: "raw" },
  });
  return (await bucket.head(KEY))!.httpEtag;
}

function deps(bucket: FakeBucket, overrides: Partial<VerifyDeps> = {}) {
  return { bucket, now: () => NOW, dailyVerifyCap: 50, ...overrides };
}

function verify(etag?: string) {
  return {
    cell: CELL,
    kind: "verify",
    at: NOW,
    ...(etag === undefined ? {} : { etag }),
  } as const;
}

describe("verifyTile", () => {
  it("keeps a good gzip tile, remembers its ETag, and counts one verify", async () => {
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(3));
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome.outcome).toBe("good");
    expect(bucket.objects.has(KEY)).toBe(true);
    expect(await readVerifiedEtag(bucket, CELL)).toBe(etag);
    expect((await readDaily(bucket, NOW)).verifies).toBe(1);
  });

  it("deletes a gzip tile whose tail carries a remark, and backs the cell off", async () => {
    // The fill stores an upstream gzip answer on its head alone, so a
    // partial answer (Overpass's remark after a cut array) can be stored;
    // this is where it is found and removed.
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2, REMARK));
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome).toMatchObject({ outcome: "bad", reason: "remark" });
    expect(bucket.objects.has(KEY)).toBe(false);
    expect(await readVerifiedEtag(bucket, CELL)).toBeUndefined();
    expect(await readFailure(bucket, CELL)).toMatchObject({
      retryAt: NOW + 3_600_000,
      badCount: 1,
    });
  });

  it("deletes a raw tile that was cut short", async () => {
    const bucket = new FakeBucket();
    const text = overpassBody(4);
    const etag = await storeRaw(bucket, text.slice(0, text.length - 12));
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome).toMatchObject({ outcome: "bad", reason: "incomplete" });
    expect(bucket.objects.has(KEY)).toBe(false);
  });

  it("deletes a tile whose gzip does not inflate", async () => {
    const bucket = new FakeBucket();
    await bucket.put(KEY, new Uint8Array([31, 139, 8, 0, 9, 9, 9, 9, 9, 9]), {
      httpMetadata: { contentEncoding: "gzip" },
      customMetadata: { osmBase: "2026-11-13T11:00:00Z" },
    });
    const etag = (await bucket.head(KEY))!.httpEtag;
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome).toMatchObject({ outcome: "bad", reason: "encoding" });
    expect(bucket.objects.has(KEY)).toBe(false);
  });

  it("keeps a tile stored before verification existed (its own gzip, no storedAs)", async () => {
    // No migration of the stored objects: the old fill compressed complete,
    // fully checked answers, and they verify as good.
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2), true);
    expect((await verifyTile(verify(etag), deps(bucket))).outcome).toBe("good");
    expect(bucket.objects.has(KEY)).toBe(true);
  });

  it("does nothing for an object already replaced (the reported ETag differs)", async () => {
    const bucket = new FakeBucket();
    await storeGzip(bucket, overpassBody(2, REMARK));
    const outcome = await verifyTile(verify('"an-older-object"'), deps(bucket));
    expect(outcome.outcome).toBe("stale");
    expect(bucket.objects.has(KEY)).toBe(true);
    expect((await readDaily(bucket, NOW)).verifies).toBe(0);
  });

  it("does nothing for a missing tile", async () => {
    const bucket = new FakeBucket();
    const outcome = await verifyTile(verify('"x"'), deps(bucket));
    expect(outcome.outcome).toBe("missing");
    expect((await readDaily(bucket, NOW)).verifies).toBe(0);
  });

  it("verifies one object once: a remembered good ETag costs no inflate", async () => {
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2));
    await writeVerified(bucket, CELL, etag);
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome.outcome).toBe("verified");
    expect((await readDaily(bucket, NOW)).verifies).toBe(0);
  });

  it("stops at the daily verify cap without reading the tile", async () => {
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2, REMARK));
    await writeDaily(bucket, NOW, {
      upstreamRequests: 0,
      fills: 0,
      failures: 0,
      rawBytes: 0,
      storedBytes: 0,
      verifies: 2,
    });
    const outcome = await verifyTile(
      verify(etag),
      deps(bucket, { dailyVerifyCap: 2 }),
    );
    expect(outcome.outcome).toBe("cap");
    expect(bucket.objects.has(KEY)).toBe(true);
  });

  it("grows the backoff of a cell found bad again after a refill", async () => {
    // A cell whose answer is always partial must not loop fill, report,
    // delete, fill every hour: the bad count survives the refill.
    const bucket = new FakeBucket();
    const first = await storeGzip(bucket, overpassBody(2, REMARK));
    await verifyTile(verify(first), deps(bucket));
    const later = NOW + 2 * 3_600_000;
    const second = await storeGzip(bucket, overpassBody(3, REMARK));
    await verifyTile(verify(second), deps(bucket, { now: () => later }));
    expect(await readFailure(bucket, CELL)).toMatchObject({
      retryAt: later + 7_200_000,
      badCount: 2,
    });
  });

  it("property: a complete answer, gzip or raw and of any size, is never deleted", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 1500 }),
        fc.boolean(),
        async (elements, compressed) => {
          const bucket = new FakeBucket();
          const text = overpassBody(elements);
          const etag = compressed
            ? await storeGzip(bucket, text)
            : await storeRaw(bucket, text);
          const outcome = await verifyTile(verify(etag), deps(bucket));
          expect(outcome.outcome).toBe("good");
          expect(bucket.objects.has(KEY)).toBe(true);
        },
      ),
      { numRuns: 15 },
    );
  });
});
