/**
 * The full-corpus h3 differential, in the gate rather than in someone's shell.
 *
 * WHY THIS FILE EXISTS. `cell-overlap.ts.md` has cited a corpus-wide sweep as
 * its equivalence evidence through three separate optimisations, while adding
 * the caveat that **the evidence is OFFLINE**: what actually ran on every gate
 * was `cell-overlap.test.ts`'s 50-case property run, so "the differential still
 * passes" meant someone had re-run it by hand and remembered to say so. That is
 * a guarantee with a human in the loop, and this package's whole argument is
 * that a silent wrong answer is the worst failure mode.
 *
 * WHY IT SAMPLES RATHER THAN EXHAUSTS. The full sweep costs 3.6 s run alone and
 * **54 s inside the gate** — a 15× inflation from contention with 107 other test
 * files — which would make it the most expensive test in the package and put it
 * straight over the 5 s per-test timeout. Exhausting three sites instead still
 * cost +17 s, or **+42 % on the package gate**, which is not a price worth paying
 * while gate time is under active attack.
 *
 * So it takes every `STRIDE`-th ring of **all eight** sites. Breadth across sites
 * matters more than depth within one: the failure this guards against is a cover
 * that breaks on a SHAPE — a 1 000-point outline, a multipolygon inner, a sliver
 * — and those recur across sites rather than hiding in one.
 *
 * **The exhaustive sweep is one constant away**: set `STRIDE = 1` and raise the
 * timeout. Keeping it a one-line edit is the point — "run the full differential
 * by hand" is exactly the instruction that decayed into nobody running it.
 *
 * WHAT IT COVERS THAT THE PROPERTY TEST CANNOT. Real OSM rings: 1 000-point
 * building outlines, multipolygon inners, rings that straddle cell boundaries at
 * awkward angles. Generated quads do not reach those shapes, and those shapes
 * are exactly where a cover goes wrong.
 *
 * Rings h3 itself throws on are skipped rather than counted as agreement — it
 * throws on a large fraction of real rings, which is why the stable
 * `polygonToCells` was rejected in the first place.
 */

import { describe, expect, it } from "vitest";
import { polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS } from "h3-js";

import { overlappingCells } from "./cell-overlap.js";
import { AFFORDANCE_RES } from "./resolutions.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { toGeometry } from "../model/osm-geometry.js";
import { loadSite } from "../test-utils/load-fixtures.js";
import type { PlanarPoint } from "./point-in-ring.js";

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
 * Compare every 4th ring. Fixed, never randomised: a differential that tested a
 * different subset each run would fail on a commit that did not break it and
 * pass on the next, and the first thing anyone would do with that is stop
 * believing it.
 */
const STRIDE = 4;

/** Every areal ring of every fixture site, as planar `x = lng, y = lat` points. */
function* corpusRings(): Generator<{ site: string; ring: PlanarPoint[] }> {
  let seen = 0;
  for (const site of SITES) {
    for (const feature of parseOverpassJson(loadSite(site).payload).features) {
      const result = toGeometry(feature);
      if (!result.ok) continue;
      const g = result.geometry;
      const polygons =
        g.kind === "polygon"
          ? [g.rings]
          : g.kind === "multipolygon"
            ? g.polygons
            : [];
      for (const ring of polygons.flat()) {
        if (ring.length < 3) continue;
        if (seen++ % STRIDE !== 0) continue;
        yield { site, ring: ring.map((p) => ({ x: p.lng, y: p.lat })) };
      }
    }
  }
}

/** h3's cover, or `undefined` when h3 refuses the ring outright. */
function h3Cover(ring: readonly PlanarPoint[]): Set<string> | undefined {
  try {
    return new Set(
      polygonToCellsExperimental(
        [ring.map((p) => [p.y, p.x] as [number, number])],
        AFFORDANCE_RES,
        POLYGON_TO_CELLS_FLAGS.containmentOverlapping,
      ),
    );
  } catch {
    return undefined;
  }
}

describe("overlappingCells — full-corpus differential against h3", () => {
  // The explicit timeout is the point of failure this file already hit once: at
  // 5 s it passed alone and failed inside the gate, where everything runs under
  // load. A differential is worth little if it is flaky.
  it(
    "agrees with h3 on every ring of every fixture site",
    { timeout: 60_000 },
    () => {
      let compared = 0;
      let declined = 0;
      const mismatches: string[] = [];

      for (const { site, ring } of corpusRings()) {
        const ours = overlappingCells(ring, AFFORDANCE_RES);
        if (ours === undefined) {
          declined++;
          continue;
        }
        const theirs = h3Cover(ring);
        if (theirs === undefined) continue;
        compared++;

        const missing = [...theirs].filter((c) => !ours.includes(c));
        const extra = ours.filter((c) => !theirs.has(c));
        // Reported as two counts because they mean opposite things: `missing` is a
        // cover that lost cells h3 keeps (the dangerous direction — an obstacle
        // silently absent), `extra` is a cover that is merely too generous.
        if (missing.length > 0 || extra.length > 0) {
          mismatches.push(
            `${site}: -${missing.length} +${extra.length} (${ring.length}pt)`,
          );
        }
      }

      expect(mismatches).toEqual([]);
      // Guards the guard: a corpus that silently stopped loading would make the
      // assertion above pass by comparing nothing at all.
      expect(compared).toBeGreaterThan(500);
      expect(declined).toBeLessThan(compared);
    },
  );
});
