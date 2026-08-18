import { bench, describe } from "vitest";
import { polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS } from "h3-js";

import { parseOverpassJson } from "../model/overpass-parser.js";
import { toGeometry } from "../model/osm-geometry.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import { coverCells } from "./cell-coverage.js";
import { clipToBbox } from "./clip.js";
import { overlappingCells } from "./cell-overlap.js";
import { AFFORDANCE_RES } from "./resolutions.js";
import type { LatLng } from "../model/osm-feature.js";
import type { OsmGeometry } from "../model/osm-geometry.js";

/**
 * DOES THE HOLE-FREE FAST PATH EVER LOSE?
 *
 * WHY THIS EXISTS. A testing session reported that scoring "feels slower since
 * the optimisation". Two documents asserted the perf round had not touched the
 * scoring path, and both were wrong: `cell-coverage.ts`'s `addPolygon` now
 * routes every hole-free ring through `overlappingCells` (`c388484`), and
 * `coverCells` -> `addPolygon` is exactly what `AffordanceIndex.scoreChunks`
 * calls. So the scoring path DID change, and the claim it had not was read from
 * a memory of the round rather than from the diff.
 *
 * THE SUSPECTED MECHANISM, and it is specific rather than a vague worry.
 * `overlappingCells` can DECLINE, and a decline is not free:
 *
 * - it may decline cheaply, in `diskRadius`, after one pass over the vertices;
 * - or it may decline EXPENSIVELY, after scanning a disk of up to 397 candidate
 *   cells, when a hit lands on the disk's outer ring (`cell-overlap.ts:122`).
 *
 * Either way `addPolygon` then runs `polygonToCellsExperimental` anyway. **So a
 * declining ring pays the fast path AND h3**, and if the scoring path's rings
 * decline often enough, the "optimisation" is a regression there while remaining
 * a large win on the obstacle sweep it was measured against.
 *
 * WHAT THIS MEASURES, and why it needs no r497 worktree. r497's `addPolygon` had
 * no fast path at all — it always called h3. `alwaysH3` below is exactly that
 * code, so benching it against `coverCells` over identical geometry IS the
 * r497 -> HEAD A/B for this function, with both sides on one machine in one run.
 * That is a stronger comparison than the doc lookup originally planned, which
 * could not have worked anyway: `perf-loop-state.md` records percentages for
 * this round, not absolute affordance figures.
 *
 * THE DECLINE RATE IS REPORTED IN THE BENCH NAMES, so a run that shows no
 * difference still says why — the same rule `spatial-query.bench.ts` adopted
 * after a benchmark measured nothing and reported a flattering number.
 */

const SITES = [
  "london-westminster",
  "cologne-cathedral",
  "manhattan-midtown",
  "tokyo-shinjuku",
  "heidelberg-altstadt",
  "berlin-alexanderplatz",
  "sylt-westerland",
  "london-tower-bridge",
];

/**
 * Half-width of the clip box, in degrees — ~250 m, one scored working set.
 *
 * **CLIPPING IS NOT AN OPTIMISATION OF THIS HARNESS, IT IS WHAT THE SCORING PATH
 * DOES.** `AffordanceIndex.scoreChunks` clips every geometry to the padded union
 * of the chunks it is scoring before covering it, so the rings that actually
 * reach `addPolygon` are working-set sized. Covering the corpus UNCLIPPED
 * measures something no caller ever asks for.
 *
 * The first version of this file did exactly that and **ran the V8 heap out of
 * memory**: a landuse polygon spanning kilometres covers millions of res-13
 * cells. That crash is worth recording rather than quietly fixing — it is the
 * same unclipped-geometry hazard that makes indexing the Thames expensive, met
 * here by accident, and it is why a "cover the corpus" benchmark has to say
 * which corpus it means.
 */
const CLIP_HALF_DEG = 0.00225;

/**
 * The single-ring polygons of one geometry — the only shape the fast path takes.
 *
 * Rings WITH holes never reach it (`addPolygon` restricts by ring count), so
 * including them would dilute the very rate this file is trying to read.
 */
function eligibleRings(geometry: OsmGeometry): (readonly LatLng[])[] {
  const polygons =
    geometry.kind === "polygon"
      ? [geometry.rings]
      : geometry.kind === "multipolygon"
        ? geometry.polygons
        : [];
  const out: (readonly LatLng[])[] = [];
  for (const rings of polygons) {
    const outer = rings[0];
    if (rings.length !== 1 || outer === undefined || outer.length < 3) continue;
    out.push(outer);
  }
  return out;
}

/** Hole-free rings from the corpus, clipped as the scorer clips them. */
function holeFreeRings(): (readonly LatLng[])[] {
  const out: (readonly LatLng[])[] = [];
  for (const id of SITES) {
    const site = loadSite(id);
    const centre = site.centre;
    const box = {
      west: centre.lng - CLIP_HALF_DEG,
      east: centre.lng + CLIP_HALF_DEG,
      south: centre.lat - CLIP_HALF_DEG,
      north: centre.lat + CLIP_HALF_DEG,
    };
    for (const feature of parseOverpassJson(site.payload).features) {
      const result = toGeometry(feature);
      if (!result.ok) continue;
      const clipped = clipToBbox(result.geometry, box);
      if (clipped === undefined) continue;
      out.push(...eligibleRings(clipped));
    }
  }
  return out;
}

const RINGS = holeFreeRings();

/** r497's `addPolygon`, verbatim in behaviour: no fast path, h3 every time. */
function alwaysH3(ring: readonly LatLng[], res: number): Set<string> {
  const cells = new Set<string>();
  const polygon = [ring.map((p) => [p.lat, p.lng] as [number, number])];
  for (const cell of polygonToCellsExperimental(
    polygon,
    res,
    POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
  )) {
    cells.add(cell);
  }
  return cells;
}

/**
 * How many rings the fast path refuses, counted once outside every timed region.
 *
 * This is the number the whole file turns on: a decline pays both paths, so the
 * fast path is a net loss on exactly this fraction of the corpus.
 */
const DECLINED = RINGS.filter(
  (ring) =>
    overlappingCells(
      ring.map((p) => ({ x: p.lng, y: p.lat })),
      AFFORDANCE_RES,
    ) === undefined,
).length;

const DECLINE_PCT = ((DECLINED / RINGS.length) * 100).toFixed(1);

describe("hole-free ring cover — fast path against r497's always-h3", () => {
  bench(
    `coverCells, fast path (${RINGS.length} rings, ${DECLINED} decline = ${DECLINE_PCT} %)`,
    () => {
      for (const ring of RINGS) {
        coverCells({ kind: "polygon", rings: [ring] }, AFFORDANCE_RES);
      }
    },
  );

  bench(`alwaysH3, i.e. r497 (${RINGS.length} rings)`, () => {
    for (const ring of RINGS) alwaysH3(ring, AFFORDANCE_RES);
  });
});

/**
 * The declining subset alone — where a regression would live if there is one.
 *
 * Benching the whole corpus can hide it: if 95 % of rings take a fast path that
 * is 4x quicker, a 5 % subset paying double disappears into the average while
 * still being real for whoever is standing in a place made of those rings.
 * Split out so the two questions — "is it faster overall" and "is it ever
 * slower" — get separate answers rather than one blended one.
 */
const DECLINING = RINGS.filter(
  (ring) =>
    overlappingCells(
      ring.map((p) => ({ x: p.lng, y: p.lat })),
      AFFORDANCE_RES,
    ) === undefined,
);

if (DECLINING.length > 0) {
  describe("the declining rings only — do they pay twice?", () => {
    bench(`coverCells on decliners (${DECLINING.length} rings)`, () => {
      for (const ring of DECLINING) {
        coverCells({ kind: "polygon", rings: [ring] }, AFFORDANCE_RES);
      }
    });

    bench(`alwaysH3 on the same rings (${DECLINING.length})`, () => {
      for (const ring of DECLINING) alwaysH3(ring, AFFORDANCE_RES);
    });
  });
}
