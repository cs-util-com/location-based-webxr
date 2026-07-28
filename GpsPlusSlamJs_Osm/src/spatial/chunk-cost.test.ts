/**
 * Per-chunk indexing cost — Iteration 4's own gate.
 *
 * Why these tests matter:
 * The plan sets a hard budget: **"If a res-11 chunk takes more than ~10 ms, stop
 * and re-plan — this is the hot path."** 10 ms is over half an AR frame, so
 * blowing it is world-lock failure the user can see, not a slow build.
 *
 * This measures against the real fixtures rather than synthetic shapes, because
 * what costs time is the shape of actual OSM data: a single way in the
 * street-corner fixture has 1179 positions, and a coastal relation can dominate
 * a whole tile.
 *
 * **Timings are reported, and only a generous ceiling is asserted.** A tight
 * assertion on wall-clock in CI is a flake generator; the number in the output
 * is what a human should read, and the ceiling only catches an order-of-magnitude
 * regression.
 *
 * MEASURED 2026-07-28 on the development machine (desktop, Node):
 *
 *   beach           1 feature  |  528 cells |   528 entries | 2.77 ms/chunk
 *   park           85 features |  882 cells |  1767 entries | 3.01 ms/chunk
 *   street-corner 227 features |  877 cells |  1849 entries | 3.11 ms/chunk
 *   building-block 242 features |  931 cells |  3240 entries | 8.72 ms/chunk
 *
 * **The dense-city case is at ~87 % of the 10 ms budget on a desktop.** A phone
 * is slower. That does not fail the gate, but it does settle an open question:
 * §4.2's Web Worker requirement is load-bearing rather than precautionary, and
 * there is no headroom to do this on the render thread.
 *
 * @see cell-coverage.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell } from "h3-js";
import { buildFeatureIndex, indexEntryCount } from "./h3-feature-index.js";
import {
  AFFORDANCE_RES,
  SCORE_CHUNK_RES,
  scoreWorkingSet,
  toFetchTile,
} from "./resolutions.js";
import { cellsOfChunks } from "./chunk-cells.js";
import { parseOverpassJson } from "../model/overpass-parser.js";
import { loadAllFixtures } from "../test-utils/load-fixtures.js";

const fixtures = loadAllFixtures();

describe("indexing one res-11 working set stays inside the frame budget", () => {
  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s",
    (name, fixture) => {
      const parsed = parseOverpassJson(fixture.payload);
      expect(parsed.features.length).toBeGreaterThan(0);

      // Centre the working set on the fixture's own data, so the measurement is
      // of real density rather than of empty ground.
      const first = parsed.features[0]!;
      const anchor =
        first.type === "node"
          ? first.position
          : first.type === "way"
            ? first.geometry[0]!
            : (first.members[0]?.geometry?.[0] ??
              first.members[0]?.position ?? { lat: 0, lng: 0 });

      const chunk = latLngToCell(anchor.lat, anchor.lng, SCORE_CHUNK_RES);
      const cells = cellsOfChunks(scoreWorkingSet(chunk));

      const started = performance.now();
      const index = buildFeatureIndex(parsed.features, { restrictTo: cells });
      const elapsed = performance.now() - started;

      const perChunk = elapsed / scoreWorkingSet(chunk).length;
      console.info(
        `${name}: ${parsed.features.length} features -> ${index.byCell.size} cells, ` +
          `${indexEntryCount(index)} entries, ${elapsed.toFixed(1)} ms for 19 chunks ` +
          `(${perChunk.toFixed(2)} ms/chunk)`,
      );

      // Generous: an order-of-magnitude regression fails, ordinary variance
      // does not. The real signal is the printed number.
      expect(perChunk).toBeLessThan(100);
    },
    30_000,
  );
});

describe("the working set is the right size to reason about", () => {
  it("is 19 chunks and ~931 affordance cells", () => {
    const chunk = latLngToCell(50.9413, 6.9583, SCORE_CHUNK_RES);
    const chunks = scoreWorkingSet(chunk);
    const cells = cellsOfChunks(chunks);

    expect(chunks).toHaveLength(19);
    expect(cells.length).toBe(19 * 49);
  });

  it("spans at most a handful of fetch tiles", () => {
    // Ties the cost story back to the fetch story: one working set is 1-3
    // network requests, not 19.
    const chunk = latLngToCell(50.9413, 6.9583, SCORE_CHUNK_RES);
    const tiles = new Set(scoreWorkingSet(chunk).map((c) => toFetchTile(c)));
    expect(tiles.size).toBeLessThanOrEqual(3);
  });

  it("enumerating a whole FETCH tile would be 126x more work — hence restrictTo", () => {
    // 7^6 = 117,649 res-13 cells in a res-7 tile against 931 in a working set.
    // This is the arithmetic behind "scoring must never be eager over a fetch
    // tile", stated as a test so the ratio cannot drift unnoticed.
    const perFetchTile = 7 ** (AFFORDANCE_RES - 7);
    const perWorkingSet = 19 * 49;
    expect(perFetchTile).toBe(117_649);
    expect(Math.round(perFetchTile / perWorkingSet)).toBe(126);
  });
});
