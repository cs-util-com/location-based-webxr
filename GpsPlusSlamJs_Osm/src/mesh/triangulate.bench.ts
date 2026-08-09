import { bench, describe } from "vitest";
import { triangulate } from "./triangulate.js";
import { enuFrameAt, ringToEnu } from "./enu.js";
import { toGeometry } from "../model/osm-geometry.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import type { EnuPoint } from "./enu.js";

/**
 * Benchmark for HOLE BRIDGING, the step `triangulate` runs before ear clipping.
 *
 * Why this bench matters, and why it is separate from `plates.bench.ts`. That
 * file benches the ear-clipping quadratic in RING SIZE, which the 2026-07-31
 * clip fix bounded by shrinking the input. This one benches a second, distinct
 * quadratic that the clip does NOT bound, because it scales with the number of
 * HOLES rather than with the extent: `bridgeHoles` calls `nearestVisible` once
 * per hole, and that walked the whole ring calling `crossesRing` — itself a full
 * scan of the ring's edges — for every candidate nearer than the best found so
 * far. Its docstring's premise ("holes are rare, and a building with a courtyard
 * has tens of vertices") is false for the ordinary case of a landuse or natural
 * relation: `relation/28934` in `london-westminster` is 3 759 outer points with
 * **58 holes**, and even clipped to the demo's 4.8 km extent it is still 33.
 *
 * The subjects are chosen by "most holes in the site", not hand-picked, so the
 * bench keeps pointing at the worst real case if the corpus is recaptured.
 *
 * This bench's own means on devbox-win11 (Win 11 Pro, Node 24.14.1), before and
 * after the 2026-08-09 nearest-first rewrite of `nearestVisible`:
 *
 * - `london-westminster` `relation/28934`, 4 804 points / 58 holes —
 *   **686.3 → 116.6 ms**
 * - `sylt-westerland` `relation/5551237`, 596 points / 30 holes —
 *   **7.29 → 1.98 ms**
 *
 * Bridging accounted for 5.2 million segment-intersection tests on the clipped
 * Westminster polygon alone; ear clipping the same ring costs ~7 ms, and is what
 * the remaining time is.
 */

/** The polygon with the most holes in a site extract, in ENU metres. */
function mostHoledPolygon(siteId: string): {
  rings: EnuPoint[][];
  points: number;
  holes: number;
} {
  const site = loadSite(siteId);
  const frame = enuFrameAt(site.centre);
  let best: { rings: readonly (readonly { lat: number; lng: number }[])[] } & {
    holes: number;
    points: number;
  } = { rings: [], holes: -1, points: 0 };

  for (const feature of parseOverpassJson(site.payload).features) {
    const result = toGeometry(feature);
    if (!result.ok) continue;
    const polygons =
      result.geometry.kind === "polygon"
        ? [result.geometry.rings]
        : result.geometry.kind === "multipolygon"
          ? result.geometry.polygons
          : [];
    for (const rings of polygons) {
      const holes = rings.length - 1;
      const points = rings.reduce((sum, ring) => sum + ring.length, 0);
      if (
        holes > best.holes ||
        (holes === best.holes && points > best.points)
      ) {
        best = { rings, holes, points };
      }
    }
  }
  return {
    rings: best.rings.map((ring) => ringToEnu(ring, frame)),
    points: best.points,
    holes: best.holes,
  };
}

describe("triangulate — hole bridging", () => {
  for (const siteId of ["london-westminster", "sylt-westerland"]) {
    const { rings, points, holes } = mostHoledPolygon(siteId);
    if (holes <= 0) continue;

    bench(`${siteId} (${points} points, ${holes} holes)`, () => {
      triangulate(rings);
    });
  }
});
