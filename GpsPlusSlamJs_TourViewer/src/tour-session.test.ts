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

async function buildZip(): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { level: 0 });
  await writer.add("session.json", new TextReader('{"v":1}'));
  await writer.add("images/a.jpg", new TextReader("AAAA"));
  await writer.add("images/b.png", new TextReader("BBBBBB"));
  return writer.close();
}

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
