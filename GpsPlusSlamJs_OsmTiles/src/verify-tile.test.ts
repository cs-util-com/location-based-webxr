import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { latLngToCell } from "h3-js";
import { verifyTile, type VerifyDeps } from "./verify-tile";
import { tileObjectKey } from "./tile-cell";
import {
  readDaily,
  readFailure,
  readVerified,
  writeDaily,
  writeVerified,
} from "./fill-state";
import { FakeBucket } from "./testing/fake-bindings";
import { REAL_TAIL_A, REAL_TAIL_B } from "./testing/overpass-tails";

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
    expect((await readVerified(bucket, CELL))?.etag).toBe(etag);
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
    expect(await readVerified(bucket, CELL)).toBeUndefined();
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
    await writeVerified(bucket, CELL, etag, NOW - 1000);
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome.outcome).toBe("verified");
    expect((await readDaily(bucket, NOW)).verifies).toBe(0);
  });

  it("verifies a tile again once its good memo is older than a week", async () => {
    // Why: a memo that never expired would keep a tile the verify misjudged
    // (or the client judges stricter) out of every later check for good.
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2));
    await writeVerified(bucket, CELL, etag, NOW - 7 * 86_400_000 - 1);
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome.outcome).toBe("good");
    expect((await readDaily(bucket, NOW)).verifies).toBe(1);
    expect(await readVerified(bucket, CELL)).toEqual({
      etag,
      state: "good",
      at: NOW,
    });
  });

  it("marks the memo started BEFORE it reads the body, so a killed verify leaves a trace", async () => {
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2));
    const states: string[] = [];
    const put = bucket.put.bind(bucket);
    bucket.put = (key, value, options) => {
      if (key.startsWith("state/verified/")) {
        states.push(options?.customMetadata?.["state"] ?? "");
      }
      return put(key, value, options);
    };
    await verifyTile(verify(etag), deps(bucket));
    expect(states).toEqual(["started", "good"]);
  });

  it("does not start again on an object whose last verify never finished", async () => {
    // Why: a verify the runtime killed on this object would be killed again;
    // the report endpoint replaces such a tile instead (a refetch).
    const bucket = new FakeBucket();
    const etag = await storeGzip(bucket, overpassBody(2, REMARK));
    await writeVerified(bucket, CELL, etag, NOW - 60_000, "started");
    const outcome = await verifyTile(verify(etag), deps(bucket));
    expect(outcome.outcome).toBe("unfinished");
    expect(bucket.objects.has(KEY)).toBe(true);
    expect((await readDaily(bucket, NOW)).verifies).toBe(0);
  });

  it("deletes a tile that decodes to more than the decoded-size bound (a gzip bomb)", async () => {
    // Why: the stored gzip may be small and still inflate to gigabytes; the
    // verify must stop counting at its bound and treat the tile as bad
    // rather than spend the consumer's CPU on it.
    const bucket = new FakeBucket();
    const padded = overpassBody(1).replace(
      '"elements"',
      `"pad": "${" ".repeat(400_000)}", "elements"`,
    );
    const etag = await storeGzip(bucket, padded);
    const outcome = await verifyTile(
      verify(etag),
      deps(bucket, { maxDecodedBytes: 100_000 }),
    );
    expect(outcome).toMatchObject({ outcome: "bad", reason: "too-large" });
    expect(bucket.objects.has(KEY)).toBe(false);
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

  describe("deletes only on positive evidence", () => {
    // Why these tests matter: a delete costs the operators a refill, and a
    // report can name any tile. The fill's tail pattern knows the layout
    // Overpass writes today; the verify must not delete a complete answer
    // because a later Overpass version lays it out otherwise, so it deletes
    // only on what proves a tile bad: a gzip that does not decode, a
    // top-level remark, a head that is not JSON, or an end that does not
    // close at all.
    const HEAD =
      '{\n  "version": 0.6,\n  "generator": "Overpass API 0.7.62.11",\n  "osm3s": {\n    "timestamp_osm_base": "2026-11-13T11:00:00Z"\n  },\n  "elements": [\n';

    it("keeps a complete answer in a layout the fill's tail pattern does not know", async () => {
      const bucket = new FakeBucket();
      const compact = JSON.stringify({
        version: 0.6,
        osm3s: { timestamp_osm_base: "2026-11-13T11:00:00Z" },
        elements: [{ type: "node", id: 1, lat: 1, lon: 2 }],
      });
      const etag = await storeRaw(bucket, compact);
      expect((await verifyTile(verify(etag), deps(bucket))).outcome).toBe(
        "good",
      );
      expect(bucket.objects.has(KEY)).toBe(true);
    });

    it("keeps a JSON tile whose head lacks the data timestamp", async () => {
      const bucket = new FakeBucket();
      const etag = await storeGzip(
        bucket,
        overpassBody(2).replace("timestamp_osm_base", "other"),
      );
      expect((await verifyTile(verify(etag), deps(bucket))).outcome).toBe(
        "good",
      );
    });

    it("deletes a tile whose head is no JSON", async () => {
      const bucket = new FakeBucket();
      const etag = await storeRaw(bucket, "<html>502</html>\n}");
      expect(await verifyTile(verify(etag), deps(bucket))).toMatchObject({
        outcome: "bad",
        reason: "not-json",
      });
    });

    it("keeps real operator answers and deletes their partial and cut forms", async () => {
      for (const tail of [REAL_TAIL_A, REAL_TAIL_B]) {
        for (const compressed of [false, true]) {
          const store = compressed ? storeGzip : storeRaw;
          const bucket = new FakeBucket();
          const good = await store(bucket, HEAD + tail);
          expect(
            (await verifyTile(verify(good), deps(bucket))).outcome,
            "complete",
          ).toBe("good");
          const remark = tail.replace(
            /\]\s*\}\s*$/,
            '],\n  "remark": "runtime error: Query timed out"\n}\n',
          );
          const partial = await store(bucket, HEAD + remark);
          expect(
            await verifyTile(verify(partial), deps(bucket)),
            "remark",
          ).toMatchObject({ outcome: "bad", reason: "remark" });
          const cut = await store(bucket, HEAD + tail.slice(0, -40));
          expect(
            await verifyTile(verify(cut), deps(bucket)),
            "cut",
          ).toMatchObject({ outcome: "bad", reason: "incomplete" });
        }
      }
    });

    it("property: a complete answer of any indent and any extra keys is never deleted", async () => {
      // The answers are built by JSON.stringify, not by the layout the
      // checks look for, so the property does not restate the checks.
      const element = fc.record({
        type: fc.constantFrom("node", "way", "relation"),
        id: fc.nat(),
        tags: fc.dictionary(fc.string({ maxLength: 6 }), fc.string()),
      });
      const extraKey = fc
        .string({ minLength: 1, maxLength: 8 })
        .filter((k) => !["remark", "elements", "version"].includes(k));
      await fc.assert(
        fc.asyncProperty(
          fc.array(element, { maxLength: 30 }),
          fc.dictionary(extraKey, fc.jsonValue(), { maxKeys: 3 }),
          fc.integer({ min: 0, max: 4 }),
          fc.boolean(),
          async (elements, extra, indent, compressed) => {
            const text = JSON.stringify(
              {
                version: 0.6,
                osm3s: { timestamp_osm_base: "2026-11-13T11:00:00Z" },
                elements,
                ...extra,
              },
              null,
              indent,
            );
            const bucket = new FakeBucket();
            const etag = compressed
              ? await storeGzip(bucket, text)
              : await storeRaw(bucket, text);
            expect((await verifyTile(verify(etag), deps(bucket))).outcome).toBe(
              "good",
            );
            expect(bucket.objects.has(KEY)).toBe(true);
          },
        ),
        { numRuns: 40 },
      );
    });

    it("property: a gzip tile cut anywhere is always deleted", async () => {
      const full = await gzip(overpassBody(200));
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: full.length - 1 }),
          async (length) => {
            const bucket = new FakeBucket();
            await bucket.put(KEY, full.slice(0, length), {
              httpMetadata: { contentEncoding: "gzip" },
              customMetadata: { osmBase: "2026-11-13T11:00:00Z" },
            });
            const etag = (await bucket.head(KEY))!.httpEtag;
            const outcome = await verifyTile(verify(etag), deps(bucket));
            expect(outcome.outcome).toBe("bad");
            expect(bucket.objects.has(KEY)).toBe(false);
          },
        ),
        { numRuns: 40 },
      );
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
