import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import {
  InMemoryLocalCacheStore,
  packFilesAsZip,
  type FetchImpl,
} from "gps-plus-slam-app-framework/storage";
import {
  createEmptyTourManifest,
  serializeTourManifest,
} from "gps-plus-slam-app-framework/ar/tour-manifest";
import {
  archiveFileName,
  openTourSession,
  readArchiveInSlices,
} from "./tour-session.js";

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

  // Why this test matters (flows plan M1, milestone review #6): `hasRecording`
  // drives user-facing copy ("nothing to place" vs the decline reason) and
  // must apply the same pre-check as `loadRecordingActions` - a wrapping
  // folder tolerated (milestone review finding 10), images-only false.
  it("hasRecording mirrors the actions/ pre-check, wrapping folder included", async () => {
    const plain = await openTourSession("https://x/plain.zip", {
      fetchImpl: rangeServer(
        await buildExactZip({ "images/a.png": "not really a png" }),
      ),
    });
    expect(plain.hasRecording).toBe(false);
    const flat = await openTourSession("https://x/flat.zip", {
      fetchImpl: rangeServer(
        await buildExactZip({ "actions/000001.json": "{}" }),
      ),
    });
    expect(flat.hasRecording).toBe(true);
    const wrapped = await openTourSession("https://x/wrapped.zip", {
      fetchImpl: rangeServer(
        await buildExactZip({ "walk-1/actions/000001.json": "{}" }),
      ),
    });
    expect(wrapped.hasRecording).toBe(true);
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

describe("corsProxyBaseUrl plumbing", () => {
  // Why this test matters (drive-proxy plan Rev 2, M-B): the option rides
  // three layers (viewer -> openRemoteArchive -> normalizeShareUrl), and a
  // dropped spread anywhere leaves Drive tours silently on the
  // browser-blocked usercontent URL. This proves a Drive share link puts
  // the PROXY URL on the wire, end to end.
  it("routes a Drive share link through the configured proxy", async () => {
    const bytes = await buildZip();
    const urls: string[] = [];
    const inner = rangeServer(bytes);
    const fetchImpl: FetchImpl = (input, init) => {
      urls.push(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return inner(input, init);
    };
    const session = await openTourSession(
      "https://drive.google.com/file/d/ID42/view",
      {
        fetchImpl,
        corsProxyBaseUrl: "https://proxy.example/api/drive-proxy",
      },
    );
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toBe("https://proxy.example/api/drive-proxy?id=ID42");
    }
    await session.close();
  });
});

describe("archiveFileName (guided-setup plan M3)", () => {
  // Why this matters: the replace step is a SAME-NAME upload, so the
  // download must carry the hosted file's name - and a Drive id or a proxy
  // route carries no name worth guessing at.
  it("takes the last path segment when it is a .zip, decoded", () => {
    expect(archiveFileName("http://h/ranges-ok/tour.zip")).toBe("tour.zip");
    expect(archiveFileName("https://h/a/My%20Tour.ZIP?x=1")).toBe(
      "My Tour.ZIP",
    );
  });

  it("falls back to tour.zip for anything else", () => {
    expect(archiveFileName("https://drive.google.com/uc?id=abc")).toBe(
      "tour.zip",
    );
    expect(archiveFileName("https://gps.csutil.com/api/drive-proxy/abc")).toBe(
      "tour.zip",
    );
    expect(archiveFileName("not a url")).toBe("tour.zip");
    // A backslash is a path separator to the save dialog on Windows.
    expect(archiveFileName("https://h/a/..%5Cb.zip")).toBe("tour.zip");
  });
});

describe("loadTourManifest / readWholeArchive (guided-setup plan M3)", () => {
  // Why these matter: the finish step rebuilds the hosted zip from
  // `readWholeArchive` and writes `tour.json` back from `loadTourManifest`.
  // A wrong input (a stale cached copy, or a truncated range read) or a
  // dropped manifest would silently lose the creator's work.
  it("returns null for a zip without tour.json, the parsed manifest with one, and REJECTS a broken one", async () => {
    const none = await openTourSession("https://x/tour.zip", {
      fetchImpl: rangeServer(await buildZip()),
    });
    await expect(none.loadTourManifest()).resolves.toBeNull();
    await none.close();

    const withManifest = await openTourSession("https://x/tour.zip", {
      fetchImpl: rangeServer(
        await buildZip({ "tour.json": '{"version":1,"objects":[]}' }),
      ),
    });
    await expect(withManifest.loadTourManifest()).resolves.toEqual({
      version: 1,
      objects: [],
    });
    await withManifest.close();

    const broken = await openTourSession("https://x/tour.zip", {
      fetchImpl: rangeServer(await buildZip({ "tour.json": '{"version":9}' })),
    });
    await expect(broken.loadTourManifest()).rejects.toThrow(/version/);
    await broken.close();
  });

  it("resolves a WRAPPED tour's content entries through the manifest's own prefix (PR #435 review)", async () => {
    // Why this matters: a creator who unzips the rebuilt archive and
    // re-zips the FOLDER gets `mytour/tour.json` + `mytour/content/x.jpg`,
    // a shape the archive convention explicitly tolerates. The manifest
    // can only ever carry the unwrapped `content/<id>.jpg` (the parser
    // pins that shape), so a reader that passes the name straight to the
    // exact-name `loadEntry` finds nothing and every placed photo
    // disappears into "could not load" - pins still render, so the tour
    // looks half-placed rather than broken.
    const photo = {
      id: "ab12ab12ab12ab12",
      kind: "photo",
      image: "content/ab12ab12ab12ab12.jpg",
      geo: { lat: 47.5, lon: 8.7, alt: 400, rotation: [0, 0, 0, 1] },
      createdAtIso: "2026-09-08T12:00:00.000Z",
      imageWidth: 1024,
      imageHeight: 768,
    };
    const wrapped = await openTourSession("https://x/wrapped.zip", {
      fetchImpl: rangeServer(
        await buildExactZip({
          "mytour/tour.json": JSON.stringify({ version: 1, objects: [photo] }),
          "mytour/content/ab12ab12ab12ab12.jpg": "jpeg-bytes",
        }),
      ),
    });
    expect(wrapped.manifestWrap).toBe("mytour/");
    const manifest = await wrapped.loadTourManifest();
    expect(manifest?.objects[0]?.id).toBe(photo.id);
    // The reader asks with the name the MANIFEST carries; the session joins
    // the prefix it found the manifest under.
    await expect(
      wrapped
        .loadContentEntry("content/ab12ab12ab12ab12.jpg")
        .then((b) => b.text()),
    ).resolves.toBe("jpeg-bytes");
    await wrapped.close();

    // A flat zip is the same call with an empty prefix.
    const flat = await openTourSession("https://x/flat.zip", {
      fetchImpl: rangeServer(
        await buildExactZip({
          "tour.json": JSON.stringify({ version: 1, objects: [photo] }),
          "content/ab12ab12ab12ab12.jpg": "flat-bytes",
        }),
      ),
    });
    expect(flat.manifestWrap).toBe("");
    await expect(
      flat
        .loadContentEntry("content/ab12ab12ab12ab12.jpg")
        .then((b) => b.text()),
    ).resolves.toBe("flat-bytes");
    await flat.close();

    // No manifest at all: the prefix is empty, and the call still reads a
    // root-level entry (the creator writes there on the first finish).
    const none = await openTourSession("https://x/none.zip", {
      fetchImpl: rangeServer(
        await buildExactZip({ "content/x.jpg": "root-bytes" }),
      ),
    });
    expect(none.manifestWrap).toBe("");
    await expect(
      none.loadContentEntry("content/x.jpg").then((b) => b.text()),
    ).resolves.toBe("root-bytes");
    await none.close();
  });

  it("opens the STARTER zip the setup hands out and reads its empty manifest (the step-1 loop)", async () => {
    // Why this matters (M2 review #11): the wizard sells "download the
    // starter, host it, paste the link, Open" - nothing else proved the
    // packed starter is an archive this session can open.
    const starter = await packFilesAsZip([
      {
        path: "tour.json",
        data: serializeTourManifest(createEmptyTourManifest()),
      },
    ]);
    const session = await openTourSession("https://x/tour.zip", {
      fetchImpl: rangeServer(new Uint8Array(await starter.arrayBuffer())),
    });
    expect(session.entries.map((e) => e.filename)).toEqual(["tour.json"]);
    expect(session.hasRecording).toBe(false);
    await expect(session.loadTourManifest()).resolves.toEqual({
      version: 1,
      objects: [],
    });
    await expect(session.loadQrLevels()).resolves.toEqual(new Map());
    await session.close();
  });

  it("reads the whole archive from the warmed cache copy under the NORMALISED url, with no further network read", async () => {
    // A Dropbox share link: the archive's url is the rewritten content
    // host, and that is the cache key (plan review #5); the raw link would
    // miss. After the warm, the cache serves the bytes - the counter
    // proves no range read happened.
    const bytes = await buildZip();
    const cacheStore = new InMemoryLocalCacheStore();
    let reads = 0;
    const counting: FetchImpl = (input, init) => {
      if ((init?.method ?? "GET") === "GET") reads += 1;
      return rangeServer(bytes)(input, init);
    };
    const session = await openTourSession(
      "https://www.dropbox.com/s/abc/tour.zip?dl=0",
      { fetchImpl: counting, cacheStore },
    );
    expect(session.archive.url).not.toContain("www.dropbox.com/s/");
    await session.archive.warmed;
    expect(await cacheStore.get(session.archive.url)).toBeDefined();
    const before = reads;
    const whole = await session.readWholeArchive();
    expect(reads).toBe(before);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);
    await session.close();
  });

  it("falls back to range reads when the cached copy has the wrong size", async () => {
    const bytes = await buildZip();
    const cacheStore = new InMemoryLocalCacheStore();
    const session = await openTourSession("https://x/tour.zip", {
      fetchImpl: rangeServer(bytes),
      cacheStore,
    });
    await session.archive.warmed;
    await cacheStore.put(session.archive.url, {
      blob: new Blob([new Uint8Array(3)]),
    });
    const whole = await session.readWholeArchive();
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);
    await session.close();
  });

  it("reads the whole archive in SLICES when there is no cache (each request keeps the slice budget), byte-identical across slice boundaries", async () => {
    // The slicer over a fake source: 2 500 bytes in 1 000-byte slices is
    // three requests, and the gathered Blob is the source, byte for byte.
    const bytes = new Uint8Array(2500).map((_, i) => (i * 13) % 256);
    const requests: [number, number][] = [];
    const whole = await readArchiveInSlices(
      {
        size: bytes.length,
        source: {
          size: bytes.length,
          read: (offset, length) => {
            requests.push([offset, length]);
            return Promise.resolve(bytes.slice(offset, offset + length));
          },
        },
      },
      1000,
    );
    expect(requests).toEqual([
      [0, 1000],
      [1000, 1000],
      [2000, 500],
    ]);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);
    // The session's fallback goes through the same slicer.
    const session = await openTourSession("https://x/tour.zip", {
      fetchImpl: rangeServer(await buildZip()),
    });
    const viaSession = await session.readWholeArchive();
    expect(viaSession.size).toBe(session.archive.size);
    await session.close();
  });
});
