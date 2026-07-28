/**
 * Why these tests matter:
 * The demo's stated job is to make the chunk grid legible, so the chunk label
 * it shows the user has to name the chunk that was actually scored. There are
 * two plausible ways to compute "the res-11 chunk this position is in" and they
 * are NOT the same function — `cellToParent` walks the H3 index hierarchy,
 * whose children are not geometrically contained by their parents
 * (`resolutions.ts` calls this out by name). Using one for scoring and the
 * other for the label produces a label that is simply wrong near a boundary,
 * which is the opposite of legible.
 *
 * @see demo-pipeline.ts.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell, cellToParent } from "h3-js";
import { AFFORDANCE_RES, SCORE_CHUNK_RES } from "gps-plus-slam-osm";
import { DemoPipeline } from "./demo-pipeline.js";

describe("chunkFor names the chunk that was actually scored", () => {
  /**
   * Positions where the index parent of the res-13 cell is NOT the res-11 cell
   * containing the point. Found by sweeping a 60-point grid over Cologne — four
   * of the first sixty disagreed, so this is the common case near a boundary
   * rather than an exotic one.
   */
  const DIVERGENT = [
    { lat: 50.9, lng: 6.905 },
    { lat: 50.9, lng: 6.9056 },
    { lat: 50.9, lng: 6.9112 },
    { lat: 50.9, lng: 6.9118 },
  ];

  it.each(DIVERGENT)(
    "returns the containing res-11 cell at ($lat, $lng)",
    (position) => {
      const containing = latLngToCell(
        position.lat,
        position.lng,
        SCORE_CHUNK_RES,
      );
      const indexParent = cellToParent(
        latLngToCell(position.lat, position.lng, AFFORDANCE_RES),
        SCORE_CHUNK_RES,
      );

      // Guards the fixture: if H3 ever made these agree here, the test below
      // would still pass while proving nothing.
      expect(containing).not.toBe(indexParent);

      expect(DemoPipeline.chunkFor(position)).toBe(containing);
    },
  );

  it("agrees with the containing cell everywhere on a sweep", () => {
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        const position = { lat: 50.9 + i * 0.0002, lng: 6.9 + j * 0.0002 };
        expect(DemoPipeline.chunkFor(position)).toBe(
          latLngToCell(position.lat, position.lng, SCORE_CHUNK_RES),
        );
      }
    }
  });
});
