import { zipSync } from "fflate";
import { InMemoryLocalCacheStore } from "gps-plus-slam-app-framework/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sampleTour } from "../../../store/fixtures/sample-tour.js";
import { TourLoadError } from "../core/errors.js";
import { startFixtureServer, type FixtureServer } from "./fixture-server.js";
import { openRemoteTour } from "./open-remote-tour.js";

/**
 * Why these tests matter: this drives the *real* orchestrator — probe, zip.js
 * central-directory parse, tour.json validation, the asset provider, the warm +
 * switch — against a real HTTP server that speaks real 206/Content-Range and can
 * be toggled to refuse ranges, 404, 416, corrupt bytes or drop the connection
 * (C9/C10). It is the deterministic proof that a plain shared link becomes a
 * running tour, that a range-refusing host still works via fallback, and that a
 * broken link fails cleanly instead of crashing. `caches` is browser-only, so an
 * in-memory cache store is injected (C20); real Cache API + browser CORS are
 * demo-proven (Option B, C19).
 */

const GATE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const INTRO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 9, 8, 7, 6, 5, 4]);

const assetFiles = new Map<string, File>([
  ["asset-gate", new File([GATE_BYTES], "asset-gate.png")],
  ["asset-intro", new File([INTRO_BYTES], "asset-intro.mp3")],
]);

/**
 * A valid tour (passes validateTour: asset-gate is registered + referenced) whose
 * gate filename points at a file the zip does NOT contain — the contract
 * invariant-3 check must catch this at load (C11), not hand a broken tour to the
 * scene.
 */
function craftMissingAssetZip(): Uint8Array {
  const badTour = {
    ...sampleTour,
    assets: [
      { id: "asset-gate", type: "sprite", filename: "assets/ghost.png" },
      { id: "asset-intro", type: "audio", filename: "assets/asset-intro.mp3" },
    ],
  };
  return zipSync(
    {
      "tour.json": new TextEncoder().encode(JSON.stringify(badTour)),
      "assets/asset-intro.mp3": INTRO_BYTES, // note: ghost.png intentionally absent
    },
    { level: 0 },
  );
}

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer(
    sampleTour,
    assetFiles,
    new Map([["bad-assets", craftMissingAssetZip()]]),
  );
});

afterAll(async () => {
  await server.close();
});

/** A fresh set of open options with an isolated cache + blob-capturing minter. */
function openOptions() {
  const blobs = new Map<string, Blob>();
  let n = 0;
  return {
    blobs,
    opts: {
      fetchImpl: fetch,
      localCacheStore: new InMemoryLocalCacheStore(),
      createObjectUrl: (b: Blob) => {
        const url = `blob:fake/${++n}`;
        blobs.set(url, b);
        return url;
      },
      revokeObjectUrl: () => undefined,
    },
  };
}

const bytesOf = (blobs: Map<string, Blob>, url: string) =>
  blobs
    .get(url)!
    .arrayBuffer()
    .then((b) => new Uint8Array(b));

describe("openRemoteTour — range-capable host", () => {
  it("loads the tour and reads an asset by range from a 206", async () => {
    const { blobs, opts } = openOptions();

    const { tour, assetProvider, cacheWarming } = await openRemoteTour(
      `${server.origin}/ranges-ok/tour.zip`,
      opts,
    );

    // POIs are available immediately — before the whole archive downloads.
    expect(tour.id).toBe(sampleTour.id);
    expect(tour.waypoints.map((w) => w.id)).toEqual(["wp-1", "wp-2", "wp-3"]);

    // An individual asset comes back by range (a 206 in the browser network panel).
    const url = await assetProvider.getAssetUrl("asset-gate");
    expect(await bytesOf(blobs, url)).toEqual(GATE_BYTES);

    await cacheWarming; // let the background warm settle before teardown
  });

  it("switches to the local copy after warming — later reads hit no network", async () => {
    const { blobs, opts } = openOptions();
    const path = "/ranges-ok/tour.zip";

    const { assetProvider, cacheWarming } = await openRemoteTour(
      `${server.origin}${path}`,
      opts,
    );
    await cacheWarming; // background full-download + switch complete

    const before = server.requestCount(path);
    const url = await assetProvider.getAssetUrl("asset-intro");
    const after = server.requestCount(path);

    expect(after).toBe(before); // served from the local cache, not the server
    expect(await bytesOf(blobs, url)).toEqual(INTRO_BYTES);
  });
});

describe("openRemoteTour — range-refusing host (fallback)", () => {
  it("still loads a tour and its assets when the host ignores Range (200)", async () => {
    const { blobs, opts } = openOptions();

    const { tour, assetProvider, cacheWarming } = await openRemoteTour(
      `${server.origin}/no-ranges/tour.zip`,
      opts,
    );
    await cacheWarming;

    expect(tour.id).toBe(sampleTour.id);
    const url = await assetProvider.getAssetUrl("asset-gate");
    expect(await bytesOf(blobs, url)).toEqual(GATE_BYTES);
  });
});

describe("openRemoteTour — size from Content-Range (proxy path)", () => {
  it("loads when HEAD gives no Content-Length, sizing from the 206 Content-Range", async () => {
    const { blobs, opts } = openOptions();

    const { tour, assetProvider, cacheWarming } = await openRemoteTour(
      `${server.origin}/no-head-len/tour.zip`,
      opts,
    );
    await cacheWarming;

    expect(tour.id).toBe(sampleTour.id);
    const url = await assetProvider.getAssetUrl("asset-gate");
    expect(await bytesOf(blobs, url)).toEqual(GATE_BYTES);
  });
});

describe("openRemoteTour — no readable size anywhere (full-download degrade)", () => {
  it("loads via one plain download when neither HEAD nor Content-Range give a size", async () => {
    const { blobs, opts } = openOptions();

    const { tour, assetProvider, cacheWarming } = await openRemoteTour(
      `${server.origin}/no-size/tour.zip`,
      opts,
    );
    await cacheWarming;

    expect(tour.id).toBe(sampleTour.id);
    const url = await assetProvider.getAssetUrl("asset-gate");
    expect(await bytesOf(blobs, url)).toEqual(GATE_BYTES);
  });
});

describe("openRemoteTour — unusable links fail cleanly", () => {
  const cases: Array<[string, TourLoadError["loadCause"]]> = [
    ["/missing/tour.zip", "missing"],
    ["/empty/tour.zip", "corrupt"],
    ["/corrupt/tour.zip", "corrupt"],
    ["/no-cors/tour.zip", "cors"],
    ["/bad-assets/tour.zip", "asset-missing-in-zip"],
  ];

  for (const [path, cause] of cases) {
    it(`rejects ${path} as TourLoadError(${cause}) without crashing`, async () => {
      const { opts } = openOptions();
      const err = await openRemoteTour(`${server.origin}${path}`, opts).then(
        () => null,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(TourLoadError);
      expect((err as TourLoadError).loadCause).toBe(cause);
    });
  }
});

describe("openRemoteTour — reload reuses a completed cache", () => {
  it("opens a second time with no network once the copy is cached", async () => {
    const store = new InMemoryLocalCacheStore();
    const url = `${server.origin}/ranges-ok/tour.zip`;
    const base = {
      fetchImpl: fetch,
      localCacheStore: store,
      createObjectUrl: (_: Blob) => "blob:x",
      revokeObjectUrl: () => undefined,
    };

    const first = await openRemoteTour(url, base);
    await first.cacheWarming; // populates the shared store

    const before = server.requestCount();
    const second = await openRemoteTour(url, base);
    const after = server.requestCount();

    expect(second.tour.id).toBe(sampleTour.id);
    expect(after).toBe(before); // reload served entirely from cache
  });

  it("evicts a poisoned cached copy and recovers from the network", async () => {
    const store = new InMemoryLocalCacheStore();
    const url = `${server.origin}/ranges-ok/tour.zip`;
    const base = {
      fetchImpl: fetch,
      localCacheStore: store,
      createObjectUrl: (_: Blob) => "blob:x",
      revokeObjectUrl: () => undefined,
    };

    // Simulate a truncated/corrupt warm from an earlier broken run: a stored
    // "complete" copy that no longer parses as a zip. Without eviction the cache
    // short-circuits before the network and bricks this URL forever.
    await store.put(url, { blob: new Blob([new Uint8Array([1, 2, 3, 4])]) });

    const before = server.requestCount();
    const opened = await openRemoteTour(url, base);
    const after = server.requestCount();

    expect(opened.tour.id).toBe(sampleTour.id); // recovered from the server
    expect(after).toBeGreaterThan(before); // it went back to the network
    await opened.cacheWarming;

    // The poison is gone: the re-warmed copy now parses on a clean reload.
    const reload = await openRemoteTour(url, base);
    expect(reload.tour.id).toBe(sampleTour.id);
  });
});
