import { bench, describe } from "vitest";
import { buildAreaPlates } from "./plates.js";
import { enuFrameAt, ringToEnu } from "./enu.js";
import { triangulate } from "./triangulate.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { toGeometry } from "../model/osm-geometry.js";
import { loadFixture } from "../test-utils/load-fixtures.js";
import type { OsmFeature } from "../model/osm-feature.js";
import type { EnuPoint } from "./enu.js";

/**
 * Benchmark for ground-plate building, and for the triangulator underneath it.
 *
 * Why this bench matters (2026-07-31 perf loop, OSM iteration 4). Profiling the
 * mesh path — an area this round had never ranked — found a cost about **25×
 * larger than the entire `buildFeatureIndex` path** the round had spent itself
 * on. Medians, devbox-win11:
 *
 * - `buildAreaPlates` — 0.54 / 0.24 / **2881** ms for park / street-corner /
 *   building-block.
 * - Everything else in the mesh path is ≤1.1 ms: `buildBuildings`,
 *   `buildRoads`, `buildTrees`, `buildPoiMarkers`, `mergeMeshes`.
 *
 * Bisected to `triangulate`, whose ear clipping is **O(n²)**:
 *
 * - `relation/62578` — 4 867 points → 111.8 ms
 * - `relation/72022` — 25 001 points → **2 657.7 ms**
 * - points ×5.1, time ×23.8 ≈ 5.1², which is the quadratic stated plainly
 *
 * `relation/72022` is the SAME 316-member administrative boundary relation that
 * made ring stitching quadratic, arriving through a third code path (it also
 * dominates the h3 cover). Any city bbox clipping an admin boundary gets one,
 * and this runs on every mesh build — so a click on a dense block pays ~2.9 s
 * of ear clipping for geometry spanning 100+ km of which ~2.8 km is rendered.
 *
 * The `triangulate` block is kept separate from `buildAreaPlates` so a fix can
 * be attributed: clipping the input makes the FIRST faster while leaving the
 * second's curve exactly as it is, and that distinction is the whole point.
 */

/** Every feature of a fixture, with the fixture's own centre. */
function fixture(slug: string): {
  features: OsmFeature[];
  centre: { lat: number; lng: number };
} {
  const raw = loadFixture(slug);
  return {
    features: [...parseOverpassJson(raw.payload).features],
    centre: raw.centre,
  };
}

describe("buildAreaPlates — the production entry point", () => {
  for (const slug of ["park", "street-corner", "building-block"]) {
    const { features, centre } = fixture(slug);
    const options = { frame: enuFrameAt(centre) };

    bench(`${slug} (${features.length} features)`, () => {
      buildAreaPlates(features, options);
    });
  }
});

/** The ENU rings of the fixture's largest plate-shaped polygon. */
function biggestPolygon(slug: string): EnuPoint[][] | undefined {
  const { features, centre } = fixture(slug);
  const frame = enuFrameAt(centre);
  let best: EnuPoint[][] | undefined;
  let bestCount = 0;

  for (const feature of features) {
    const result = toGeometry(feature);
    if (!result.ok) continue;
    const polygons =
      result.geometry.kind === "polygon"
        ? [result.geometry.rings]
        : result.geometry.kind === "multipolygon"
          ? result.geometry.polygons
          : [];
    for (const rings of polygons) {
      const count = rings.reduce((sum, ring) => sum + ring.length, 0);
      if (count <= bestCount) continue;
      bestCount = count;
      best = rings.map((ring) => ringToEnu(ring, frame));
    }
  }
  return best;
}

describe("triangulate — the quadratic underneath", () => {
  for (const slug of ["park", "building-block"]) {
    const rings = biggestPolygon(slug);
    if (rings === undefined) continue;
    const points = rings.reduce((sum, ring) => sum + ring.length, 0);

    bench(`${slug}'s largest polygon (${points} points)`, () => {
      triangulate(rings);
    });
  }
});
