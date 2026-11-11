import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { enuFrameAt } from "../../mesh/enu.js";
import { buildCity } from "../../mesh/city.js";

/**
 * WHY THESE TESTS MATTER. The road join (city objects plan 2026-11-07-2315
 * M4a, the mitre strip) is judged by its cost on real streets as much as by
 * its look, and the three scenes the owner looked at in the O3 lab are the
 * ones whose numbers were reported: Heidelberg's old town, Meggen's suburb
 * and Park Slope's grid. Before M4a (a disc on every vertex) they drew 8,884,
 * 18,490 and 11,404 road triangles, O3's "today" numbers exactly. The strip
 * as first built (a break and two discs at every junction) drew 5,164, 10,786
 * and 9,484; running through junctions (the M4a review's MINOR 3, r1164)
 * draws 4,700, 8,450 and 6,292, 47, 54 and 45 percent fewer than the discs.
 * A change to the joins, the junction rule or the fallback moves these
 * counts, and the change then has to say why. Pinned at the default mitre
 * limit 2; swept on these counts (r1167), limit 4 draws the same, 1.5 one
 * triangle more per scene, and 1 (every join bevelled) 5,206, 9,567 and
 * 6,734, 7 to 13 percent more.
 */
const PINNED: Record<string, number> = {
  "heidelberg-altstadt": 4700,
  "lucerne-meggen": 8450,
  "nyc-park-slope": 6292,
};

describe("road triangles on the O3 scenes (M4a)", () => {
  it.each(Object.entries(PINNED))("%s draws %i", (id, count) => {
    const site = loadSite(id);
    const features = parseOverpassJson(site.payload).features;
    const frame = enuFrameAt(site.centre);
    const city = buildCity(
      features,
      { frame },
      // The ribbons alone: zebras and areas are pinned below.
      { window: site.bbox, roads: { markings: false } },
    );
    expect(
      city.roads.reduce((sum, chunk) => sum + chunk.mesh.triangleCount, 0),
    ).toBe(count);
  });
});

/**
 * WHY THESE TESTS MATTER. Zebras and pedestrian areas (city objects M4b) are
 * drawn from the map alone, so their counts on the O3 scenes are what the
 * port is held to: Park Slope's 1,089 stripes are O3's number exactly;
 * Meggen's 111 are O3's 109 plus two lone island nodes (`crossing:island`)
 * the lab placed elsewhere, not investigated further; Heidelberg's four
 * squares are the ones the O3 street camera stands on. Swept (2026-11-11): pitch
 * 0.8 / 1 / 1.2 m gives Park Slope 1,375 / 1,089 / 904 stripes, Meggen 139 /
 * 111 / 91; cutting at 12 / 24 / 48 m or not at all gives Heidelberg's areas
 * 1,275 / 639 / 391 / 171 triangles (Reuss's 28 areas: 2,885 at 12 m).
 * The terrain's own 12 m is the default (every vertex on a post cell), the
 * cost the sweep names.
 */
const MARKINGS: Record<string, { stripes: number; areas: number }> = {
  "heidelberg-altstadt": { stripes: 6, areas: 4 },
  "lucerne-meggen": { stripes: 111, areas: 0 },
  "nyc-park-slope": { stripes: 1089, areas: 0 },
};

describe("zebras and pedestrian areas on the O3 scenes (M4b)", () => {
  it.each(Object.entries(MARKINGS))("%s draws %j", (id, expected) => {
    const site = loadSite(id);
    const features = parseOverpassJson(site.payload).features;
    const frame = enuFrameAt(site.centre);
    const city = buildCity(
      features,
      { frame },
      { window: site.bbox, roads: true },
    );
    expect({
      stripes: city.zebraStripeCount,
      areas: city.pedestrianAreaCount,
    }).toEqual(expected);
    const ribbonsOnly = buildCity(
      features,
      { frame },
      { window: site.bbox, roads: { markings: false } },
    );
    const triangles = (c: typeof city): number =>
      c.roads.reduce((sum, chunk) => sum + chunk.mesh.triangleCount, 0);
    // Two triangles a stripe, and at least one an area, all in the chunks.
    expect(triangles(city) - triangles(ribbonsOnly)).toBeGreaterThanOrEqual(
      2 * expected.stripes + expected.areas,
    );
    expect(ribbonsOnly.zebraStripeCount).toBe(0);
    expect(ribbonsOnly.pedestrianAreaCount).toBe(0);
  });
});
