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
      expect(columnsAdjacent(a, b, { stepThresholdM: 3 })).toBe(true);
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
      expect(() => columnsAdjacent(a, b, { stepThresholdM: -1 })).toThrow(
        /threshold/i,
      );
      expect(() => columnsAdjacent(a, b, { stepThresholdM: NaN })).toThrow(
        /threshold/i,
      );
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

/**
 * Terrain slope — the half of the rule that was specified and never built.
 *
 * Why these tests matter:
 * The step threshold was chosen against DISCONTINUITIES (a kerb, a stair riser,
 * a wall). In production the heights it compares are DEM samples at cell
 * centres ~6.4–6.9 m apart, so as a single absolute limit it made any ground
 * steeper than ~7.5 % impassable — and the demo reported the Cologne
 * Frankenwerft promenade as unreachable in every downhill direction while the
 * `walkable` heat map rated it highly. Every pre-existing fixture is FLAT, so
 * nothing here could see it.
 *
 * These pin the decomposition: the height ABOVE THE GROUND is a step, the
 * ground itself is a slope, and the two get different limits.
 *
 * @see ../../docs/2026-08-18-0659-nav-terrain-slope-vs-step-plan.md
 */
describe("ground slope, once the ground is known", () => {
  /** The reported grade: 0.81 m over the 6.83 m between two res-13 centres. */
  const REPORTED_RISE_M = 0.81;

  it("admits the grade that made the reported location unroutable", () => {
    // THE REGRESSION CASE, at the predicate. 0.81 m over ~6.8 m is ~12 %, which
    // is an ordinary steep street — and it was refused, because 0.81 > 0.5.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 48.51, groundM: 48.51 },
        {
          cell: NEIGHBOUR,
          heightM: 48.51 - REPORTED_RISE_M,
          groundM: 48.51 - REPORTED_RISE_M,
        },
      ),
    ).toBe(true);
  });

  it("still refuses ground too steep to walk down", () => {
    // The control, and it is what stops this becoming "slopes never block".
    // 8 m over ~7 m is ~114 %, well past MAX_GROUND_GRADIENT — a cliff face, or
    // a retaining edge the DEM does resolve.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 0, groundM: 0 },
        { cell: NEIGHBOUR, heightM: -8, groundM: -8 },
      ),
    ).toBe(false);
  });

  it("keeps a wall unclimbable however steep the hill it stands on", () => {
    // THE PROPERTY THE DECOMPOSITION EXISTS FOR. The slope allowance applies to
    // the GROUND only: an 8 m wall top in the next cell is 8 m above that
    // cell's ground whatever the hill does, so it stays refused. A single
    // distance-scaled threshold — the alternative considered in the plan —
    // would have admitted it once the allowance grew past 8 m.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 48.51, groundM: 48.51 },
        {
          cell: NEIGHBOUR,
          heightM: 48.51 - REPORTED_RISE_M + 8,
          groundM: 48.51 - REPORTED_RISE_M,
        },
      ),
    ).toBe(false);
  });

  it("keeps a kerb-sized step on a hillside climbable", () => {
    // The two limits compose rather than replace one another: a 0.2 m step up
    // onto something, on ground that is itself dropping 0.81 m, is both a legal
    // step and a legal grade.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 48.51, groundM: 48.51 },
        {
          cell: NEIGHBOUR,
          heightM: 48.51 - REPORTED_RISE_M + 0.2,
          groundM: 48.51 - REPORTED_RISE_M,
        },
      ),
    ).toBe(true);
  });

  it("gives a move within one cell no slope allowance at all", () => {
    // Distance zero, so the grade term is zero and the step rule governs alone
    // — which is exactly the design's wall case, and it must not have been
    // loosened by giving the ground a budget.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 0, groundM: 0 },
        { cell: FOOT, heightM: 8, groundM: 0 },
      ),
    ).toBe(false);
  });

  it("still walks off a wall top onto ground at the same height", () => {
    // THE READING THE GRADE ALONE WOULD HAVE LOST. An 8 m wall top beside a
    // terrace whose own ground is 8 m up: the agent moves horizontally between
    // two surfaces at the same height, and what the ground does far below
    // either of them is not its problem. A rule that only compared grounds
    // would have refused this — an edge that exists today — so the predicate
    // admits a step that EITHER reading accepts.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 8, groundM: 0 },
        { cell: NEIGHBOUR, heightM: 8, groundM: 8 },
      ),
    ).toBe(true);
  });

  it("keeps the absolute rule when either state has no ground", () => {
    // BACKWARDS COMPATIBILITY IS THE POINT OF THE FIELD BEING OPTIONAL. A
    // caller with no notion of a ground surface — every fixture in this
    // package before this change — must get exactly the rule it had.
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 0 },
        { cell: NEIGHBOUR, heightM: REPORTED_RISE_M },
      ),
    ).toBe(false);
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: 0, groundM: 0 },
        { cell: NEIGHBOUR, heightM: REPORTED_RISE_M },
      ),
    ).toBe(false);
  });

  it("takes a caller-supplied gradient", () => {
    const a = { cell: FOOT, heightM: 0, groundM: 0 };
    const b = { cell: NEIGHBOUR, heightM: -8, groundM: -8 };
    expect(columnsAdjacent(a, b)).toBe(false);
    expect(columnsAdjacent(a, b, { maxGroundGradient: 2 })).toBe(true);
  });

  it("falls back to the absolute rule when a ground height is not finite", () => {
    // A DEM MISS IS A MISSING GROUND, NOT A MISSING HEIGHT. The two states are
    // still at known heights, so the surface-to-surface reading is still
    // answerable — what is lost is only the ability to tell a hillside from a
    // wall, which is exactly the situation an absent `groundM` describes.
    const level = { cell: NEIGHBOUR, heightM: 0, groundM: 0 };
    expect(
      columnsAdjacent({ cell: FOOT, heightM: 0, groundM: NaN }, level),
    ).toBe(true);
    expect(
      columnsAdjacent(
        { cell: FOOT, heightM: REPORTED_RISE_M, groundM: NaN },
        level,
      ),
    ).toBe(false);
  });

  it("refuses a gradient that is not a finite, non-negative number", () => {
    const a = { cell: FOOT, heightM: 0, groundM: 0 };
    const b = { cell: NEIGHBOUR, heightM: 0, groundM: 0 };
    expect(() => columnsAdjacent(a, b, { maxGroundGradient: -1 })).toThrow(
      /gradient/i,
    );
    expect(() => columnsAdjacent(a, b, { maxGroundGradient: NaN })).toThrow(
      /gradient/i,
    );
  });
});
