/**
 * Resolution-ladder tests.
 *
 * Why these tests matter:
 * Every other module in this package reads its resolutions from here, so a
 * silent change to one of these constants would mis-key the cache, mis-size the
 * working set, or blow the per-chunk frame budget — all of which surface far
 * from the cause. These tests pin the constants against h3-js's OWN grid
 * metrics rather than against hardcoded numbers copied from a doc, so if a
 * future h3-js release ever moved the grid the failure lands here instead of
 * silently shifting the whole package.
 *
 * @see resolutions.ts.md
 */

import { describe, it, expect } from "vitest";
import {
  getHexagonEdgeLengthAvg,
  getHexagonAreaAvg,
  cellToChildren,
  latLngToCell,
  UNITS,
} from "h3-js";
import {
  FETCH_RES,
  SCORE_CHUNK_RES,
  AFFORDANCE_RES,
  FETCH_DISK_RADIUS,
  SCORE_DISK_RADIUS,
  RES13_CELLS_PER_CHUNK,
  AFFORDANCE_CELL_AREA_M2,
  toFetchTile,
  toScoreChunk,
  fetchWorkingSet,
  scoreWorkingSet,
} from "./resolutions.js";

// A dense, well-mapped European location (Cologne) used as the canonical
// reference point throughout this package's tests.
const COLOGNE = { lat: 50.9413, lng: 6.9583 };

describe("the resolution ladder is ordered and whole-levelled", () => {
  it("goes coarse -> fine: fetch < chunk < affordance", () => {
    expect(FETCH_RES).toBeLessThan(SCORE_CHUNK_RES);
    expect(SCORE_CHUNK_RES).toBeLessThan(AFFORDANCE_RES);
  });

  it("steps by whole levels, which is what makes parent/child round-trip exactly", () => {
    expect(Number.isInteger(SCORE_CHUNK_RES - FETCH_RES)).toBe(true);
    expect(Number.isInteger(AFFORDANCE_RES - SCORE_CHUNK_RES)).toBe(true);
  });
});

describe("the constants match h3-js grid metrics", () => {
  // AREAS. These are the figures the plan quotes and they are correct.
  it("res 8 is the ~0.737 km2 fetch tile", () => {
    expect(getHexagonAreaAvg(FETCH_RES, UNITS.km2)).toBeCloseTo(0.737, 2);
  });

  it("res 11 is the ~2150 m2 score chunk", () => {
    expect(getHexagonAreaAvg(SCORE_CHUNK_RES, UNITS.m2)).toBeCloseTo(2149.6, 0);
  });

  it("res 13 is the ~43.9 m2 affordance cell", () => {
    expect(getHexagonAreaAvg(AFFORDANCE_RES, UNITS.m2)).toBeCloseTo(
      AFFORDANCE_CELL_AREA_M2,
      0,
    );
  });

  // EDGE LENGTHS. These are the figures the plan gets WRONG, and this block is
  // the executable record of why.
  //
  // The plan quotes 461.35 m / 24.91 m / 3.56 m for res 8 / 11 / 13. Those come
  // from the H3 documentation table as it read before H3 v4.1, and they are
  // ~13% too small. h3-js 4.4 reports 531.41 m / 28.66 m / 4.09 m, and the
  // cross-check below shows the newer numbers are the self-consistent ones:
  // for a regular hexagon of area A the edge is sqrt(2A / (3*sqrt(3))), and
  // that derivation agrees with h3-js to within 0.3%, while disagreeing with
  // the plan's figures by ~13%.
  //
  // This matters beyond bookkeeping: "how far across is a fetch tile" drives
  // the terrain-tile budget in the plan's §7 (a res-8 cell is ~1.06 km across,
  // not ~0.92 km).
  const edgeFromArea = (res: number) =>
    Math.sqrt((2 * getHexagonAreaAvg(res, UNITS.m2)) / (3 * Math.sqrt(3)));

  it.each([
    { res: FETCH_RES, h3Edge: 531.41, planEdge: 461.35 },
    { res: SCORE_CHUNK_RES, h3Edge: 28.66, planEdge: 24.91 },
    { res: AFFORDANCE_RES, h3Edge: 4.09, planEdge: 3.56 },
  ])(
    "res $res edge is $h3Edge m (h3-js), not the plan's stale $planEdge m",
    ({ res, h3Edge, planEdge }) => {
      const actual = getHexagonEdgeLengthAvg(res, UNITS.m);
      const derived = edgeFromArea(res);
      const relErr = (v: number) => Math.abs(v - derived) / derived;

      expect(actual).toBeCloseTo(h3Edge, 1);
      // The newer value is geometrically consistent with the area...
      expect(relErr(actual)).toBeLessThan(0.005);
      // ...and the plan's value is not, by an order of magnitude more.
      expect(relErr(planEdge)).toBeGreaterThan(0.1);
    },
  );
});

describe("child counts — why scoring is never eager over a fetch tile", () => {
  it("one res-11 chunk holds 49 res-13 cells (7^2)", () => {
    const chunk = latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES);
    expect(cellToChildren(chunk, AFFORDANCE_RES)).toHaveLength(
      RES13_CELLS_PER_CHUNK,
    );
    expect(RES13_CELLS_PER_CHUNK).toBe(7 ** (AFFORDANCE_RES - SCORE_CHUNK_RES));
  });

  it("one res-8 tile holds ~16,807 res-13 cells (7^5) — the reason for lazy scoring", () => {
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    expect(cellToChildren(tile, AFFORDANCE_RES)).toHaveLength(
      7 ** (AFFORDANCE_RES - FETCH_RES),
    );
  });
});

describe("working sets", () => {
  it("the fetch working set is the centre tile plus one ring = 7 tiles", () => {
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    const set = fetchWorkingSet(tile);
    expect(set).toHaveLength(
      1 + 3 * FETCH_DISK_RADIUS * (FETCH_DISK_RADIUS + 1),
    );
    expect(set).toHaveLength(7);
    expect(set).toContain(tile);
  });

  it("the score working set is the centre chunk plus two rings = 19 chunks", () => {
    const chunk = latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES);
    const set = scoreWorkingSet(chunk);
    expect(set).toHaveLength(
      1 + 3 * SCORE_DISK_RADIUS * (SCORE_DISK_RADIUS + 1),
    );
    expect(set).toHaveLength(19);
    expect(set).toContain(chunk);
  });

  it("19 chunks x 49 cells = the 931 res-13 cells the plan budgets for", () => {
    expect(19 * RES13_CELLS_PER_CHUNK).toBe(931);
  });
});

describe("coarsening", () => {
  it("toFetchTile agrees with a direct res-8 lookup of the same position", () => {
    const fine = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    expect(toFetchTile(fine)).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES),
    );
  });

  it("toScoreChunk agrees with a direct res-11 lookup of the same position", () => {
    const fine = latLngToCell(COLOGNE.lat, COLOGNE.lng, AFFORDANCE_RES);
    expect(toScoreChunk(fine)).toBe(
      latLngToCell(COLOGNE.lat, COLOGNE.lng, SCORE_CHUNK_RES),
    );
  });

  it('throws a NAMED error when asked to "coarsen" to a finer resolution', () => {
    // h3-js throws a generic message here; we want the failure to say what the
    // caller actually did wrong, because this is the shape of the
    // string-truncation bug the module docs warn about.
    const coarse = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    expect(() => toScoreChunk(coarse)).toThrow(/only coarsens/);
  });

  it("is a no-op when the cell is already at the target resolution", () => {
    const tile = latLngToCell(COLOGNE.lat, COLOGNE.lng, FETCH_RES);
    expect(toFetchTile(tile)).toBe(tile);
  });
});
