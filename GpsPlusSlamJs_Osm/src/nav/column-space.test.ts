/**
 * The column model as a searchable state space.
 *
 * Why these tests matter:
 * Review on #257 found that the first pass A "collapses the column model back
 * to 2D" — its visited set was keyed by cell, so the wall foot and the wall top
 * could not both exist in one search, and its predicate saw only cell strings,
 * so it had to resolve one height per cell. The test that claimed to wire the
 * two together proved only that `columnsAdjacent` TYPE-CHECKS as a step
 * predicate.
 *
 * These are the tests that would have caught that. The load-bearing one is
 * "holds the wall foot and the wall top at once": under the old composition it
 * is not merely failing, it is inexpressible.
 *
 * @see column-space.ts.md
 */

import { describe, expect, it } from "vitest";
import { latLngToCell, gridDisk, gridDistance, gridRingUnsafe } from "h3-js";

import { columnSpace, columnKey } from "./column-space.js";
import { STEP_THRESHOLD_M, type Column } from "./column.js";
import { findStatePath, reachableStates } from "./search.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";

const ORIGIN = latLngToCell(50.9413, 6.9583, AFFORDANCE_RES);
const FIELD = new Set(gridDisk(ORIGIN, 6));

/** A closed wall around the origin at ring 3, with one gap. */
const RING_3 = gridRingUnsafe(ORIGIN, 3);
const GATE = RING_3[0]!;
const WALL = new Set(RING_3.filter((cell) => cell !== GATE));

/** Outside the wall, on the far side. */
const OUTSIDE = gridRingUnsafe(ORIGIN, 5)[8]!;

/** The wall's height — the design's own figure. */
const WALL_HEIGHT_M = 8;

/**
 * The level model: flat ground everywhere, and a wall cell ALSO offers its top.
 *
 * Two levels in one cell is the entire subject of this file. A cell inside
 * `WALL` is standable at 0 (the ground beside the wall) and at 8 (the walkway
 * on top of it).
 */
const levelsAt = (cell: string): readonly number[] => {
  if (!FIELD.has(cell)) return [];
  return WALL.has(cell) ? [0, WALL_HEIGHT_M] : [0];
};

const space = columnSpace({ levelsAt });

const at = (cell: string, heightM: number): Column => ({ cell, heightM });
const isCell = (cell: string) => (state: Column) => state.cell === cell;

describe("columnKey", () => {
  it("separates two states in the same cell", () => {
    // THE FIX, STATED AT ITS SMALLEST. A cell-keyed search made these one
    // entry, which is why the wall foot and the wall top could not coexist.
    expect(columnKey(at(ORIGIN, 0))).not.toBe(columnKey(at(ORIGIN, 8)));
  });

  it("gives the same key to heights that differ below a millimetre", () => {
    // FLOATS ARE NOT IDENTITIES. Heights come from a DEM interpolation, so two
    // samples of one physical surface can differ in the last bits. Without
    // quantisation the search would revisit the same ground indefinitely.
    expect(columnKey(at(ORIGIN, 3))).toBe(columnKey(at(ORIGIN, 3 + 1e-9)));
  });

  it("keeps distinctions the step threshold can still see", () => {
    // The quantisation must not erase a difference that matters: a millimetre
    // is three orders of magnitude below the threshold.
    expect(columnKey(at(ORIGIN, 0))).not.toBe(
      columnKey(at(ORIGIN, STEP_THRESHOLD_M)),
    );
  });
});

describe("the column state space", () => {
  it("holds the wall foot and the wall top at once", () => {
    // THE CASE THE OLD SEAM COULD NOT EXPRESS. Not "fails" — inexpressible: a
    // cell-keyed visited set has one slot per cell.
    const wallCell = [...WALL][0]!;
    const reached = reachableStates(at(ORIGIN, 0), space);

    expect(reached.has(columnKey(at(wallCell, 0)))).toBe(true);
    expect(reached.has(columnKey(at(wallCell, WALL_HEIGHT_M)))).toBe(false);
  });

  it("generates a state for EVERY level of a cell, not just the first", () => {
    // MUTATION TESTING FOUND THIS GAP. Truncating `levelsAt` to its first
    // entry — collapsing the space back to a heightfield, the exact #257
    // defect in its other form — left the test above passing, because it only
    // ever asserted about the reachable level. Nothing checked that the second
    // state was generated at all.
    const wallCell = [...WALL][0]!;
    const neighbour = gridDisk(wallCell, 1).find(
      (cell) => cell !== wallCell && !WALL.has(cell) && FIELD.has(cell),
    )!;

    const levels = [...space.candidates(at(neighbour, 0))]
      .filter((state) => state.cell === wallCell)
      .map((state) => state.heightM)
      .sort((a, b) => a - b);

    expect(levels).toEqual([0, WALL_HEIGHT_M]);
  });

  it("refuses to climb the wall from its own foot", () => {
    // `columnsAdjacent(foot, top)` with ONE cell — the example in
    // `column.ts.md`, and the step the old composition could never even ask
    // about, because `from` and `to` were never the same cell.
    const wallCell = [...WALL][0]!;
    expect(space.canEnter!(at(wallCell, 0), at(wallCell, WALL_HEIGHT_M))).toBe(
      false,
    );
  });

  it("allows a step between levels of one cell when it is low enough", () => {
    // The counterweight: a kerb inside a cell is climbable, and a rule that
    // severed every same-cell level change would be as wrong as one that
    // severed none.
    const lowStep = columnSpace({
      levelsAt: (cell) => (FIELD.has(cell) ? [0, 0.3] : []),
    });
    expect(lowStep.canEnter!(at(ORIGIN, 0), at(ORIGIN, 0.3))).toBe(true);
  });

  it("routes THROUGH a same-cell level change when that is the only way", () => {
    // MUTATION TESTING FOUND THIS GAP TOO. The test above calls `canEnter`
    // directly, so removing the cell itself from its own candidate list left
    // it passing — the move was legal but the search could never propose it.
    //
    // THE ORIGIN SITS AT -0.5, and that is what makes the step load-bearing.
    // The first draft put it at 0, from which the landing's upper level was
    // directly enterable — so the route skipped the in-place step and the test
    // proved nothing. Offset, the arithmetic leaves exactly one way through:
    //
    //   origin@-0.5 → landing@0     0.5 — legal, just
    //   origin@-0.5 → landing@0.4   0.9 — refused
    //   landing@0   → far@0.8       0.8 — refused
    //   landing@0   → landing@0.4   0.4 — legal, and the only remaining move
    const landing = gridRingUnsafe(ORIGIN, 1)[0]!;
    const far = gridDisk(landing, 1).find(
      (cell) => gridDistance(ORIGIN, cell) === 2,
    )!;

    const stepped = columnSpace({
      levelsAt: (cell) => {
        if (cell === ORIGIN) return [-0.5];
        if (cell === landing) return [0, 0.4];
        if (cell === far) return [0.8];
        return [];
      },
    });

    const path = findStatePath(at(ORIGIN, -0.5), isCell(far), stepped);

    expect(path).toBeDefined();
    // Both levels of the landing appear, which is what "changed level in
    // place" looks like in a route.
    expect(path!.filter((state) => state.cell === landing)).toHaveLength(2);
    expect(path!.at(-1)).toEqual(at(far, 0.8));
  });

  it("generates no state for a cell with no standable level", () => {
    // An empty `levelsAt` is how "inside a building" and "off the working set"
    // are said. A cell with no levels must produce no candidates rather than a
    // state at height zero.
    const enclosed = columnSpace({ levelsAt: () => [] });
    expect([...enclosed.candidates(at(ORIGIN, 0))]).toEqual([]);
  });
});

describe("routing with the column model", () => {
  it("routes around the wall through the gate", () => {
    // THE DESIGN'S TEST CASE, END TO END. The wall is a HEIGHT, not a hole:
    // every wall cell is standable at ground level. The only thing stopping
    // the agent crossing is that its ground is 8 m up.
    const wallAsHeight = columnSpace({
      levelsAt: (cell) => {
        if (!FIELD.has(cell)) return [];
        return WALL.has(cell) ? [WALL_HEIGHT_M] : [0];
      },
    });

    const path = findStatePath(at(ORIGIN, 0), isCell(OUTSIDE), wallAsHeight);

    expect(path).toBeDefined();
    expect(path!.map((s) => s.cell)).toContain(GATE);
    // AND NEVER OVER THE WALL. The assertion that fails for a search which
    // ignores the height clause but still arrives.
    for (const state of path!) {
      expect(WALL.has(state.cell), `${state.cell}@${state.heightM}`).toBe(
        false,
      );
    }
  });

  it("finds no route when the wall has no gate", () => {
    const sealed = columnSpace({
      levelsAt: (cell) => {
        if (!FIELD.has(cell)) return [];
        return RING_3.includes(cell) ? [WALL_HEIGHT_M] : [0];
      },
    });
    expect(
      findStatePath(at(ORIGIN, 0), isCell(OUTSIDE), sealed),
    ).toBeUndefined();
  });

  it("walks over the wall once the agent can climb it", () => {
    // THE CONTROL. If the route went through the gate even for an agent that
    // can climb 8 m, the detour above would not be evidence of the height
    // clause — it would just be what this fixture always does.
    // `WALL`, not `RING_3` — the gate has to stay at ground level or there is
    // no detour to compare against, only a sealed ring. The first draft of
    // this test used `RING_3` and got `undefined`, which is the fixture
    // failing rather than the code.
    const levels = (cell: string): readonly number[] =>
      !FIELD.has(cell) ? [] : WALL.has(cell) ? [WALL_HEIGHT_M] : [0];

    const climber = columnSpace({
      levelsAt: levels,
      stepThresholdM: WALL_HEIGHT_M + 1,
    });

    const path = findStatePath(at(ORIGIN, 0), isCell(OUTSIDE), climber)!;
    expect(path.some((state) => WALL.has(state.cell))).toBe(true);

    // And it is shorter than the detour, which is why an agent would take it.
    const detour = findStatePath(
      at(ORIGIN, 0),
      isCell(OUTSIDE),
      columnSpace({ levelsAt: levels }),
    )!;
    expect(path.length).toBeLessThan(detour.length);
  });

  it("returns a route whose every step is a legal column move", () => {
    const path = findStatePath(
      at(ORIGIN, 0),
      isCell(OUTSIDE),
      columnSpace({
        levelsAt: (cell) =>
          !FIELD.has(cell) ? [] : WALL.has(cell) ? [WALL_HEIGHT_M] : [0],
      }),
    )!;

    for (let i = 1; i < path.length; i++) {
      expect(space.canEnter!(path[i - 1]!, path[i]!)).toBe(true);
    }
  });
});
