/**
 * Why these tests matter: the globe's arrival prefetch (round-5 plan
 * 2026-10-01-0945 §3.6) is worth exactly as much as its plan matches what
 * OsmDemo loads when it opens at the place (the globe opened it by a URL
 * hand-over until globe city plan 2026-10-05-0040 §12.5 C6 removed that;
 * the globe's own city now reads the same Overpass tiles from the same
 * store). A plan that is off by one
 * tile warms a cache nobody reads, and nothing reports it: the second visit
 * is just slow. So the plan is compared with OsmDemo's REAL machinery, not
 * with a second copy of its arithmetic:
 * - the Overpass tiles with a real `DemoPipeline` run through every ring of
 *   `PROGRESSIVE_RADII`, as the refresh cycle runs it;
 * - the DEM URLs with the real `createDemProvider` + `createTerrainField`,
 *   asked for the terrain window `main.ts` asks for at arrival, recording
 *   every URL it sends to the network;
 * - the position with OsmDemo's own `?lat=&lng=` reader, at the five
 *   decimals OsmDemo's URL carries.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MemoryBlobStore,
  PROGRESSIVE_RADII,
  parseRuleTable,
  type LatLng,
  type OsmDataSource,
} from "gps-plus-slam-osm";

import { arrivalPlanFor } from "./arrival-plan.js";
import { DemoPipeline } from "./demo-pipeline.js";
import { createDemProvider } from "./dem-provider.js";
import { TERRAIN_EXTENT_M } from "gps-plus-slam-osm";
import { parseStartPosition } from "./start-position.js";
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

const PLACES: readonly (readonly [string, LatLng])[] = [
  ["Cologne", { lat: 50.9413, lng: 6.9583 }],
  ["the Alps box", { lat: 46.56, lng: 9.14 }],
  ["Quito, near the equator", { lat: -0.1807, lng: -78.4678 }],
  ["Reykjavik, far north", { lat: 64.1466, lng: -21.9426 }],
  ["Sydney, southern hemisphere", { lat: -33.8688, lng: 151.2093 }],
  ["New York, the globe's fallback", { lat: 40.7128, lng: -74.006 }],
];

describe("arrivalPlanFor", () => {
  it.each(PLACES)(
    "plans exactly the Overpass tiles OsmDemo fetches at %s",
    async (_name, place) => {
      const plan = arrivalPlanFor(place);
      const fetched = await tilesOsmDemoFetches(plan.position);
      expect(new Set(plan.overpassTiles)).toEqual(fetched);
      expect(plan.overpassTiles.length).toBe(fetched.size);
    },
  );

  it.each(PLACES)(
    "plans exactly the DEM URLs OsmDemo fetches at %s",
    async (_name, place) => {
      const plan = arrivalPlanFor(place);
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
          const plan = arrivalPlanFor({ lat, lng });
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
          const plan = arrivalPlanFor({ lat, lng });
          const fetched = await tilesOsmDemoFetches(plan.position);
          expect(new Set(plan.overpassTiles)).toEqual(fetched);
        },
      ),
      { numRuns: 25 },
    );
  });

  // The globe's page hand-over is gone (globe city plan 2026-10-05-0040
  // §12.5 C6), and with it "plans for the position in the globe's REAL
  // hand-over URL", which loaded the deleted `globe-handover.ts`: there is
  // no URL any more to agree with. What stays is OsmDemo's own URL.
  it("plans for the position OsmDemo reads from its URL", () => {
    // OsmDemo's URL carries five decimals (`url-state.ts`), and it
    // computes its chunk from what it parses, not from an unrounded
    // target. A target a hair across a cell edge would otherwise plan the
    // neighbouring tile.
    const target = { lat: 50.941_349_7, lng: -0.000_000_2 };
    const plan = arrivalPlanFor(target);
    expect(plan.position).toEqual(
      parseStartPosition(
        `?lat=${(target.lat + 0).toFixed(5)}&lng=${(target.lng + 0).toFixed(5)}`,
      ),
    );
  });

  it("plans one to three Overpass tiles and a few DEM tiles per source", () => {
    const plan = arrivalPlanFor({ lat: 50.9413, lng: 6.9583 });
    expect(plan.overpassTiles.length).toBeGreaterThanOrEqual(1);
    expect(plan.overpassTiles.length).toBeLessThanOrEqual(3);
    expect(plan.demUrls.some((u) => u.includes("mapterhorn"))).toBe(true);
    expect(plan.demUrls.some((u) => u.includes("amazonaws"))).toBe(true);
  });

  it.each([
    [{ lat: Number.NaN, lng: 0 }],
    [{ lat: 0, lng: Number.POSITIVE_INFINITY }],
    [{ lat: 91, lng: 0 }],
    [{ lat: 0, lng: -181 }],
  ])("refuses %o with a RangeError", (target) => {
    expect(() => arrivalPlanFor(target)).toThrow(RangeError);
  });
});
