import { bench, describe } from "vitest";
import { buildObstacleIndex } from "./obstacles.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import type { OsmFeature } from "../model/osm-feature.js";

/**
 * Benchmark for the obstacle sweep — the largest single cost in this package.
 *
 * Why this bench matters (2026-08-09 perf loop, OSM iteration 6). Routing's
 * index is built by covering every barrier footprint and every solid building
 * ring at `AFFORDANCE_RES = 13`, and `site-obstacle-index-cost.test.ts` recorded
 * it as hundreds of milliseconds per site while noting its own figures are a
 * FLOOR — the extracts are res-9/res-10 captures and the demo's working set is a
 * res-7 tile. It was never optimised, only worked around: `obstacle-index-cache`
 * exists so one index can serve many clicks, which means the first route request
 * after every feature-set change pays the whole sweep.
 *
 * **The cost is the NUMBER of `polygonToCellsExperimental` calls, not the
 * geometry.** Measured on devbox-win11 (Win 11 Pro, Node 24.14.1): the call has a
 * fixed cost of ~0.5-0.8 ms that is independent of how many cells come back — a
 * 1x20 m quad returning 7 cells costs 675 us, and at res 7, where it returns a
 * single cell, it still costs 296 us. The corpus makes 3 397 such calls (57 %
 * building rings, 43 % barrier segment quads) for 2 829 ms, i.e. ~0.83 ms each,
 * and `london-westminster` alone makes 1 123 of them for 825 ms.
 *
 * So the bench is deliberately per SITE rather than per polygon: the call count
 * is a property of how much real mapping a place has, and no synthetic shape
 * reproduces the mix.
 *
 * **This bench's own means, in three states** — quoted from the bench rather
 * than from a harness, so they cannot drift. Baseline → after `cell-overlap.ts`
 * covers a hole-free ring itself → after that module memoises cell boundaries:
 *
 * - `london-westminster` **827.7 → 339.4 → 154.0 ms** (−81 % overall)
 * - `cologne-cathedral` **430.9 → 182.1 → 96.9 ms** (−78 %)
 * - `berlin-alexanderplatz` **152.1 → 92.7 → 68.1 ms** (−55 %)
 *
 * Berlin gains least at both steps, and that is the shape of the fixes rather
 * than noise: the first win is per CALL and Berlin makes 124 of them against
 * Westminster's 1 123; the second is per REPEATED cell, and Berlin's repeat
 * factor is 2.4× against Westminster's 11.1×. Both fixes pay in proportion to
 * how much mapped detail a place has, which is the right way round.
 *
 * The separate harness sweep that ranked all eight sites read, as medians of 5:
 * `london-westminster` 825 · `heidelberg-altstadt` 480 · `cologne-cathedral`
 * 340 · `sylt-westerland` 331 · `manhattan-midtown` 328 · `tokyo-shinjuku` 265 ·
 * `london-tower-bridge` 134 · `berlin-alexanderplatz` 127 ms. Cologne reads
 * higher here (431 vs 340) than there; benches carry warm-up and a different
 * sample count, which is exactly why the before/after claim uses this file's
 * numbers on both sides.
 *
 * Three sites are benched rather than all eight, for the reason
 * `site-obstacle-index-cost.test.ts` gives for measuring one: the whole corpus
 * costs seconds, and this file runs under `pnpm run bench` where that is paid
 * every time. The three span the range — the worst, the median, and the cheapest
 * — so a change that helps only large sites is still visible.
 */

function features(siteId: string): OsmFeature[] {
  return [...parseOverpassJson(loadSite(siteId).payload).features];
}

describe("buildObstacleIndex — the production entry point", () => {
  for (const siteId of [
    "london-westminster",
    "cologne-cathedral",
    "berlin-alexanderplatz",
  ]) {
    const all = features(siteId);

    bench(`${siteId} (${all.length} features)`, () => {
      buildObstacleIndex(all);
    });
  }
});
