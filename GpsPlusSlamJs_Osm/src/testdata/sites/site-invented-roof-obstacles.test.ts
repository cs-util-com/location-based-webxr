import { describe, expect, it } from "vitest";

import { loadSite } from "../../test-utils/load-fixtures.js";
import { parseOverpassJson } from "../../model/overpass-parser.js";
import { buildBuildings } from "../../mesh/buildings.js";
import { enuFrameAt } from "../../mesh/enu.js";
import { buildObstacleIndex, type ObstacleIndex } from "../../nav/obstacles.js";

/**
 * The obstacle index takes the heights the screen draws.
 *
 * WHY THIS FILE MATTERS. An agent decides from the index whether a building
 * blocks it; the viewer decides from the drawn roof. With invented roofs a
 * building the map says nothing about is drawn at an invented height, and an
 * index still at the library's 6 m would let agents step over roofs the
 * screen shows, or stop at ones it does not. One planner feeds both; these
 * checks hold the two together on every captured site. The index plans in a
 * frame of its own, so they also hold that a roof does not depend on it.
 */

const SITES = [
  "heidelberg-altstadt",
  "lucerne-meggen",
  "nyc-park-slope",
  "berlin-alexanderplatz",
  "woodland-hinterzarten",
  "cologne-cathedral",
  "london-tower-bridge",
  "london-westminster",
  "manhattan-midtown",
  "sylt-westerland",
  "tokyo-shinjuku",
  "lucerne-reuss",
] as const;

/** Every building obstacle's height, by feature key (the tallest piece). */
function heightsOf(index: ObstacleIndex): Map<string, number> {
  const heights = new Map<string, number>();
  for (const cell of index.cells) {
    for (const obstacle of index.obstaclesIn(cell)) {
      heights.set(
        obstacle.feature,
        Math.max(heights.get(obstacle.feature) ?? 0, obstacle.heightM),
      );
    }
  }
  return heights;
}

describe.each(SITES)("invented heights in the obstacle index at %s", (id) => {
  const site = loadSite(id);
  const features = parseOverpassJson(site.payload).features;
  const frame = enuFrameAt(site.centre);

  it("indexes every building at the height it is drawn", () => {
    const drawn = buildBuildings(features, { frame, inventedRoofs: true });
    const indexed = heightsOf(buildObstacleIndex(features));
    let compared = 0;
    for (const volume of drawn) {
      const height = indexed.get(volume.feature);
      // Passable volumes (an arch, a canopy) and parts are not compared:
      // the first are not indexed, the second never invented.
      if (height === undefined || volume.parentFeature !== undefined) continue;
      if (volume.heights.minHeightM > 0) continue;
      expect(height, volume.feature).toBeCloseTo(
        volume.heights.totalHeightM,
        2,
      );
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it("keeps the library heights with the option off", () => {
    const drawn = buildBuildings(features, { frame });
    const indexed = heightsOf(
      buildObstacleIndex(features, undefined, { inventedRoofs: false }),
    );
    for (const volume of drawn) {
      const height = indexed.get(volume.feature);
      if (height === undefined || volume.parentFeature !== undefined) continue;
      if (volume.heights.minHeightM > 0) continue;
      expect(height, volume.feature).toBe(volume.heights.totalHeightM);
    }
  });
});
