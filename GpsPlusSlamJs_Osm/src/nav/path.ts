/**
 * Pass A — reachability and pathfinding over H3 cells.
 *
 * `connectedComponents` answers "are these two cells in the same blob". An
 * agent needs the other question — "how do I get from here to there" — and the
 * navigation design names traversal within a component as the piece that does
 * not exist yet.
 *
 * **This is now a thin wrapper over {@link findStatePath}.** The search itself
 * is generic over a state, because review on #257 showed that a cell-keyed
 * search cannot express the column model: one slot per cell means the wall foot
 * and the wall top cannot coexist, and a predicate handed only cell strings has
 * to resolve one height per cell — a 2D model with a step filter. For a genuine
 * `(cell, heightM)` search use `columnSpace` from `column-space.ts`; this
 * module is the flat case, where one state per cell is the whole truth.
 *
 * That flat case is not vestigial — it is the design's rung 5.3, where agents
 * wander over free `gridDisk` adjacency and "will walk up the Tower walls, and
 * that is the point".
 *
 * @see path.ts.md
 */

import { gridDisk, getResolution } from "h3-js";

import {
  findStatePath,
  reachableStates,
  type SearchOptions,
  type StateSpace,
} from "./search.js";

export { DEFAULT_MAX_EXPANSIONS } from "./search.js";

/** How a search may be narrowed beyond the scope set. */
export interface PathOptions extends SearchOptions {
  /**
   * Whether an agent may step from one in-scope cell to an adjacent one.
   *
   * Called only for cells in the scope set, and **only once per newly
   * discovered cell** — never for one already visited. Defaults to admitting
   * every neighbour.
   */
  readonly canStep?: (from: string, to: string) => boolean;
}

/** Throws unless every cell shares one H3 resolution. */
function assertSameResolution(cells: readonly string[]): void {
  const resolution = getResolution(cells[0]!);
  for (const cell of cells) {
    if (getResolution(cell) !== resolution) {
      throw new RangeError(
        `nav/path: cells must share a resolution, got ${resolution} and ${getResolution(cell)}`,
      );
    }
  }
}

/**
 * The flat state space: a state is a cell, and its identity is itself.
 *
 * Candidates are **sorted**, because `gridDisk` promises no ordering and a
 * route that depended on it would vary with the H3 version — the same reason
 * `connectedComponents` sorts.
 */
function cellSpace(
  inScope: ReadonlySet<string>,
  canStep: (from: string, to: string) => boolean,
): StateSpace<string> {
  return {
    key: (cell) => cell,
    candidates: (cell) =>
      gridDisk(cell, 1)
        .filter((next) => next !== cell && inScope.has(next))
        .sort(),
    canEnter: canStep,
  };
}

/**
 * A shortest route from `start` to `goal` within `inScope`, or `undefined`.
 *
 * `undefined` means **no route exists** and nothing else. Exhausting the
 * expansion cap throws instead, because a caller cannot tell a blank answer
 * from a search that quietly gave up.
 *
 * @throws `RangeError` if `start` and `goal` differ in resolution, if the
 *   expansion cap is invalid, or if it is reached.
 */
export function findPath(
  start: string,
  goal: string,
  inScope: ReadonlySet<string>,
  options: PathOptions = {},
): string[] | undefined {
  assertSameResolution([start, goal]);

  // THE GUARD IS NOT ONLY A FAST PATH. For every other input the search would
  // fail to expand and return `undefined` anyway — but with `start === goal` it
  // is the only thing stopping a `[start]` "route" on a cell that was never
  // scored. Found by mutation testing.
  if (!inScope.has(start) || !inScope.has(goal)) return undefined;

  return findStatePath(
    start,
    (cell) => cell === goal,
    cellSpace(inScope, options.canStep ?? (() => true)),
    options,
  );
}

/**
 * Every cell reachable from `start` within `inScope`, including `start`.
 *
 * Empty when `start` is out of scope — an agent standing somewhere unscored can
 * go nowhere, which is a meaningful answer rather than an error.
 */
export function reachableFrom(
  start: string,
  inScope: ReadonlySet<string>,
  options: PathOptions = {},
): Set<string> {
  if (!inScope.has(start)) return new Set();

  return new Set(
    reachableStates(
      start,
      cellSpace(inScope, options.canStep ?? (() => true)),
      options,
    ).values(),
  );
}
