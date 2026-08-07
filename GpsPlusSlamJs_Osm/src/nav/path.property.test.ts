/**
 * Pass-A property tests.
 *
 * Why these tests matter:
 * The unit tests use one hand-built barrier. These generate barriers, so the
 * search has to be right on fields nobody designed for it — and they check the
 * three things a caller is entitled to assume from anything called a path:
 * every step is legal, the endpoints are the ones asked for, and no shorter
 * route was missed.
 *
 * That last one is the real content. A search that returns *a* route is easy;
 * one that returns a SHORTEST route is what breadth-first buys, and a
 * queue-discipline slip (a stack instead of a queue, a re-visit that overwrites
 * a parent link) leaves a search that still arrives — just by a longer way. No
 * single example reliably catches that.
 *
 * @see path.ts.md
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { latLngToCell, gridDisk, gridDistance } from "h3-js";
import { findPath, reachableFrom } from "./path.js";
import { AFFORDANCE_RES } from "../spatial/resolutions.js";

const ORIGIN = latLngToCell(50.9413, 6.9583, AFFORDANCE_RES);

/** 61 cells — small enough to brute-force an oracle over. */
const DISK = gridDisk(ORIGIN, 4);

/** A field with an arbitrary subset of cells punched out as obstacles. */
const field = fc
  .subarray(
    DISK.filter((cell) => cell !== ORIGIN),
    { minLength: 0 },
  )
  .map((holes) => {
    const removed = new Set(holes);
    return new Set(DISK.filter((cell) => !removed.has(cell)));
  });

const goal = fc.constantFrom(...DISK);

/**
 * Shortest hop count from the origin, by layered flood — an oracle that shares
 * no code with `findPath` beyond `gridDisk`.
 */
function shortestHops(
  scope: ReadonlySet<string>,
  from: string,
): Map<string, number> {
  const distance = new Map<string, number>();
  if (!scope.has(from)) return distance;
  distance.set(from, 0);

  let frontier = [from];
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const next: string[] = [];
    for (const cell of frontier) {
      for (const neighbour of gridDisk(cell, 1)) {
        if (neighbour === cell || !scope.has(neighbour)) continue;
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return distance;
}

describe("pass-A path properties", () => {
  it("returns a route only when one exists, and never otherwise", () => {
    // AGREEMENT WITH AN INDEPENDENT FLOOD. Either both say reachable or
    // neither does; a search that gives up early and one that leaks through an
    // obstacle both break this, in opposite directions.
    fc.assert(
      fc.property(field, goal, (scope, target) => {
        const reachable = shortestHops(scope, ORIGIN).has(target);
        expect(findPath(ORIGIN, target, scope) !== undefined).toBe(reachable);
      }),
    );
  });

  it("returns a route of exactly the shortest length", () => {
    fc.assert(
      fc.property(field, goal, (scope, target) => {
        const oracle = shortestHops(scope, ORIGIN).get(target);
        const path = findPath(ORIGIN, target, scope);
        expect(path?.length ?? -1).toBe(oracle === undefined ? -1 : oracle + 1);
      }),
    );
  });

  it("returns a route that is walkable step by step", () => {
    // Endpoints right and length right is still not a path: the steps have to
    // connect. Checked against `gridDistance`, not against the module's own
    // neighbour helper.
    fc.assert(
      fc.property(field, goal, (scope, target) => {
        const path = findPath(ORIGIN, target, scope);
        if (path === undefined) return;
        expect(path[0]).toBe(ORIGIN);
        expect(path.at(-1)).toBe(target);
        for (let i = 1; i < path.length; i++) {
          expect(scope.has(path[i]!)).toBe(true);
          expect(gridDistance(path[i - 1]!, path[i]!)).toBe(1);
        }
      }),
    );
  });

  it("never visits a cell twice", () => {
    // A cycle would still satisfy "every step is a neighbour" and would still
    // end at the goal — it just wastes the agent's time forever.
    fc.assert(
      fc.property(field, goal, (scope, target) => {
        const path = findPath(ORIGIN, target, scope);
        if (path === undefined) return;
        expect(new Set(path).size).toBe(path.length);
      }),
    );
  });

  it("agrees with reachableFrom about what is reachable", () => {
    // The two entry points must not be able to disagree — a caller told a cell
    // is reachable and then handed `undefined` for the route has no way to act
    // on either answer.
    fc.assert(
      fc.property(field, goal, (scope, target) => {
        const flood = reachableFrom(ORIGIN, scope);
        expect(flood.has(target)).toBe(
          findPath(ORIGIN, target, scope) !== undefined,
        );
      }),
    );
  });

  it("treats a blocking predicate exactly like a missing cell", () => {
    // The seam pass B plugs into has to be equivalent to carving the obstacle
    // out of the scope set. If the two ever diverge, a height-derived
    // obstruction would behave differently from a score-derived one and there
    // would be no principled way to say which is right.
    fc.assert(
      fc.property(
        fc.subarray(DISK.filter((cell) => cell !== ORIGIN)),
        goal,
        (holes, target) => {
          const blocked = new Set(holes);
          const carved = new Set(DISK.filter((cell) => !blocked.has(cell)));

          const viaScope = findPath(ORIGIN, target, carved);
          const viaPredicate = findPath(ORIGIN, target, new Set(DISK), {
            canStep: (_from, to) => !blocked.has(to),
          });

          expect(viaPredicate).toEqual(viaScope);
        },
      ),
    );
  });
});
