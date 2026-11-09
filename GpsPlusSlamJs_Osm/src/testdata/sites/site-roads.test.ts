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
 * draws 42, 42 and 17 percent fewer; a change to the joins, the junction
 * rule or the fallback moves these counts, and the change then has to say
 * why. Pinned at the default mitre limit; the limit's sweep (1, 1.5, 2, 4)
 * is in the M4a report.
 */
const PINNED: Record<string, number> = {
  "heidelberg-altstadt": 5164,
  "lucerne-meggen": 10786,
  "nyc-park-slope": 9484,
};

describe("road triangles on the O3 scenes (M4a)", () => {
  it.each(Object.entries(PINNED))("%s draws %i", (id, count) => {
    const site = loadSite(id);
    const features = parseOverpassJson(site.payload).features;
    const frame = enuFrameAt(site.centre);
    const city = buildCity(
      features,
      { frame },
      { window: site.bbox, roads: true },
    );
    expect(
      city.roads.reduce((sum, chunk) => sum + chunk.mesh.triangleCount, 0),
    ).toBe(count);
  });
});
