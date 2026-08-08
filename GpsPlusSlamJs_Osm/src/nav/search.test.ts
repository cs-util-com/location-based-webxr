/**
 * The weighted search (DEC-R13-1).
 *
 * WHY THIS FILE EXISTS NOW. `search.ts` was covered only through its two users —
 * `path.test.ts` for the flat cell space and `column-space.test.ts` for columns —
 * and its own sidecar said what that left out: "weighted edges, because there are
 * none. If a space ever wants them this module is the wrong starting point."
 * DEC-R13-1 is that space. The ninth testing session found the NPC taking
 * neither the shortest route nor the walkable one, and the single line of code
 * behind both halves was that `findStatePath` is breadth-first: every edge costs
 * 1, so a straight run and a staircase of the same step count are
 * indistinguishable and the winner is decided by `gridDisk` ordering.
 *
 * `findCheapestPath` is the answer, and the properties worth pinning are the
 * ones that make it an answer rather than a second search: it returns the
 * CHEAPEST path (not merely a cheap one), it respects `canEnter` exactly as the
 * BFS does, and it refuses the inputs that would silently make it wrong — a
 * negative edge, a non-finite cost, an overestimating heuristic.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_EXPANSIONS,
  findCheapestPath,
  findStatePath,
  type StateSpace,
} from "./search.js";

/**
 * A grid of weighted squares, as a state space.
 *
 * The weight is the price of ENTERING a square, which is the shape the route
 * cost has: an affordance score belongs to a cell, not to the pair of cells a
 * step joins. `#` is impassable and is expressed through `canEnter`, so the
 * legality path and the cost path are exercised together.
 */
function gridSpace(rows: readonly string[]): {
  space: StateSpace<string>;
  cost: (from: string, to: string) => number;
  weightAt: (state: string) => number;
} {
  const weightAt = (state: string): number => {
    const [x, y] = state.split(",").map(Number);
    const cell = rows[y!]?.[x!];
    if (cell === undefined || cell === "#") return Number.POSITIVE_INFINITY;
    return cell === "." ? 1 : Number(cell);
  };
  const space: StateSpace<string> = {
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
    canEnter: (_from, to) => Number.isFinite(weightAt(to)),
  };
  return { space, cost: (_from, to) => weightAt(to), weightAt };
}

/** Manhattan distance, which is admissible when the cheapest square costs 1. */
function manhattanTo(goal: string): (state: string) => number {
  const [gx, gy] = goal.split(",").map(Number);
  return (state) => {
    const [x, y] = state.split(",").map(Number);
    return Math.abs(x! - gx!) + Math.abs(y! - gy!);
  };
}

/** What a path actually cost, so a test can compare two of them. */
function costOf(path: readonly string[], weightAt: (s: string) => number) {
  return path.slice(1).reduce((total, state) => total + weightAt(state), 0);
}

/**
 * The true minimum cost, by exhaustive enumeration.
 *
 * A DELIBERATELY DIFFERENT ALGORITHM from the one under test. Checking A\*
 * against a second priority-queue search would mostly assert that two copies of
 * the same idea agree; a simple-paths DFS shares no structure with it, so it can
 * disagree. Only usable on a tiny grid, which is why the optimality test uses
 * one.
 */
function bruteForceCost(
  start: string,
  goal: string,
  space: StateSpace<string>,
  weightAt: (s: string) => number,
): number {
  let best = Number.POSITIVE_INFINITY;
  const walk = (at: string, spent: number, seen: Set<string>): void => {
    if (at === goal) {
      best = Math.min(best, spent);
      return;
    }
    for (const next of space.candidates(at)) {
      if (seen.has(next)) continue;
      if (!(space.canEnter?.(at, next) ?? true)) continue;
      seen.add(next);
      walk(next, spent + weightAt(next), seen);
      seen.delete(next);
    }
  };
  walk(start, 0, new Set([start]));
  return best;
}

describe("findCheapestPath", () => {
  /**
   * THE FINDING, AS A TEST (R13-1). A lane of expensive squares sits between
   * start and goal on the direct line; going round costs more STEPS and less
   * money. BFS takes the direct line because every step is worth the same; A\*
   * pays the detour. This is the whole behavioural difference in one case.
   */
  it("prefers a longer cheap route where BFS takes the short expensive one", () => {
    const { space, cost, weightAt } = gridSpace([
      "..9......",
      "..9......",
      "..9......",
      ".........",
    ]);
    const goal = "4,0";
    const bfs = findStatePath("0,0", (s) => s === goal, space)!;
    const astar = findCheapestPath("0,0", (s) => s === goal, space, {
      cost,
      heuristic: manhattanTo(goal),
    })!;

    expect(costOf(astar, weightAt)).toBeLessThan(costOf(bfs, weightAt));
    // And it really is longer in steps — otherwise the case would prove nothing
    // about weighting, only about a tie broken differently.
    expect(astar.length).toBeGreaterThan(bfs.length);
  });

  /**
   * OPTIMAL, NOT MERELY BETTER. "Cheaper than BFS" is satisfied by any
   * half-working weighted search; the contract callers rely on is the minimum.
   */
  it("returns the cheapest path there is", () => {
    const { space, cost, weightAt } = gridSpace([
      ".5.3",
      "4.2.",
      ".7.1",
      "2.6.",
    ]);
    const goal = "3,3";
    const path = findCheapestPath("0,0", (s) => s === goal, space, {
      cost,
      heuristic: manhattanTo(goal),
    })!;

    expect(costOf(path, weightAt)).toBe(
      bruteForceCost("0,0", goal, space, weightAt),
    );
  });

  /**
   * THE INVARIANT STAGE 1 MUST NOT BREAK. Barrier avoidance is what the ninth
   * session praised by name, and it reaches the search only through `canEnter`.
   */
  it("never steps where canEnter refuses, even when that is the cheap way", () => {
    const { space, cost } = gridSpace(["0#0", "0#0", "000"]);
    const goal = "2,0";
    const path = findCheapestPath("0,0", (s) => s === goal, space, {
      cost,
      heuristic: manhattanTo(goal),
    })!;

    expect(path).not.toContain("1,0");
    expect(path).not.toContain("1,1");
    expect(path[path.length - 1]).toBe(goal);
  });

  it("returns just the start when the start is the goal", () => {
    const { space, cost } = gridSpace(["..", ".."]);
    expect(
      findCheapestPath("0,0", (s) => s === "0,0", space, {
        cost,
        heuristic: manhattanTo("0,0"),
      }),
    ).toEqual(["0,0"]);
  });

  /**
   * `undefined` means NO ROUTE, and it has to be distinguishable from the cap —
   * which throws. Same contract as `findStatePath`, and for the same reason: a
   * caller cannot tell a blank answer from a search that gave up.
   */
  it("returns undefined when the goal is walled off", () => {
    const { space, cost } = gridSpace(["0#0", "0#0", "0#0"]);
    expect(
      findCheapestPath("0,0", (s) => s === "2,0", space, {
        cost,
        heuristic: manhattanTo("2,0"),
      }),
    ).toBeUndefined();
  });

  it("throws rather than truncating when the cap is reached", () => {
    const { space, cost } = gridSpace([".........."]);
    expect(() =>
      findCheapestPath("0,0", () => false, space, {
        cost,
        heuristic: () => 0,
        maxExpansions: 3,
      }),
    ).toThrow(RangeError);
  });

  it("rejects a cap that would silently disable the ceiling", () => {
    const { space, cost } = gridSpace([".."]);
    for (const maxExpansions of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      expect(() =>
        findCheapestPath("0,0", (s) => s === "1,0", space, {
          cost,
          heuristic: () => 0,
          maxExpansions,
        }),
      ).toThrow(RangeError);
    }
  });

  /**
   * A NEGATIVE EDGE BREAKS THE ALGORITHM, NOT JUST THE ANSWER. Settling a state
   * is only sound while no cheaper way to it can still be found, which a
   * negative edge makes false — so the search would return a confidently wrong
   * path rather than a slow one. The cost function is supplied by a caller and
   * derived from external data (an affordance score), so this is a real input,
   * not a hypothetical.
   */
  it("refuses a negative or non-finite edge cost", () => {
    const { space } = gridSpace(["..."]);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        findCheapestPath("0,0", (s) => s === "2,0", space, {
          cost: () => bad,
          heuristic: () => 0,
        }),
      ).toThrow(RangeError);
    }
  });

  it("refuses a negative or non-finite heuristic", () => {
    const { space, cost } = gridSpace(["..."]);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        findCheapestPath("0,0", (s) => s === "2,0", space, {
          cost,
          heuristic: () => bad,
        }),
      ).toThrow(RangeError);
    }
  });

  /**
   * A ZERO-COST EDGE IS LEGAL, and worth stating: the penalty curve clamps at 1
   * so production never produces one, but a cost of 0 is a valid weight and
   * rejecting it would be over-strict — only NEGATIVE breaks the settle rule.
   */
  it("accepts a zero-cost edge", () => {
    const { space } = gridSpace(["..."]);
    const path = findCheapestPath("0,0", (s) => s === "2,0", space, {
      cost: () => 0,
      heuristic: () => 0,
    });
    expect(path?.[path.length - 1]).toBe("2,0");
  });

  /**
   * WITH EVERY EDGE THE SAME PRICE, A\* MUST AGREE WITH BFS ON COST. It need not
   * agree on which of the tied routes it returns — that is the arbitrary choice
   * R13-1 complained about — so the assertion is on the length, not the path.
   */
  it("matches BFS's step count on an unweighted space", () => {
    const { space } = gridSpace(["....", "....", "...."]);
    const goal = "3,2";
    const bfs = findStatePath("0,0", (s) => s === goal, space)!;
    const astar = findCheapestPath("0,0", (s) => s === goal, space, {
      cost: () => 1,
      heuristic: manhattanTo(goal),
    })!;
    expect(astar.length).toBe(bfs.length);
  });

  /**
   * A HEURISTIC OF ZERO IS ALWAYS ADMISSIBLE — it is Dijkstra — so it must give
   * the same cost as the informed run. This is the cheapest available check
   * that the heuristic is being used as guidance and not as part of the answer,
   * which is the classic way an A\* implementation goes subtly wrong.
   */
  it("gives the same cost with and without the heuristic", () => {
    const { space, cost, weightAt } = gridSpace([
      "..9......",
      "..9......",
      "..9......",
      ".........",
    ]);
    const goal = "4,0";
    const informed = findCheapestPath("0,0", (s) => s === goal, space, {
      cost,
      heuristic: manhattanTo(goal),
    })!;
    const dijkstra = findCheapestPath("0,0", (s) => s === goal, space, {
      cost,
      heuristic: () => 0,
    })!;
    expect(costOf(informed, weightAt)).toBe(costOf(dijkstra, weightAt));
  });

  it("defaults its cap to the shared constant", () => {
    expect(DEFAULT_MAX_EXPANSIONS).toBe(100_000);
  });
});
