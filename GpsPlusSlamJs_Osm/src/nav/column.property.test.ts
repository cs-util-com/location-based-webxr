/**
 * Column-model property tests.
 *
 * Why these tests matter:
 * The unit tests pin the design's stated cases — the wall, the lawn beside it,
 * the boundary. These prove the algebra holds for arbitrary heights and
 * arbitrary cells, and they exist because the column rule is about to become
 * the edge relation of a graph. A pathfinder is entitled to assume its edges
 * are symmetric and that widening the climb limit never REMOVES an edge; both
 * are properties no single example can establish.
 *
 * @see column.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { latLngToCell, gridDisk } from "h3-js";
import { columnsAdjacent, STEP_THRESHOLD_M } from "./column.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";

const ORIGIN = latLngToCell(50.9413, 6.9583, AFFORDANCE_RES);

/** The origin and its six neighbours — every cell a step could reach. */
const RING = gridDisk(ORIGIN, 1);

/** Ring 2: never adjacent to the origin, however the heights line up. */
const OUTSIDE = gridDisk(ORIGIN, 2).filter((cell) => !RING.includes(cell));

/**
 * Heights that stay in a range a DEM plausibly produces, at a precision fine
 * enough to land on both sides of the threshold.
 */
const height = fc.double({
  min: -50,
  max: 200,
  noNaN: true,
  noDefaultInfinity: true,
});

const cellIn = (cells: readonly string[]) => fc.constantFrom(...cells);

const column = (cells: readonly string[]) =>
  fc.record({ cell: cellIn(cells), heightM: height });

describe("column adjacency properties", () => {
  it("is symmetric", () => {
    // A pathfinder over an UNDIRECTED graph is only correct if the edge
    // relation is genuinely undirected. If a one-way drop is ever wanted it
    // has to be a deliberate feature, not an artefact of argument order.
    fc.assert(
      fc.property(column(RING), column(RING), (a, b) => {
        expect(columnsAdjacent(a, b)).toBe(columnsAdjacent(b, a));
      }),
    );
  });

  it("is reflexive for every finite height", () => {
    fc.assert(
      fc.property(cellIn(RING), height, (cell, heightM) => {
        expect(columnsAdjacent({ cell, heightM }, { cell, heightM })).toBe(
          true,
        );
      }),
    );
  });

  it("never loses an edge when the threshold is raised", () => {
    // MONOTONICITY. A more capable agent must reach at least everywhere a less
    // capable one can. The obvious way to break this — comparing the wrong
    // pair, or letting the threshold leak into the neighbourhood test — makes
    // raising the limit disconnect something, which would be baffling to debug
    // from a route that got WORSE after a tuning change.
    fc.assert(
      fc.property(
        column(RING),
        column(RING),
        fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
        (a, b, t1, t2) => {
          const low = Math.min(t1, t2);
          const high = Math.max(t1, t2);
          // Stated as "never adjacent at the low limit but not at the high
          // one" rather than as an `if`, because a conditional `expect` can
          // silently assert NOTHING when the guard never holds — the exact
          // failure mode this branch keeps finding.
          const lost =
            columnsAdjacent(a, b, low) && !columnsAdjacent(a, b, high);
          expect(lost).toBe(false);
        },
      ),
    );
  });

  it("never joins cells outside the ring, at any height or threshold", () => {
    // The height clause must not be able to CREATE adjacency — only remove it.
    fc.assert(
      fc.property(
        column(OUTSIDE),
        height,
        fc.double({ min: 0, max: 1000, noNaN: true, noDefaultInfinity: true }),
        (far, originHeight, threshold) => {
          expect(
            columnsAdjacent(
              { cell: ORIGIN, heightM: originHeight },
              far,
              threshold,
            ),
          ).toBe(false);
        },
      ),
    );
  });

  it("agrees with the plain height comparison for every ring member", () => {
    // AN INDEPENDENT ORACLE. Every member of `gridDisk(origin, 1)` is a
    // neighbour of the origin BY CONSTRUCTION, so for those pairs adjacency is
    // exactly the height test — no appeal to the implementation's own
    // neighbourhood lookup. This catches a check that quietly excludes some
    // ring member; `gridDisk` ordering is not something to take on faith.
    //
    // The pairing is origin-to-ring rather than ring-to-ring, and that is the
    // point: two ring members need NOT be neighbours of each other — opposite
    // spokes are two steps apart. The first draft of this property assumed
    // otherwise and fast-check produced the counterexample immediately.
    fc.assert(
      fc.property(height, column(RING), (originHeight, other) => {
        expect(
          columnsAdjacent({ cell: ORIGIN, heightM: originHeight }, other),
        ).toBe(Math.abs(originHeight - other.heightM) <= STEP_THRESHOLD_M);
      }),
    );
  });

  it("severs two ring members that are not neighbours of each other", () => {
    // The flip side of the case above, and the reason it is worth stating:
    // sharing a common neighbour is NOT adjacency. A graph builder that
    // expanded "the origin's neighbourhood" into a clique would connect
    // opposite spokes across the origin, letting a path cut a corner it should
    // have walked around.
    const opposite = RING.filter(
      (cell) => cell !== ORIGIN && !gridDisk(RING[1]!, 1).includes(cell),
    );
    expect(opposite.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(fc.constantFrom(...opposite), height, (far, heightM) => {
        expect(
          columnsAdjacent({ cell: RING[1]!, heightM }, { cell: far, heightM }),
        ).toBe(false);
      }),
    );
  });
});
