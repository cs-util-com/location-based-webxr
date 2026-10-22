/**
 * Why these tests matter: the Osm library's `cityDataPlan` (round-4 plan
 * 2026-10-11-0122 §5) is the ONE answer to "which tiles and which heights
 * does a city at this place need", which the globe's city loads. It is worth
 * exactly as much as it matches what OsmDemo itself loads there, or the two
 * apps drift apart again (the owner's "why can our demo run different logic
 * than the OSM demo?"). So the library's plan is compared with OsmDemo's
 * REAL machinery, not with a second copy of its arithmetic:
 * - the Overpass tiles with a real `DemoPipeline` run through every ring of
 *   `PROGRESSIVE_RADII`, as the refresh cycle runs it;
 * - the DEM URLs with the real `createDemProvider` + `createTerrainField`,
 *   asked for the terrain window `main.ts` asks for at arrival, recording
 *   every URL it sends to the network.
 * (Until 2026-10-11 this compared OsmDemo's own `arrival-plan.ts`, the plan
 * of the globe's former arrival prefetch; both moved into the library.)
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERRARIUM_ZOOM,
  MemoryBlobStore,
  PROGRESSIVE_RADII,
  cityDataPlan,
  parseRuleTable,
  type LatLng,
  type OsmDataSource,
} from "gps-plus-slam-osm";

import { DemoPipeline } from "./demo-pipeline.js";
import { DEM_URL_TEMPLATES, createDemProvider } from "./dem-provider.js";
import { TERRAIN_EXTENT_M } from "gps-plus-slam-osm";
import { createTerrainField } from "gps-plus-slam-osm";
import { terrainWindowFor } from "gps-plus-slam-osm";

const TABLE = parseRuleTable(
  ["id,Key,Value,walkable", "leisure_park,leisure,park,3"].join("\n"),
  { source: "test", fetchedAt: 0 },
);

/** The tiles a real pipeline asks its source for over every ring. */
async function tilesOsmDemoFetches(position: LatLng): Promise<Set<string>> {
  const tiles = new Set<string>();
  const source: OsmDataSource = {
    attribution: "test",
    sourceId: "fixture:arrival",
    fetchTile: (tile) => {
      tiles.add(tile);
      return Promise.resolve({
        tile,
        features: [],
        fetchedAt: 0,
        sourceId: "fixture:arrival",
        schemaVersion: 1,
        skipped: [],
      });
    },
  };
  const pipeline = new DemoPipeline({ source, table: TABLE });
  for (const radius of PROGRESSIVE_RADII) {
    await pipeline.update(position, "walkable", undefined, radius);
  }
  return tiles;
}

/** The URLs a fresh terrain field sends to the network at arrival. */
async function demUrlsOsmDemoFetches(position: LatLng): Promise<Set<string>> {
  const urls = new Set<string>();
  const provider = createDemProvider({
    store: new MemoryBlobStore(),
    decodePng: () => Promise.reject(new Error("never decoded")),
    fetchImpl: (input: RequestInfo | URL) => {
      urls.add(String(input instanceof Request ? input.url : input));
      return Promise.resolve(new Response(null, { status: 404 }));
    },
    primaryTimeoutMs: 1_000,
    fallbackTimeoutMs: 1_000,
    publishTimeoutMs: 1_000,
  });
  const field = createTerrainField({ provider });
  const window = terrainWindowFor({
    frameOrigin: position,
    centre: position,
    extentM: TERRAIN_EXTENT_M,
  });
  await field.ensureAround(window.fetchCentre, window.fetchRadiusM);
  return urls;
}

/**
 * The budget of one DEM reference run, ms. The reference is OsmDemo's REAL
 * terrain field and DEM provider sampling the whole arrival window (about
 * 170 000 lattice posts at 50° N, 390 000 at 64° N), because a smaller or
 * hand-picked sample would be a second copy of the arithmetic under test.
 * Measured 2026-10-02 for the slowest case, Reykjavik: 0.9 s on a quiet
 * machine, 3.2-3.7 s beside other test runs, 5.9 s inside a full parallel
 * gate, where it failed the default 5 s. The 30 s budget is five times the
 * worst measured; the assertion is unchanged.
 */
const DEM_REFERENCE_TIMEOUT_MS = 30_000;

/** The library's plan with OsmDemo's heights: both arms of its race. */
function demoPlanFor(position: LatLng) {
  const plan = cityDataPlan(position, {
    heights: {
      urlTemplates: [DEM_URL_TEMPLATES.preferred, DEM_URL_TEMPLATES.fast],
      zoom: DEFAULT_TERRARIUM_ZOOM,
    },
  });
  return {
    position,
    overpassTiles: plan.overpassTiles,
    demUrls: plan.heightUrls,
  };
}

const PLACES: readonly (readonly [string, LatLng])[] = [
  ["Cologne", { lat: 50.9413, lng: 6.9583 }],
  ["the Alps box", { lat: 46.56, lng: 9.14 }],
  ["Quito, near the equator", { lat: -0.1807, lng: -78.4678 }],
  ["Reykjavik, far north", { lat: 64.1466, lng: -21.9426 }],
  ["Sydney, southern hemisphere", { lat: -33.8688, lng: 151.2093 }],
  ["New York, the globe's fallback", { lat: 40.7128, lng: -74.006 }],
];

describe("the library's cityDataPlan with OsmDemo's heights", () => {
  it.each(PLACES)(
    "plans exactly the Overpass tiles OsmDemo fetches at %s",
    async (_name, place) => {
      const plan = demoPlanFor(place);
      const fetched = await tilesOsmDemoFetches(plan.position);
      expect(new Set(plan.overpassTiles)).toEqual(fetched);
      expect(plan.overpassTiles.length).toBe(fetched.size);
    },
  );

  it.each(PLACES)(
    "plans exactly the DEM URLs OsmDemo fetches at %s",
    async (_name, place) => {
      const plan = demoPlanFor(place);
      const fetched = await demUrlsOsmDemoFetches(plan.position);
      expect(new Set(plan.demUrls)).toEqual(fetched);
      expect(plan.demUrls.length).toBe(fetched.size);
    },
    DEM_REFERENCE_TIMEOUT_MS,
  );

  it("agrees with OsmDemo's DEM requests at random places", async () => {
    // Fewer runs than usual: each one samples a fresh 2.5 km terrain window,
    // 0.2-1 million lattice posts (more towards the poles, where a Mercator
    // pixel is narrower), so a run costs about a second.
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -65, max: 65, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        async (lat, lng) => {
          const plan = demoPlanFor({ lat, lng });
          const fetched = await demUrlsOsmDemoFetches(plan.position);
          expect(new Set(plan.demUrls)).toEqual(fetched);
        },
      ),
      { numRuns: 4 },
    );
  }, 60_000);

  it("agrees with OsmDemo's Overpass requests at random places", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.double({ min: -75, max: 75, noNaN: true }),
        fc.double({ min: -179.9, max: 179.9, noNaN: true }),
        async (lat, lng) => {
          const plan = demoPlanFor({ lat, lng });
          const fetched = await tilesOsmDemoFetches(plan.position);
          expect(new Set(plan.overpassTiles)).toEqual(fetched);
        },
      ),
      { numRuns: 25 },
    );
  });

  it("plans one to three Overpass tiles and a few DEM tiles per source", () => {
    const plan = demoPlanFor({ lat: 50.9413, lng: 6.9583 });
    expect(plan.overpassTiles.length).toBeGreaterThanOrEqual(1);
    expect(plan.overpassTiles.length).toBeLessThanOrEqual(3);
    expect(plan.demUrls.some((u) => u.includes("mapterhorn"))).toBe(true);
    expect(plan.demUrls.some((u) => u.includes("amazonaws"))).toBe(true);
  });
});
