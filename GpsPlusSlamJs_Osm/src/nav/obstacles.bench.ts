import { bench, describe } from "vitest";
import { buildObstacleIndex, crossesObstacle } from "./obstacles.js";
import { gridDisk } from "h3-js";
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

/**
 * THE QUERY SIDE, WHICH HAS NEVER BEEN PRICED.
 *
 * Everything above measures BUILD — one sweep per feature set, cached by
 * `obstacle-index-cache` and paid once per publish. `crossesObstacle` is the
 * other half and the one that runs on the search's hottest path: A\* calls it as
 * `canCross` for **every candidate step**, up to `DEFAULT_ROUTE_EXPANSIONS =
 * 20 000` states × ~6 neighbours per click.
 *
 * WHY IT MATTERS NOW, and it is not an abstract gap. A build-only benchmark is
 * structurally incapable of failing on a query regression, so any change that
 * adds features to the index — the water veto is the live proposal — would be
 * checked by a guard that cannot see its likelier failure. `crossesObstacle`
 * tests the step segment against **every ring of every obstacle** in
 * `gridDisk(fromCell, 1) ∪ {toCell}`, so its cost scales with how many rings and
 * how many VERTICES sit in the local neighbourhood. A single unclipped water
 * relation contributes thousands of vertices to every call in its span.
 *
 * TWO POPULATIONS, because they are not the same question:
 *
 * - **steps in open ground**, which is what most of a search does and where the
 *   answer is a fast "no obstacle here at all";
 * - **steps near mapped geometry**, where the ring tests actually run.
 *
 * Reporting them separately keeps an average from hiding the case that decides
 * whether a click freezes.
 *
 * WHAT IT FOUND, 2026-08-10, and it is the opposite of what the water proposal
 * assumed. Per step, `london-westminster` **6.2 µs on indexed cells and 6.3 µs
 * on verified-clear ones**; `berlin-alexanderplatz` 7.0 and 6.2. A clear step
 * runs **no ring tests at all** — every `obstaclesIn` in its disk returns empty
 * — and cost the same.
 *
 * ACTED ON, and the floor was nearly all of it. Memoising cell centres took it
 * to 3.8 µs (−38 %); memoising the radius-1 disk and visiting `toCell`
 * separately took it to **0.83 µs (−87 % overall)**, so a route click pays ~17 ms
 * rather than ~124 ms. **The two populations now differ** — 0.33 µs against
 * 0.22 µs — which is the check that what is left really is the ring tests: while
 * they read the same, no geometry change could have been visible in this bench.
 *
 * **So the cost is the fixed per-call overhead, not the geometry**: two
 * `cellToLatLng` conversions, a `gridDisk(fromCell, 1)`, and seven map lookups,
 * paid whether or not there is anything to test. Three consequences:
 *
 * - **A route click pays ~124 ms of this alone** at `DEFAULT_ROUTE_EXPANSIONS`
 *   = 20 000 — and the common case is the unreachable destination, which
 *   exhausts every expansion before it can answer.
 * - **Adding a feature class to the index is cheaper than it looks**, as long as
 *   its geometry is CLIPPED like everything else. The ring tests have headroom;
 *   what has none is the per-call floor.
 * - **The floor itself is the unexploited optimisation here**, and it is
 *   untouched: nothing memoises `cellToLatLng` or the disk, and the search asks
 *   about the same cells repeatedly. That is a separate piece of work and is
 *   filed rather than done.
 */
describe("crossesObstacle — the per-step cost A* actually pays", () => {
  for (const siteId of ["london-westminster", "berlin-alexanderplatz"]) {
    const index = buildObstacleIndex(features(siteId));
    const cells = [...index.cells];

    // Steps between real neighbouring cells, which is the only shape the search
    // ever asks about — `columnSpace` generates candidates from gridDisk(_, 1).
    const busy: [string, string][] = [];
    for (const cell of cells.slice(0, 400)) {
      const neighbour = gridDisk(cell, 1).find((other) => other !== cell);
      if (neighbour !== undefined) busy.push([cell, neighbour]);
    }

    // The same count of steps in genuinely EMPTY ground — the open ground that
    // dominates a real search's expansions.
    //
    // **VERIFIED EMPTY, NOT ASSUMED EMPTY, and the first version of this bench
    // got it wrong in exactly the way this repo has been caught before.** It
    // took `gridDisk(cell, 60)`, reasoning that 60 res-13 steps is far enough to
    // be off the map. It is 397 m, which in Westminster is still solidly inside
    // the extract — so both populations were the same population, and the bench
    // duly reported identical numbers for them. Identical numbers looked like a
    // finding ("the ring tests are free!") and were an artefact.
    //
    // So emptiness is now CHECKED against the index, and the surviving count is
    // printed in the bench name. `spatial-query.bench.ts` adopted the same rule
    // after a query centred on the mean of eight cities landed in open ocean.
    const isClear = (cell: string): boolean =>
      gridDisk(cell, 1).every((near) => index.obstaclesIn(near).length === 0);

    const empty: [string, string][] = [];
    for (const [cell] of busy) {
      const far = gridDisk(cell, 400).at(-1);
      if (far === undefined) continue;
      const neighbour = gridDisk(far, 1).find((other) => other !== far);
      if (neighbour === undefined) continue;
      if (!isClear(far) || !isClear(neighbour)) continue;
      empty.push([far, neighbour]);
    }

    bench(`${siteId} — ${busy.length} steps ON indexed cells`, () => {
      let blocked = 0;
      for (const [from, to] of busy) {
        if (crossesObstacle(index, from, to)) blocked++;
      }
      if (blocked < 0) throw new Error("unreachable");
    });

    bench(`${siteId} — ${empty.length} VERIFIED-clear steps`, () => {
      let blocked = 0;
      for (const [from, to] of empty) {
        if (crossesObstacle(index, from, to)) blocked++;
      }
      if (blocked < 0) throw new Error("unreachable");
    });
  }
});
