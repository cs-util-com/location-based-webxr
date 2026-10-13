import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import type {
  OsmDataSource,
  OsmTileResult,
  OsmTileTimings,
} from "../source/osm-data-source.js";
import { RateLimitedError } from "../source/overpass-source.js";
import { MemoryBlobStore } from "../source/memory-blob-store.js";
import { CachingSource } from "../source/caching-source.js";
import {
  PROGRESSIVE_RADII,
  SCORE_CHUNK_RES,
  fetchTilesForScoreWorkingSet,
} from "../spatial/resolutions.js";
import { createTerrainField } from "../elevation/terrain-field.js";
import { TERRAIN_EXTENT_M } from "../elevation/heightfield.js";
import {
  MAPTERHORN_URL_TEMPLATE,
  TERRARIUM_URL_TEMPLATE,
  TerrariumProvider,
  toTilePixel,
  type DecodedImage,
} from "../elevation/terrarium.js";
import { latLngToCell } from "h3-js";
import {
  cityDataPlan,
  createCityTileSource,
  loadCityData,
  type CityData,
  type CityDataPlan,
  type CityHeights,
} from "./city-data.js";

/**
 * Why these tests matter: the globe's city and its warm-up used to ask for
 * different data (round-4 plan 2026-10-11-0122 §5; validation finding F6:
 * the warm-up fetched z13 heights from two sources, the city read z12 from
 * one, so the city's heights were never warm). `cityDataPlan` is now the one
 * answer to "which tiles and which heights", and `loadCityData` loads exactly
 * that, so these tests compare the plan with what the library's REAL
 * machinery requests (a real terrain field, the real working-set
 * derivation), never with a second copy of the arithmetic.
 */

/** The globe's heights: the relief's own source and zoom (R13). */
const RELIEF: CityHeights = {
  urlTemplates: [TERRARIUM_URL_TEMPLATE],
  zoom: 12,
};
const LUCERNE: LatLng = { lat: 47.0502, lng: 8.3093 };

/** The URLs a fresh terrain field sends for the plan's window. */
async function heightUrlsAFieldFetches(plan: CityDataPlan): Promise<string[]> {
  const urls: string[] = [];
  for (const urlTemplate of plan.heights.urlTemplates) {
    const field = createTerrainField({
      provider: new TerrariumProvider({
        decodePng: () => Promise.reject(new Error("never decoded")),
        fetchImpl: (input: RequestInfo | URL) => {
          urls.push(String(input instanceof Request ? input.url : input));
          return Promise.resolve(new Response(null, { status: 404 }));
        },
        urlTemplate,
        zoom: plan.heights.zoom,
      }),
      zoom: plan.heights.zoom,
    });
    await field.ensureAround(plan.window.fetchCentre, plan.window.fetchRadiusM);
  }
  return urls;
}

describe("cityDataPlan", () => {
  it("lists every ring's working-set tiles once, inner ring first, each ring only what it adds", () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    const chunk = latLngToCell(LUCERNE.lat, LUCERNE.lng, SCORE_CHUNK_RES);
    expect(plan.rings.map((r) => r.radius)).toEqual([...PROGRESSIVE_RADII]);
    const seen = new Set<string>();
    for (const ring of plan.rings) {
      const wanted = new Set(fetchTilesForScoreWorkingSet(chunk, ring.radius));
      for (const tile of ring.tiles) {
        expect(seen.has(tile)).toBe(false);
        seen.add(tile);
      }
      // Up to this ring, the plan holds exactly the ring's working set.
      expect(new Set([...seen].filter((t) => wanted.has(t)))).toEqual(wanted);
    }
    expect(plan.overpassTiles).toEqual(plan.rings.flatMap((r) => r.tiles));
  });

  it("plans exactly the height tiles a terrain field fetches for the city's window (the relief's source and zoom)", async () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    const fetched = await heightUrlsAFieldFetches(plan);
    expect(new Set(plan.heightUrls)).toEqual(new Set(fetched));
    expect(plan.heightUrls.length).toBe(new Set(fetched).size);
    expect(plan.heightUrls.every((u) => u.includes("/terrarium/12/"))).toBe(
      true,
    );
  });

  it("plans both arms of a race when given two sources", async () => {
    const plan = cityDataPlan(LUCERNE, {
      heights: {
        urlTemplates: [MAPTERHORN_URL_TEMPLATE, TERRARIUM_URL_TEMPLATE],
        zoom: 13,
      },
    });
    const fetched = await heightUrlsAFieldFetches(plan);
    expect(new Set(plan.heightUrls)).toEqual(new Set(fetched));
    expect(plan.heightUrls.some((u) => u.includes("mapterhorn"))).toBe(true);
    expect(plan.heightUrls.some((u) => u.includes("amazonaws"))).toBe(true);
  });

  it("agrees with a terrain field's requests at random places", async () => {
    // Few runs: each samples a fresh 5 km window (tens of thousands of
    // lattice posts at z12).
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -70, max: 70, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        fc.constantFrom(11, 12, 13),
        async (lat, lng, zoom) => {
          const plan = cityDataPlan(
            { lat, lng },
            { heights: { urlTemplates: [TERRARIUM_URL_TEMPLATE], zoom } },
          );
          const fetched = await heightUrlsAFieldFetches(plan);
          expect(new Set(plan.heightUrls)).toEqual(new Set(fetched));
        },
      ),
      { numRuns: 6 },
    );
  }, 60_000);

  it("partitions the working set into rings at random places", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -75, max: 75, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        (lat, lng) => {
          const plan = cityDataPlan({ lat, lng }, { heights: RELIEF });
          const chunk = latLngToCell(lat, lng, SCORE_CHUNK_RES);
          const widest = PROGRESSIVE_RADII.at(-1) ?? 0;
          expect(new Set(plan.overpassTiles)).toEqual(
            new Set(fetchTilesForScoreWorkingSet(chunk, widest)),
          );
          expect(new Set(plan.overpassTiles).size).toBe(
            plan.overpassTiles.length,
          );
          expect(plan.rings[0]?.tiles.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("takes its own rings, still each tile once", () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF, radii: [6] });
    expect(plan.rings).toHaveLength(1);
    expect(plan.rings[0]?.radius).toBe(6);
  });

  it.each<[string, LatLng, CityHeights, (readonly number[])?]>([
    ["a latitude that is not finite", { lat: Number.NaN, lng: 0 }, RELIEF],
    ["a latitude beyond the pole", { lat: 91, lng: 0 }, RELIEF],
    ["a longitude beyond 180", { lat: 0, lng: -181 }, RELIEF],
    [
      "a fractional zoom",
      LUCERNE,
      { urlTemplates: [TERRARIUM_URL_TEMPLATE], zoom: 12.5 },
    ],
    [
      "a zoom beyond the tiles",
      LUCERNE,
      { urlTemplates: [TERRARIUM_URL_TEMPLATE], zoom: 16 },
    ],
    ["no height source", LUCERNE, { urlTemplates: [], zoom: 12 }],
    [
      "a template without {x}",
      LUCERNE,
      { urlTemplates: ["https://h/{z}/{y}.png"], zoom: 12 },
    ],
    ["no rings", LUCERNE, RELIEF, []],
    ["rings out of order", LUCERNE, RELIEF, [3, 2]],
    ["a ring that is not a whole number", LUCERNE, RELIEF, [1.5]],
  ])("refuses %s with a RangeError", (_why, target, heights, radii) => {
    expect(() =>
      cityDataPlan(target, {
        heights,
        ...(radii === undefined ? {} : { radii }),
      }),
    ).toThrow(RangeError);
  });
});

// --- loadCityData -----------------------------------------------------------

/** A fake Overpass behind a cache: each tile one building at the target. */
function building(tile: string, id: number): OsmFeature {
  const d = 0.0001;
  const lat = LUCERNE.lat + id * 0.0003;
  const lng = LUCERNE.lng;
  return {
    type: "way",
    id,
    tags: { building: "yes", note: tile },
    geometry: [
      { lat, lng },
      { lat, lng: lng + d },
      { lat: lat + d, lng: lng + d },
      { lat: lat + d, lng },
      { lat, lng },
    ],
  };
}

interface FakeSource extends OsmDataSource {
  readonly asked: string[];
}

/**
 * A source that answers each tile with one building; `cached` tiles report
 * a cache hit, `failing` ones fail (`rateLimited`: as a rate limit) until
 * their count of attempts is used up.
 */
function fakeSource(
  options: {
    cached?: readonly string[];
    failing?: Readonly<Record<string, number>>;
    rateLimited?: boolean;
    hang?: boolean;
    /** Only these tiles never answer (until an abort). */
    hangTiles?: readonly string[];
  } = {},
): FakeSource {
  const asked: string[] = [];
  const failuresLeft = new Map(Object.entries(options.failing ?? {}));
  const ids = new Map<string, number>();
  const hangs = (tile: string): boolean =>
    options.hang === true || (options.hangTiles?.includes(tile) ?? false);
  return {
    attribution: "test",
    sourceId: "fixture:city-data",
    asked,
    fetchTile: (tile, opts) => {
      asked.push(tile);
      if (hangs(tile)) {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      const left = failuresLeft.get(tile) ?? 0;
      if (left > 0) {
        failuresLeft.set(tile, left - 1);
        return Promise.reject(
          options.rateLimited
            ? new RateLimitedError("busy", 1_000)
            : new Error("HTTP 504"),
        );
      }
      if (!ids.has(tile)) ids.set(tile, ids.size + 1);
      const timings: OsmTileTimings = {
        servedBy: options.cached?.includes(tile) ? "cache" : "network",
        slotWaitMs: 0,
        transportMs: 1,
        decodeMs: 0,
        parseMs: 0,
        storeMs: 0,
        attempts: 1,
      };
      const result: OsmTileResult = {
        tile,
        features: [building(tile, ids.get(tile) ?? 0)],
        fetchedAt: 0,
        sourceId: "fixture:city-data",
        schemaVersion: 1,
        skipped: [],
        timings,
      };
      return Promise.resolve(result);
    },
  };
}

/** A flat 256 px tile at `heightM` (Terrarium: 32768 + h). */
function flatTile(heightM: number): DecodedImage {
  const v = heightM + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = 0;
    data[i + 3] = 255;
  }
  return { width: 256, height: 256, data };
}

/**
 * Height tiles at 435 m. `failing` URLs answer 503 until their count is used
 * up; `hanging` ones never answer (until their signal aborts); `cachedAll`
 * marks every answer as a cache hit.
 */
function fakeHeights(
  options: {
    failing?: number;
    /** A URL that never answers, once. */
    hangOnce?: string;
    cachedAll?: boolean;
  } = {},
): { fetch: typeof fetch; asked: string[] } {
  const asked: string[] = [];
  let failuresLeft = options.failing ?? 0;
  let hangOnce = options.hangOnce;
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    asked.push(url);
    if (url === hangOnce) {
      hangOnce = undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(
            init.signal?.reason instanceof Error
              ? init.signal.reason
              : new Error("aborted"),
          ),
        );
      });
    }
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return Promise.resolve(new Response(null, { status: 503 }));
    }
    return Promise.resolve(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: options.cachedAll ? { "x-tile-cache": "hit" } : {},
      }),
    );
  };
  return { fetch: fetchImpl, asked };
}

const decodeFlat = () => Promise.resolve(flatTile(435));

/** Runs a load to its end and returns what it delivered. */
async function run(
  plan: CityDataPlan,
  options: Partial<Parameters<typeof loadCityData>[1]> & {
    source: OsmDataSource;
    heightFetch: typeof fetch;
  },
) {
  const delivered: CityData[] = [];
  const load = loadCityData(plan, {
    decodePng: decodeFlat,
    onData: (data) => delivered.push(data),
    sleep: () => Promise.resolve(),
    ...options,
  });
  const report = await load.finished;
  return { delivered, report, load };
}

/** A plan with more than one Overpass tile (a place near a tile corner). */
function multiTilePlan(): CityDataPlan {
  // Searched once: the first of these grid points whose working set spans
  // two tiles or more. The search itself is the library's derivation.
  for (let i = 0; i < 400; i++) {
    const target = {
      lat: 47 + (i % 20) * 0.003,
      lng: 8.3 + Math.floor(i / 20) * 0.003,
    };
    const plan = cityDataPlan(target, { heights: RELIEF });
    if (plan.rings.slice(1).some((r) => r.tiles.length > 0)) return plan;
  }
  throw new Error("no multi-tile place in the search grid");
}

describe("loadCityData", () => {
  it("asks for exactly the plan's tiles and heights, and builds on the plan's heights", async () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    const source = fakeSource();
    const heights = fakeHeights();
    const { delivered, report } = await run(plan, {
      source,
      heightFetch: heights.fetch,
    });
    expect(new Set(source.asked)).toEqual(new Set(plan.overpassTiles));
    expect(new Set(heights.asked)).toEqual(new Set(plan.heightUrls));
    expect(report.outcome).toBe("settled");
    const last = delivered.at(-1);
    expect(last?.stage).toBe("full");
    expect(last?.groundM).toBeCloseTo(435, 3);
    expect(last?.features.length).toBe(plan.overpassTiles.length);
    expect(last?.ground.groundHeightM?.(LUCERNE)).toBeCloseTo(435, 3);
  });

  it("delivers the city after the first ring, then again with the rest (as OsmDemo draws its first ring first)", async () => {
    const plan = multiTilePlan();
    const firstTiles = plan.rings[0]?.tiles ?? [];
    const { delivered } = await run(plan, {
      source: fakeSource(),
      heightFetch: fakeHeights().fetch,
    });
    expect(delivered.map((d) => d.stage)).toEqual(["first", "full"]);
    expect(delivered[0]?.features.length).toBe(firstTiles.length);
    expect(delivered[1]?.features.length).toBe(plan.overpassTiles.length);
  });

  it("delivers once when the first rings asked for are every ring", async () => {
    const plan = multiTilePlan();
    const { delivered } = await run(plan, {
      source: fakeSource(),
      heightFetch: fakeHeights().fetch,
      firstRings: plan.rings.length,
    });
    expect(delivered.map((d) => d.stage)).toEqual(["full"]);
  });

  it("counts warm, fetched and failed jobs, and its progress reaches 1 when every job was tried once", async () => {
    const plan = multiTilePlan();
    const [warm, ...rest] = plan.overpassTiles;
    const failing = rest.at(-1);
    const progress: number[] = [];
    const { load, report } = await run(plan, {
      source: fakeSource({
        cached: warm === undefined ? [] : [warm],
        failing: failing === undefined ? {} : { [failing]: 99 },
      }),
      heightFetch: fakeHeights({ cachedAll: true }).fetch,
      retryDelaysMs: [],
      onProgress: (_counts, p) => progress.push(p),
    });
    expect(report.counts.overpass).toEqual({
      total: plan.overpassTiles.length,
      warm: 1,
      fetched: plan.overpassTiles.length - 2,
      failed: 1,
    });
    expect(report.counts.dem).toEqual({
      total: plan.heightUrls.length,
      warm: plan.heightUrls.length,
      fetched: 0,
      failed: 0,
    });
    expect(report.missingTiles).toEqual([failing]);
    expect(load.progress()).toBe(1);
    // Never backwards, and 1 only at the end.
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1] ?? 0);
    }
    expect(progress.slice(0, -1).every((p) => p < 1)).toBe(true);
  });

  // WHY (the owner, 2026-10-13, DEC-AW-1; GpsPlusSlamJs_Docs/docs/
  // 2026-10-13-1341-arrival-13-of-14-tiles-findings.md): the globe's flight
  // paced on every tile, and on a cold arrival at Lucerne the public
  // Overpass servers refused for 209 s, so the outer ring held the landing.
  // The landing needs the first delivery only: the heights and the first
  // rings' tiles. landingProgress reaches 1 with those in while an outer
  // tile still loads; progress (every job) does not.
  it("its landing progress reaches 1 with the first rings in, while an outer tile still loads", async () => {
    const plan = multiTilePlan();
    const outer = plan.rings.slice(1).flatMap((r) => r.tiles);
    expect(outer.length).toBeGreaterThan(0);
    const landing: number[] = [];
    const load = loadCityData(plan, {
      source: fakeSource({ hangTiles: outer }),
      heightFetch: fakeHeights().fetch,
      decodePng: decodeFlat,
      onData: () => undefined,
      onProgress: (_counts, _progress, landingProgress) =>
        landing.push(landingProgress),
      sleep: () => Promise.resolve(),
    });
    for (let i = 0; i < 200 && load.landingProgress() < 1; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    expect(load.landingProgress()).toBe(1);
    expect(load.progress()).toBeLessThan(1);
    expect(load.done).toBe(false);
    expect(landing.at(-1)).toBe(1);
    for (let i = 1; i < landing.length; i++) {
      expect(landing[i]).toBeGreaterThanOrEqual(landing[i - 1] ?? 0);
    }
    load.abort();
  });

  it("its landing progress is the progress when the first rings are every ring", async () => {
    const plan = multiTilePlan();
    const { load } = await run(plan, {
      source: fakeSource(),
      heightFetch: fakeHeights().fetch,
      firstRings: plan.rings.length,
    });
    expect(load.landingProgress()).toBe(1);
    expect(load.progress()).toBe(1);
  });

  it("asks again for a tile that failed, and delivers the city again with it", async () => {
    const plan = multiTilePlan();
    const flaky = plan.overpassTiles.at(-1) ?? "";
    const slept: number[] = [];
    const source = fakeSource({ failing: { [flaky]: 1 } });
    const { delivered, report } = await run(plan, {
      source,
      heightFetch: fakeHeights().fetch,
      retryDelaysMs: [5_000, 20_000],
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    expect(slept).toEqual([5_000]);
    expect(source.asked.filter((t) => t === flaky)).toHaveLength(2);
    expect(delivered.at(-1)?.stage).toBe("retry");
    expect(delivered.at(-1)?.features.length).toBe(plan.overpassTiles.length);
    expect(report.missingTiles).toEqual([]);
    expect(report.counts.overpass.failed).toBe(0);
  });

  // WHY: a flight paces on the first pass (every job tried once); a retry
  // 10-60 s later must not hold the camera (the old arrival prefetch had no
  // retries, and the flight never waited for them).
  it("resolves its first pass before any retry, settled with the failure counted", async () => {
    const plan = multiTilePlan();
    const flaky = plan.overpassTiles.at(-1) ?? "";
    let releaseSleep = () => {};
    const load = loadCityData(plan, {
      source: fakeSource({ failing: { [flaky]: 1 } }),
      heightFetch: fakeHeights().fetch,
      decodePng: decodeFlat,
      onData: () => {},
      retryDelaysMs: [5_000],
      sleep: () =>
        new Promise<void>((resolve) => {
          releaseSleep = resolve;
        }),
    });
    const pass = await load.firstPass;
    expect(pass.outcome).toBe("settled");
    expect(pass.counts.overpass.failed).toBe(1);
    expect(pass.missingTiles).toEqual([flaky]);
    expect(load.done).toBe(false);
    releaseSleep();
    const end = await load.finished;
    expect(end.missingTiles).toEqual([]);
  });

  it("treats a rate-limited tile as deferred and asks for it again", async () => {
    const plan = multiTilePlan();
    const deferred = plan.overpassTiles.at(-1) ?? "";
    const source = fakeSource({
      failing: { [deferred]: 1 },
      rateLimited: true,
    });
    const { report } = await run(plan, {
      source,
      heightFetch: fakeHeights().fetch,
      retryDelaysMs: [1_000],
    });
    expect(source.asked.filter((t) => t === deferred)).toHaveLength(2);
    expect(report.missingTiles).toEqual([]);
  });

  it("gives up after its last retry and says which tiles are missing", async () => {
    const plan = multiTilePlan();
    const dead = plan.overpassTiles.at(-1) ?? "";
    const source = fakeSource({ failing: { [dead]: 99 } });
    const { report, delivered } = await run(plan, {
      source,
      heightFetch: fakeHeights().fetch,
      retryDelaysMs: [1, 2, 3],
    });
    expect(source.asked.filter((t) => t === dead)).toHaveLength(4);
    expect(report.missingTiles).toEqual([dead]);
    expect(delivered.at(-1)?.features.length).toBe(
      plan.overpassTiles.length - 1,
    );
  });

  it("builds nothing while a height is missing, then delivers once a retry fills it", async () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    // Every height tile fails once: the first pass has no heights at all.
    const heights = fakeHeights({ failing: plan.heightUrls.length });
    const { delivered, report } = await run(plan, {
      source: fakeSource(),
      heightFetch: heights.fetch,
      retryDelaysMs: [1_000],
    });
    expect(delivered.map((d) => d.stage)).toEqual(["retry"]);
    expect(report.missingHeights).toBe(0);
    expect(report.counts.dem.failed).toBe(0);
    expect(report.counts.dem.fetched).toBe(plan.heightUrls.length);
  });

  it("never delivers a city on invented heights when the heights stay missing", async () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    const { delivered, report } = await run(plan, {
      source: fakeSource(),
      heightFetch: fakeHeights({ failing: 10_000 }).fetch,
      retryDelaysMs: [1],
    });
    expect(delivered).toEqual([]);
    expect(report.missingHeights).toBeGreaterThan(0);
    expect(report.counts.dem.failed).toBe(plan.heightUrls.length);
  });

  // WHY: when some height tiles of a batch answer, the field fills the
  // others' posts with their mean and counts them as held. A guard reading
  // only `missing` (the globe worker's, until 2026-10-11) let one failed
  // tile stand its part of the city on an invented height.
  it("counts a failed tile's mean-filled posts as missing, so no city stands on them", async () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    const under = toTilePixel(LUCERNE, 12);
    const dead = TERRARIUM_URL_TEMPLATE.replace("{z}", "12")
      .replace("{x}", String(under.x))
      .replace("{y}", String(under.y));
    const ok = fakeHeights().fetch;
    const heightFetch = (input: RequestInfo | URL, init?: RequestInit) =>
      (input instanceof Request
        ? input.url
        : typeof input === "string"
          ? input
          : input.href) === dead
        ? Promise.resolve(new Response(null, { status: 503 }))
        : ok(input, init);
    const { delivered, report } = await run(plan, {
      source: fakeSource(),
      heightFetch,
      retryDelaysMs: [],
    });
    expect(plan.heightUrls.length).toBeGreaterThan(1);
    expect(delivered).toEqual([]);
    expect(report.missingHeights).toBeGreaterThan(0);
    expect(report.counts.dem.failed).toBe(1);
  });

  it("gives a height tile that never answers up at its deadline, then fills it on a retry", async () => {
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    // The tile under the target: its posts are sampled, so the city waits.
    const under = toTilePixel(LUCERNE, 12);
    const heights = fakeHeights({
      hangOnce: TERRARIUM_URL_TEMPLATE.replace("{z}", "12")
        .replace("{x}", String(under.x))
        .replace("{y}", String(under.y)),
    });
    const { delivered, report } = await run(plan, {
      source: fakeSource(),
      heightFetch: heights.fetch,
      heightDeadlineMs: 50,
      retryDelaysMs: [1],
    });
    expect(delivered.at(-1)?.stage).toBe("retry");
    expect(report.missingHeights).toBe(0);
  });

  it("loads the tiles and the heights side by side", async () => {
    // A source that hangs: the heights must still have been asked for.
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    const heights = fakeHeights();
    const controller = new AbortController();
    const load = loadCityData(plan, {
      source: fakeSource({ hang: true }),
      heightFetch: heights.fetch,
      decodePng: decodeFlat,
      onData: () => {},
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(new Set(heights.asked)).toEqual(new Set(plan.heightUrls));
    controller.abort();
    const report = await load.finished;
    expect(report.outcome).toBe("aborted");
  });

  it("stops at an abort, freezes its progress and delivers nothing more", async () => {
    const plan = multiTilePlan();
    const delivered: CityData[] = [];
    const load = loadCityData(plan, {
      source: fakeSource({ hang: true }),
      heightFetch: fakeHeights().fetch,
      decodePng: decodeFlat,
      onData: (d) => delivered.push(d),
    });
    load.abort();
    const report = await load.finished;
    expect(report.outcome).toBe("aborted");
    expect(load.done).toBe(true);
    expect(delivered).toEqual([]);
    expect(load.progress()).toBeLessThan(1);
  });

  it("refuses a plan of two height sources (a loader reads one) and a first-rings count below 1", () => {
    const two = cityDataPlan(LUCERNE, {
      heights: {
        urlTemplates: [MAPTERHORN_URL_TEMPLATE, TERRARIUM_URL_TEMPLATE],
        zoom: 13,
      },
    });
    const base = {
      source: fakeSource(),
      heightFetch: fakeHeights().fetch,
      decodePng: decodeFlat,
      onData: () => {},
    };
    expect(() => loadCityData(two, base)).toThrow(RangeError);
    const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
    expect(() => loadCityData(plan, { ...base, firstRings: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("createCityTileSource", () => {
  it("is the cached Overpass source, identifying itself as asked", async () => {
    const store = new MemoryBlobStore();
    const agents: (string | null)[] = [];
    const source = createCityTileSource(store, {
      userAgent: "test-app (example.org)",
      fetchImpl: (_input: RequestInfo | URL, init?: RequestInit) => {
        agents.push(new Headers(init?.headers).get("User-Agent"));
        return Promise.resolve(
          new Response(JSON.stringify({ version: 0.6, elements: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    });
    expect(source).toBeInstanceOf(CachingSource);
    const tile =
      cityDataPlan(LUCERNE, { heights: RELIEF }).overpassTiles[0] ?? "";
    await source.fetchTile(tile);
    expect(agents[0]).toBe("test-app (example.org)");
    expect((await store.keys()).length).toBeGreaterThan(0);
    // A second read is the cache's.
    const again = await source.fetchTile(tile);
    expect(again.timings?.servedBy).toBe("cache");
  });
});

// Keep the extent import honest: the plan's window is the library's.
it("plans the window the library's terrain extent describes", () => {
  const plan = cityDataPlan(LUCERNE, { heights: RELIEF });
  expect(plan.window.fetchRadiusM).toBeGreaterThan(TERRAIN_EXTENT_M);
  expect(plan.target).toEqual(LUCERNE);
});
