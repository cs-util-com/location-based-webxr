/**
 * The column model — `(cell, heightM)` adjacency.
 *
 * Why these tests matter:
 * The navigation design names this its **highest-risk assumption** and says it
 * "should be tested before anything is built on it". The reason is concrete: an
 * agent on top of the Tower wall and an agent at its foot occupy the SAME H3
 * cell, so a 2D reachability pass cannot tell them apart and a naive merge lets
 * them path to each other. These tests pin the rule that makes them distinct.
 *
 * The design's own test case is here verbatim — two states in one cell column
 * 8 m apart, asserted non-adjacent. The other half of that case (that a path
 * routes to the gate instead of over the wall) needs the pass-A graph and
 * lives with it.
 *
 * @see column.ts.md
 * @see ../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-08-04-0812-osm-npc-navigation-design.md
 */

import { describe, it, expect } from "vitest";
import { latLngToCell, gridDisk } from "h3-js";
import { columnsAdjacent, STEP_THRESHOLD_M } from "./column.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";

const TOWER = { lat: 50.9413, lng: 6.9583 };
const FOOT = latLngToCell(TOWER.lat, TOWER.lng, AFFORDANCE_RES);

/** A cell sharing an edge with `FOOT`. `gridDisk` puts the origin first. */
const NEIGHBOUR = gridDisk(FOOT, 1)[1]!;

/** Far enough that no ring-1 relationship can exist. */
const DISTANT = latLngToCell(TOWER.lat + 0.01, TOWER.lng, AFFORDANCE_RES);

describe("the column model", () => {
  it("separates the wall top from the wall foot in the same cell", () => {
    // THE DESIGN'S OWN CASE. 8 m is the curtain wall; the two states share a
    // cell and differ only in height. If this passes trivially the whole
    // two-pass split is unfounded.
    expect(
      columnsAdjacent({ cell: FOOT, heightM: 0 }, { cell: FOOT, heightM: 8 }),
    ).toBe(false);
  });

  it("joins two states in one cell that are within a step of each other", () => {
    // The counterweight to the case above: the rule must not sever a cell from
    // itself just because two height samples disagree slightly. A test that
    // only asserted the negative would pass for a function that always
    // returns false.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 0 },
        { cell: FOOT, heightM: STEP_THRESHOLD_M / 2 },
      ),
    ).toBe(true);
  });

  it("joins neighbouring cells at a walkable height change", () => {
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 12.0 },
        { cell: NEIGHBOUR, heightM: 12.0 + STEP_THRESHOLD_M / 2 },
      ),
    ).toBe(true);
  });

  it("severs neighbouring cells across an unclimbable rise", () => {
    // Lawn beside a wall: the cells are adjacent, the ground is not. This is
    // the case that forces a path around rather than over.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 0 },
        { cell: NEIGHBOUR, heightM: 8 },
      ),
    ).toBe(false);
  });

  it("never joins cells that are not neighbours, whatever their heights", () => {
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 3 },
        { cell: DISTANT, heightM: 3 },
      ),
    ).toBe(false);
  });

  it("treats a state as adjacent to itself", () => {
    // `gridDisk(cell, 1)` includes its origin, and this rule is defined in
    // terms of that same neighbourhood — the one `connectedComponents` already
    // uses. Graph construction skips self-edges; the predicate does not have
    // to.
    const state = { cell: FOOT, heightM: 4 };
    expect(columnsAdjacent(state, state)).toBe(true);
  });

  describe("the step threshold", () => {
    it("admits a rise exactly at the threshold", () => {
      // The boundary is inclusive, and it is asserted rather than left to
      // whichever comparison operator got typed. A stair riser at exactly the
      // limit should be climbable, not a coin flip.
      expect(
        columnsAdjacent(
          { cell: FOOT, heightM: 0 },
          { cell: NEIGHBOUR, heightM: STEP_THRESHOLD_M },
        ),
      ).toBe(true);
    });

    it("rejects a rise just past the threshold", () => {
      expect(
        columnsAdjacent(
          { cell: FOOT, heightM: 0 },
          { cell: NEIGHBOUR, heightM: STEP_THRESHOLD_M * 1.001 },
        ),
      ).toBe(false);
    });

    it("takes a caller-supplied threshold", () => {
      // The constant is a default, not a hard-coded law: the design leaves the
      // exact value open (Q1) and a caller tuning it must not have to fork the
      // predicate.
      const a = { cell: FOOT, heightM: 0 };
      const b = { cell: NEIGHBOUR, heightM: 2 };
      expect(columnsAdjacent(a, b)).toBe(false);
      expect(columnsAdjacent(a, b, 3)).toBe(true);
    });
  });

  describe("defensive behaviour at the module boundary", () => {
    // Heights come from a DEM lookup that can miss, and a missing sample is
    // NaN rather than an exception. `NaN > threshold` is false, so a naive
    // comparison would silently declare an UNKNOWN height walkable — the worst
    // of the two failure modes, because it invents connectivity.
    it("refuses a state whose height is not a finite number", () => {
      const known = { cell: FOOT, heightM: 0 };
      expect(columnsAdjacent(known, { cell: FOOT, heightM: NaN })).toBe(false);
      expect(columnsAdjacent({ cell: FOOT, heightM: NaN }, known)).toBe(false);
      expect(
        columnsAdjacent(known, { cell: NEIGHBOUR, heightM: Infinity }),
      ).toBe(false);
    });

    it("refuses a threshold that is not a finite, non-negative number", () => {
      const a = { cell: FOOT, heightM: 0 };
      const b = { cell: NEIGHBOUR, heightM: 0 };
      expect(() => columnsAdjacent(a, b, -1)).toThrow(/threshold/i);
      expect(() => columnsAdjacent(a, b, NaN)).toThrow(/threshold/i);
    });

    it("refuses two cells at different resolutions", () => {
      // `gridDisk` on a res-13 origin never yields a res-8 cell, so a mixed
      // pair would quietly come back non-adjacent and read as "there is no
      // route" rather than "the caller mixed resolutions".
      const coarse = latLngToCell(TOWER.lat, TOWER.lng, 8);
      expect(() =>
        columnsAdjacent(
          { cell: FOOT, heightM: 0 },
          { cell: coarse, heightM: 0 },
        ),
      ).toThrow(/resolution/i);
    });
  });
});
