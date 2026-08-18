import { describe, expect, it } from "vitest";
import { cellToBoundary, latLngToCell } from "h3-js";

import { parseOverpassJson } from "../../model/overpass-parser.js";
import { toGeometry } from "../../model/osm-geometry.js";
import { loadSite } from "../../test-utils/load-fixtures.js";
import { buildObstacleIndex } from "../../nav/obstacles.js";
import { coverCells } from "../../spatial/cell-coverage.js";
import { boundsOf, clipToBbox } from "../../spatial/clip.js";
import { AFFORDANCE_RES, FETCH_RES } from "../../spatial/resolutions.js";
import type { Bbox } from "../../spatial/clip.js";
import type { OsmFeature } from "../../model/osm-feature.js";

/**
 * WHAT WOULD IT COST TO PUT WATER IN THE OBSTACLE INDEX?
 *
 * Why this test matters: the water veto has failed planning twice, and both
 * times because **no plan ever stated the number the design had to hit**. Every
 * option — clip to a tile, clip to the fetch disk, index a thin band instead of
 * the filled area — was argued rather than priced, so nothing could tell whether
 * a proposal missed. This produces the table.
 *
 * THE BUDGET, from `site-obstacle-index-cost.test.ts`: a whole site's obstacle
 * index is **1 000–10 000 covered cells** today, and that bound is asserted from
 * both sides. Any water option has to land inside a site's budget rather than
 * dwarfing it — a feature that alone costs several times everything else is not
 * an option however correct it is.
 *
 * THE TWO AXES, which are independent and were being conflated:
 *
 * - **FILLED against BAND.** `crossesObstacle` is a *crossing* test, so a band
 *   along the banks blocks entering the river while leaving mid-river steps
 *   unindexed — which is the semantics wanted anyway, since a destination in
 *   the water should simply become unreachable. A band is O(perimeter); a fill
 *   is O(area).
 * - **CLIPPED against not.** Overpass `out geom` returns whole member geometry,
 *   so `london-westminster`'s Thames relation spans **16.3 km** inside a 350 m
 *   fixture.
 *
 * WHAT IS DELIBERATELY NOT MEASURED, and why: the **unclipped filled** cover.
 * It is ~127 653 cells and takes minutes, which would blow the per-test timeout
 * to price the one option nobody is proposing. It is the reference point the
 * others are compared against, quoted rather than re-run.
 *
 * **The answer is the table below `bandCells`.** What runs on every gate is the
 * cheap half — a bound on the shape that won.
 */

/** Water relations big enough for the question to be about. */
const SITES = ["london-westminster", "london-tower-bridge"];

function waterFeatures(id: string): OsmFeature[] {
  return [...parseOverpassJson(loadSite(id).payload).features].filter(
    (feature) => feature.tags["natural"] === "water",
  );
}

/** The res-7 fetch tile the site sits in, as a bbox — one candidate clip box. */
function fetchTileBox(id: string): Bbox {
  const centre = loadSite(id).centre;
  const tile = latLngToCell(centre.lat, centre.lng, FETCH_RES);
  const boundary = cellToBoundary(tile).map(([lat, lng]) => ({ lat, lng }));
  const box = boundsOf(boundary);
  if (box === undefined) throw new Error("no tile bbox");
  return box;
}

/** Covered cells for the FILLED area of every water feature. */
function filledCells(features: readonly OsmFeature[], box?: Bbox): number {
  const cells = new Set<string>();
  for (const feature of features) {
    const result = toGeometry(feature);
    if (!result.ok) continue;
    const geometry =
      box === undefined ? result.geometry : clipToBbox(result.geometry, box);
    if (geometry === undefined) continue;
    for (const covered of coverCells(geometry, AFFORDANCE_RES)) {
      cells.add(covered.cell);
    }
  }
  return cells.size;
}

/**
 * Covered cells for a BAND along the banks — the real `addWater` path.
 *
 * ⚠️ **`clipWaterTo` is passed here and is NOT passed in production**, so the
 * clipped columns below are a measurement of a path the demo never takes. This
 * docstring claimed the opposite ("measures exactly what production indexes")
 * until the PR #313 review. The demo's only call site builds the index through
 * `createObstacleIndexCache(buildObstacleIndex)`, whose `build` parameter is
 * typed to take `features` ALONE — so `resolution` and `options` both default
 * and water is indexed UNCLIPPED. The gap is the point of the table: at
 * `london-westminster` that is 13 052 cells against 1 517, i.e. over the stated
 * 10 000-cell site budget rather than comfortably inside it.
 *
 * The band-vs-filled comparison the table exists for is unaffected — both
 * columns are measured the same way. What must not be read off it is a budget
 * claim about the shipped path. See
 * `docs/2026-08-17-2210-obstacle-index-water-clipping-followup.md`.
 */
function bandCells(features: readonly OsmFeature[], box?: Bbox): number {
  // THE REAL PRODUCTION PATH, since `addWater` now exists. The first version of
  // this re-tagged water as `barrier=wall` to approximate a band, which was the
  // right proxy for choosing a design and the wrong thing to keep once the
  // design shipped: a proxy that drifts from the code it stands for is a guard
  // that passes while production breaks.
  return buildObstacleIndex(features, AFFORDANCE_RES, {
    clipWaterTo: box,
  }).cells.size;
}

/**
 * THE MEASURED TABLE, 2026-08-10 — this is the deliverable, and it is recorded
 * here because re-running it costs more than it is worth on every gate.
 *
 * ```
 * budget for a WHOLE site's obstacle index: 1 000 – 10 000 cells
 *
 *                        FILLED            BAND
 *                        unclip   clipped  unclip   clipped
 * london-westminster    ~127 653   18 246   13 052    1 517
 * london-tower-bridge         —    13 966    1 752    1 153
 * ```
 *
 * **ONLY BAND + CLIP FITS.** Filled-and-clipped is 1.4–1.8× the budget's ceiling
 * on its own; band-alone is over it at Westminster; the two together land at
 * **1 153–1 517**, inside a budget that has to cover every other obstacle too.
 * Westminster is the case that decides it — its Thames relation spans 16.3 km
 * against Tower Bridge's 2.9 km, so the requirement is set by the worse one.
 *
 * From filled-unclipped to band-clipped is **~84×**, of which ~12× is the band
 * and ~8.6× the clip. Neither alone suffices and the plan that proposed either
 * on its own could not tell, because no plan ever stated the budget.
 *
 * **Set `FULL_TABLE = true` to reproduce it.** Left off because the filled
 * covers take **39 s under gate contention** against 1.9 s run alone — the same
 * 15–20× inflation `cell-overlap.differential.test.ts` measured — which would
 * make this the most expensive test in the package for a number that has already
 * done its job.
 */
const FULL_TABLE = false;

describe("what water would cost the obstacle index", () => {
  it("keeps a band+clip index inside a whole site's budget", () => {
    // THE STANDING GUARD is the cheap half: band + clip is the chosen shape, so
    // this pins that it stays affordable. The expensive comparisons that
    // justified choosing it are above, one constant away.
    for (const id of SITES) {
      const water = waterFeatures(id);
      expect(water.length).toBeGreaterThan(0);

      const cells = bandCells(water, fetchTileBox(id));
      // Bounded from BOTH sides, as `site-obstacle-index-cost.test.ts` bounds
      // its own: the ceiling catches a change that starts indexing the world,
      // and the floor catches one that quietly stops indexing water at all —
      // which would look like fast routing and walk agents across the river.
      expect(cells).toBeGreaterThan(500);
      expect(cells).toBeLessThan(4_000);
    }
  });

  it.skipIf(!FULL_TABLE)(
    "prices filled against band, clipped against not",
    () => {
      const rows: string[] = [];
      for (const id of SITES) {
        const water = waterFeatures(id);
        const box = fetchTileBox(id);
        rows.push(
          `${id}: water features=${water.length} | ` +
            `BAND unclipped=${bandCells(water)} clipped=${bandCells(water, box)} | ` +
            `FILLED clipped=${filledCells(water, box)}`,
        );
      }
      process.stdout.write(
        `[water index cost] budget for a WHOLE site = 1000-10000 cells\n  ` +
          rows.join("\n  ") +
          "\n",
      );
      expect(rows.length).toBe(SITES.length);
    },
  );
});
