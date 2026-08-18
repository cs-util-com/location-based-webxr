/**
 * Weighted-search property tests (DEC-R13-1).
 *
 * Why these tests matter:
 * `search.test.ts` proves optimality on grids somebody designed. These generate
 * the weights, and they check the two things every caller of `findCheapestPath`
 * is entitled to assume:
 *
 * - **the path is real** — connected, legal at every step, and ending at the
 *   goal. Stage 1 replaces the search the ninth session praised for going round
 *   barriers, and `canEnter` is the only way that behaviour reaches the search;
 * - **the path is the CHEAPEST** — checked against an oracle that shares no code
 *   with A\*. Returning *a* route is easy; a priority slip, an early goal test,
 *   or settling a state that could still improve all leave a search that still
 *   arrives, just by a dearer way. No single example reliably catches that, and
 *   an early goal test in particular only shows up when the first touch of the
 *   goal is not along the cheapest route — which needs the right weights, not
 *   the right shape.
 *
 * @see search.ts.md
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { findCheapestPath, type StateSpace } from "./search.js";

const SIDE = 5;

/** `x,y` for every square of a `SIDE × SIDE` grid. */
const SQUARES: string[] = Array.from({ length: SIDE * SIDE }, (_, at) => {
  return `${at % SIDE},${Math.floor(at / SIDE)}`;
});

/**
 * A grid whose squares each carry an entry price, some of them impassable.
 *
 * The price belongs to the square being ENTERED, which is the shape the route
 * cost has in production: an affordance score describes a cell, not the pair of
 * cells a step joins.
 */
const grid = fc
  .array(fc.integer({ min: 0, max: 9 }), {
    minLength: SQUARES.length,
    maxLength: SQUARES.length,
  })
  .map((weights) => {
    const priceOf = new Map<string, number>();
    SQUARES.forEach((square, at) => priceOf.set(square, weights[at]!));
    // The start is always passable, or most runs would assert nothing. A `0`
    // weight means a WALL here, which also keeps free squares priced from 1 up
    // so the Manhattan heuristic below stays a lower bound.
    priceOf.set("0,0", Math.max(1, priceOf.get("0,0")!));
    return priceOf;
  });

function spaceFor(priceOf: ReadonlyMap<string, number>): StateSpace<string> {
  return {
    key: (state) => state,
    candidates: (state) => {
      const [x, y] = state.split(",").map(Number);
      return [
        `${x! + 1},${y!}`,
        `${x! - 1},${y!}`,
        `${x!},${y! + 1}`,
        `${x!},${y! - 1}`,
      ];
    },
    // Off the grid, or priced 0, means impassable. Legality lives HERE and only
    // here — `priceOf` stays total (see `priceIn` below), because `cost` is
    // consulted before `canEnter` and must answer for a step about to be
    // refused.
    canEnter: (_from, to) => (priceOf.get(to) ?? 0) > 0,
  };
}

/** The entry price of a square, total over every candidate the space emits. */
const priceIn =
  (priceOf: ReadonlyMap<string, number>) =>
  (_from: string, to: string): number =>
    priceOf.get(to) ?? 1;

/** Manhattan distance — admissible, since every passable square costs ≥ 1. */
function manhattanTo(goal: string): (state: string) => number {
  const [gx, gy] = goal.split(",").map(Number);
  return (state) => {
    const [x, y] = state.split(",").map(Number);
    return Math.abs(x! - gx!) + Math.abs(y! - gy!);
  };
}

/**
 * The true cheapest cost to every square, by repeated relaxation.
 *
 * BELLMAN–FORD, DELIBERATELY. Checking A\* against a second priority-queue
 * search would mostly assert that two copies of one idea agree; relaxing every
 * edge `n` times shares no structure with it — no heap, no settled set, no
 * heuristic — so it can genuinely disagree.
 */
function cheapestCosts(
  priceOf: ReadonlyMap<string, number>,
  space: StateSpace<string>,
  from: string,
): Map<string, number> {
  const best = new Map<string, number>([[from, 0]]);
  for (let round = 0; round < SQUARES.length; round += 1) {
    let changed = false;
    for (const square of SQUARES) {
      const here = best.get(square);
      if (here === undefined) continue;
      for (const next of space.candidates(square)) {
        if (!space.canEnter!(square, next)) continue;
        const through = here + priceOf.get(next)!;
        if ((best.get(next) ?? Number.POSITIVE_INFINITY) <= through) continue;
        best.set(next, through);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return best;
}

describe("findCheapestPath, over generated weights", () => {
  it("returns a connected, legal path to the goal, or nothing", () => {
    fc.assert(
      fc.property(grid, fc.constantFrom(...SQUARES), (priceOf, goal) => {
        const space = spaceFor(priceOf);
        const path = findCheapestPath("0,0", (s) => s === goal, space, {
          cost: priceIn(priceOf),
          heuristic: manhattanTo(goal),
        });
        if (path === undefined) return;

        expect(path[0]).toBe("0,0");
        expect(path[path.length - 1]).toBe(goal);
        for (let at = 1; at < path.length; at += 1) {
          const from = path[at - 1]!;
          const to = path[at]!;
          expect([...space.candidates(from)]).toContain(to);
          expect(space.canEnter!(from, to)).toBe(true);
        }
        // No square twice: a cheapest path through non-negative edges never
        // revisits, and a repeat is how a broken parent chain usually shows.
        expect(new Set(path).size).toBe(path.length);
      }),
      { numRuns: 400 },
    );
  });

  /**
   * THE ONE THAT DECIDES WHETHER THIS IS A\* OR JUST A SEARCH. Compared against
   * Bellman–Ford, including the negative case: where the oracle says the goal is
   * unreachable, `findCheapestPath` must return `undefined` rather than a route.
   */
  it("costs exactly what the oracle says the cheapest route costs", () => {
    fc.assert(
      fc.property(grid, fc.constantFrom(...SQUARES), (priceOf, goal) => {
        const space = spaceFor(priceOf);
        const oracle = cheapestCosts(priceOf, space, "0,0");
        const path = findCheapestPath("0,0", (s) => s === goal, space, {
          cost: priceIn(priceOf),
          heuristic: manhattanTo(goal),
        });

        // ONE UNCONDITIONAL ASSERTION covering both outcomes: `undefined` for
        // "no route" on each side. Branching to a different `expect` per case
        // would make the unreachable half silently untested whenever the
        // generator stops producing walls.
        const spent = path?.reduce(
          (total, square, at) =>
            at === 0 ? total : total + priceOf.get(square)!,
          0,
        );
        expect(spent).toBe(goal === "0,0" ? 0 : oracle.get(goal));
      }),
      { numRuns: 400 },
    );
  });
});
