import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import {
  InMemoryLocalCacheStore,
  type FetchImpl,
} from "gps-plus-slam-app-framework/storage";
import { openTourSession } from "./tour-session.js";

/**
 * Why these tests matter: this module is the viewer's whole data path — if
 * entry listing, image classification, per-entry loading, the stats feed, or
 * the poisoned-cache recovery misbehave, the app shows a broken gallery with
 * no test telling us which layer failed. The poison test is the important
 * one: without the evict-and-retry, one corrupted cached copy bricks the
 * viewer for that URL on EVERY future visit.
 */

async function buildZip(
  extraEntries: Record<string, string> = {},
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"v":1}'));
  await writer.add("images/a.jpg", new TextReader("AAAA"));
  await writer.add("images/b.png", new TextReader("BBBBBB"));
  for (const [name, text] of Object.entries(extraEntries)) {
    await writer.add(name, new TextReader(text));
  }
  return writer.close();
}

/** A minimal valid geo-less level document. */
const LEVEL_JSON = '{"version":1,"qr":{"physicalSizeM":0.2}}';

/** Serves `bytes` with real 206 slices; range-request pattern only. */
function rangeServer(bytes: Uint8Array): FetchImpl {
  return (_input, init) => {
    const range = new Headers(init?.headers).get("range");
    if ((init?.method ?? "GET") === "HEAD") {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { "content-length": String(bytes.length), etag: '"z1"' },
        }),
      );
    }
    if (range === null) {
      return Promise.resolve(new Response(bytes.slice(), { status: 200 }));
    }
    const m = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const [start, end] = [Number(m[1]), Number(m[2])];
    const slice = bytes.slice(start, Math.min(end + 1, bytes.length));
    return Promise.resolve(
      new Response(slice, {
        status: 206,
        headers: {
          "content-range": `bytes ${start}-${start + slice.length - 1}/${bytes.length}`,
        },
      }),
    );
  };
}

describe("loadQrLevels", () => {
  // Why these tests matter (QR-pose plan M3): the viewer's relocalization
  // (M4) selects `qr/<c>.json` from whatever the author put in the zip —
  // zero files is the common tour, and a corrupt file must degrade to "that
  // code has no level", never brick the whole archive.
  it("returns an empty map for a tour with no level files", async () => {
    const fetchImpl = rangeServer(await buildZip());
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });
    await expect(session.loadQrLevels()).resolves.toEqual(new Map());
    await session.close();
  });

  it("loads one and two levels, keyed by their discriminator", async () => {
    const fetchImpl = rangeServer(
      await buildZip({ "qr/1.json": LEVEL_JSON, "qr/2.json": LEVEL_JSON }),
    );
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });
    const levels = await session.loadQrLevels();
    expect([...levels.keys()].sort()).toEqual(["1", "2"]);
    expect(levels.get("1")?.qr.physicalSizeM).toBe(0.2);
    await session.close();
  });

  it("skips a corrupt level file instead of failing the archive (null-tolerant)", async () => {
    const fetchImpl = rangeServer(
      await buildZip({
        "qr/1.json": "{not json",
        "qr/2.json": '{"version":1}',
        "qr/3.json": LEVEL_JSON,
      }),
    );
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });
    const levels = await session.loadQrLevels();
    expect([...levels.keys()]).toEqual(["3"]);
    await session.close();
  });
});

describe("openTourSession", () => {
  it("lists entries with image classification and loads one to a typed Blob", async () => {
    const fetchImpl = rangeServer(await buildZip());
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });

    expect(session.entries.map((e) => [e.filename, e.isImage])).toEqual([
      ["session.json", false],
      ["images/a.jpg", true],
      ["images/b.png", true],
    ]);
    const blob = await session.loadEntry("images/a.jpg");
    expect(blob.type).toBe("image/jpeg");
    expect(await blob.text()).toBe("AAAA");
    await session.close();
  });

  // Why this test matters (PR #357 review): the stats panel used to keep
  // saying "serving from network" after the warm swap while its own
  // cache-read counter climbed — the origin must follow the LATEST read.
  it("flips stats.origin to cache once the warm swap serves reads locally", async () => {
    const fetchImpl = rangeServer(await buildZip());
    const store = new InMemoryLocalCacheStore();
    const session = await openTourSession("https://x/tour.zip", {
      fetchImpl,
      cacheStore: store,
    });

    await session.archive.warmed;
    await session.loadEntry("images/a.jpg");
    expect(session.stats().origin).toBe("cache");
    await session.close();
  });

  it("feeds live stats as reads happen", async () => {
    const fetchImpl = rangeServer(await buildZip());
    let latest = { networkRequests: 0, networkBytes: 0 };
    const session = await openTourSession("https://x/tour.zip", {
      fetchImpl,
      onStats: (s) => {
        latest = {
          networkRequests: s.networkRequests,
          networkBytes: s.networkBytes,
        };
      },
    });

    expect(latest.networkRequests).toBeGreaterThan(0);
    expect(latest.networkBytes).toBeGreaterThan(0);
    expect(session.stats().networkRequests).toBe(latest.networkRequests);
    await session.close();
  });

  it("rejects loading an entry the archive does not contain", async () => {
    const fetchImpl = rangeServer(await buildZip());
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });

    await expect(session.loadEntry("nope.bin")).rejects.toThrow(
      "no readable entry",
    );
    await session.close();
  });

  it("recovers from a poisoned cached copy: evicts it and reopens remote", async () => {
    const zip = await buildZip();
    const fetchImpl = rangeServer(zip);
    const store = new InMemoryLocalCacheStore();
    // Same size as the real archive (so revalidation's size check passes),
    // but garbage — parsing must fail, evict, and retry remote.
    await store.put("https://x/tour.zip", {
      blob: new Blob([new Uint8Array(zip.length).fill(0x5a)]),
    });

    const session = await openTourSession("https://x/tour.zip", {
      fetchImpl,
      cacheStore: store,
    });

    expect(session.entries.length).toBe(3);
    // The poisoned copy is gone; whatever the store now holds (nothing, or a
    // fresh warm copy) parses.
    const now = await store.get("https://x/tour.zip");
    expect(
      now === undefined || (await now.blob.slice(0, 2).text()) === "PK",
    ).toBe(true);
    await session.close();
  });

  it("reports a broken REMOTE archive as-is (no futile retry loop)", async () => {
    const fetchImpl = rangeServer(new Uint8Array(64).fill(0x5a));

    await expect(
      openTourSession("https://x/tour.zip", { fetchImpl }),
    ).rejects.toThrow();
  });

  // Why this test matters (milestone review #1): a broken remote archive used
  // to leak its OpenedArchive — the background warm download kept pulling the
  // whole file and then CACHED the bytes that had just failed to parse,
  // poisoning the next visit.
  it("does not leave a failed remote archive in the cache", async () => {
    const fetchImpl = rangeServer(new Uint8Array(64).fill(0x5a));
    const store = new InMemoryLocalCacheStore();

    await expect(
      openTourSession("https://x/tour.zip", { fetchImpl, cacheStore: store }),
    ).rejects.toThrow();
    await expect(store.get("https://x/tour.zip")).resolves.toBeUndefined();
  });
});

// Why these tests matter (geo-join M-B): the join's inputs come through
// these two accessors, and BOTH are null-tolerant by contract — a
// hand-built tour zip (no recording) and a corrupt stream must read as
// "keep the ring", never as a broken archive.
/** Exactly the given entries - no defaults; the recording tests need to
 *  control session.json themselves. */
async function buildExactZip(
  entries: Record<string, string>,
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  for (const [name, text] of Object.entries(entries)) {
    await writer.add(name, new TextReader(text));
  }
  return writer.close();
}

describe("loadRecordingActions / loadSessionMeta", () => {
  it("returns the parsed action stream and session meta for a recording zip", async () => {
    const fetchImpl = rangeServer(
      await buildExactZip({
        "session.json": '{"version":1,"odomCoordVersion":5}',
        "actions/000001.json":
          '{"type":"gpsData/setZeroPos","payload":{"lat":1,"lon":2}}',
        "actions/000002.json": '{"type":"recording/startSession","payload":{}}',
      }),
    );
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });
    const actions = await session.loadRecordingActions();
    expect(actions?.map((a) => a.type)).toEqual([
      "gpsData/setZeroPos",
      "recording/startSession",
    ]);
    await expect(session.loadSessionMeta()).resolves.toMatchObject({
      odomCoordVersion: 5,
    });
  });

  it("returns null for a hand-built zip without a recording — the ring path, not an error", async () => {
    const fetchImpl = rangeServer(
      await buildExactZip({ "qr/1.json": LEVEL_JSON }),
    );
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });
    await expect(session.loadRecordingActions()).resolves.toBeNull();
    await expect(session.loadSessionMeta()).resolves.toBeNull();
  });

  it("returns null session meta for corrupt session.json", async () => {
    const fetchImpl = rangeServer(
      await buildExactZip({ "session.json": "not json {{" }),
    );
    const session = await openTourSession("https://x/tour.zip", { fetchImpl });
    await expect(session.loadSessionMeta()).resolves.toBeNull();
  });
});
