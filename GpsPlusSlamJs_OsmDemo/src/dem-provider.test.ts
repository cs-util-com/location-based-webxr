/**
 * The DEM composition: Mapterhorn primary, AWS Terrarium fallback, one shared
 * caching fetch in front of both.
 *
 * WHY THESE TESTS MATTER. The composition is pure wiring over library pieces
 * that carry their own tests (`fallbackProvider`, `TerrariumProvider`,
 * `createCachingTileFetch`), so what can break here is exactly the wiring:
 * which host is asked first, whether the fallback is consulted at all, and
 * whether both providers really share the one persistent cache. None of that
 * is observable in the worker (its construction needs `navigator.storage` and
 * `OffscreenCanvas`), so the factory is extracted and pinned here with fakes.
 *
 * No property-based spec, deliberately: every behaviour here is a composition
 * of already-property-tested library parts, and a property over the wiring
 * would re-test those parts through one fixed configuration.
 */

import { describe, expect, it } from "vitest";

import {
  MemoryBlobStore,
  decodeTerrarium,
  type DecodedImage,
  type LatLng,
} from "gps-plus-slam-osm";

import {
  DEM_ATTRIBUTION,
  DEM_SOURCE_ID,
  createDemProvider,
} from "./dem-provider.js";

const COLOGNE: LatLng = { lat: 50.9413, lng: 6.9583 };

/** One-byte body markers, so the fake decoder can tell the sources apart. */
const MAPTERHORN_BODY = 7;
const AWS_BODY = 9;

/** Heights the two fake sources encode, metres. Distinct on purpose. */
const MAPTERHORN_HEIGHT = decodeTerrarium(128, 10, 0);
const AWS_HEIGHT = decodeTerrarium(128, 42, 0);

/**
 * A decoder keyed off the body marker instead of a real image codec — the
 * same seam the library's own tests use, so no codec runs in Node.
 */
function fakeDecodePng(bytes: ArrayBuffer): Promise<DecodedImage> {
  const marker = new Uint8Array(bytes)[0];
  const g = marker === MAPTERHORN_BODY ? 10 : 42;
  // A 1×1 tile: TerrariumProvider is tile-size-invariant, so the smallest
  // square exercises the same sampling path as a real 256/512 px tile.
  return Promise.resolve({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([128, g, 0, 255]),
  });
}

/** A network that answers per host and records every URL it was asked for. */
function fakeNetwork(options: { mapterhornStatus?: number } = {}): {
  fetchImpl: typeof fetch;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    // The providers pass plain URL strings; the branches keep the fake honest
    // (and the linter quiet) should that ever change.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    urls.push(url);
    if (url.includes("mapterhorn")) {
      const status = options.mapterhornStatus ?? 200;
      return Promise.resolve(
        status === 200
          ? new Response(new Uint8Array([MAPTERHORN_BODY]), { status })
          : new Response(null, { status }),
      );
    }
    return Promise.resolve(
      new Response(new Uint8Array([AWS_BODY]), { status: 200 }),
    );
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("createDemProvider", () => {
  it("answers from Mapterhorn and never asks AWS while the primary has data", async () => {
    const { fetchImpl, urls } = fakeNetwork();
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl,
    });

    const [height] = await provider.elevationAt([COLOGNE]);

    expect(height).toBe(MAPTERHORN_HEIGHT);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.includes("tiles.mapterhorn.com"))).toBe(
      true,
    );
  });

  it("falls back to the AWS tiles where Mapterhorn has no tile", async () => {
    // A 404 is Mapterhorn's honest "no coverage here"; the fallback exists so
    // that answer degrades to the coarser global DEM instead of to a hole.
    const { fetchImpl, urls } = fakeNetwork({ mapterhornStatus: 404 });
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl,
    });

    const [height] = await provider.elevationAt([COLOGNE]);

    expect(height).toBe(AWS_HEIGHT);
    expect(urls.some((url) => url.includes("tiles.mapterhorn.com"))).toBe(true);
    expect(urls.some((url) => url.includes("s3.amazonaws.com"))).toBe(true);
  });

  it("serves a repeat query from the injected store, not the network", async () => {
    // THE OFFLINE COLD START. A second provider instance sharing the same
    // store models a reload: its in-memory tile cache is empty, so an answer
    // without any network fetch can only have come through the caching fetch's
    // persistence — which is the whole reason the store is injected.
    const store = new MemoryBlobStore();
    const first = fakeNetwork();
    await createDemProvider({
      store,
      decodePng: fakeDecodePng,
      fetchImpl: first.fetchImpl,
    }).elevationAt([COLOGNE]);
    expect(first.urls.length).toBeGreaterThan(0);

    const second = fakeNetwork();
    const [height] = await createDemProvider({
      store,
      decodePng: fakeDecodePng,
      fetchImpl: second.fetchImpl,
    }).elevationAt([COLOGNE]);

    expect(height).toBe(MAPTERHORN_HEIGHT);
    expect(second.urls).toHaveLength(0);
  });

  it("exposes serving stats so a session can tell which DEM actually served", async () => {
    // WHY THIS TEST MATTERS. The composed id names what was ASKED; the stats
    // are the only surface saying what ANSWERED. A session that silently fell
    // back to the ~30 m AWS tiles reads identically to a LiDAR-served one on
    // every other number, and the residuals differ by an order of magnitude.
    const primaryServed = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork().fetchImpl,
    });
    await primaryServed.elevationAt([COLOGNE]);
    expect(primaryServed.stats).toEqual({
      primaryAnswered: 1,
      fallbackAnswered: 0,
      unanswered: 0,
    });

    const fellBack = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork({ mapterhornStatus: 404 }).fetchImpl,
    });
    await fellBack.elevationAt([COLOGNE]);
    expect(fellBack.stats).toEqual({
      primaryAnswered: 0,
      fallbackAnswered: 1,
      unanswered: 0,
    });
  });

  it("identifies the composition for the HUD, and credits BOTH sources", () => {
    const provider = createDemProvider({
      store: new MemoryBlobStore(),
      decodePng: fakeDecodePng,
      fetchImpl: fakeNetwork().fetchImpl,
    });

    // The id the AR readout renders next to the terrain height — composed,
    // because per-sample source attribution is not observable through the
    // `ElevationProvider` seam (see the sidecar's follow-up note).
    expect(provider.sourceId).toBe(DEM_SOURCE_ID);
    expect(DEM_SOURCE_ID).toBe("mapterhorn+terrarium");

    // Attribution is an obligation to BOTH upstreams the moment the fallback
    // can serve a tile, so the displayed constant must name each of them.
    expect(DEM_ATTRIBUTION).toContain("Mapterhorn");
    expect(DEM_ATTRIBUTION).toContain("Mapzen");
  });
});
