/**
 * Pass A — reachability and pathfinding over H3 cells.
 *
 * `connectedComponents` answers "are these two cells in the same blob". An
 * agent needs the other question — "how do I get from here to there" — and the
 * navigation design names traversal within a component as the piece that does
 * not exist yet. This is that piece.
 *
 * **The step predicate is injectable, and that is the whole architecture.** The
 * design describes two rungs that look contradictory: agents that walk cell to
 * cell over free `gridDisk` adjacency and "will walk up the Tower walls, and
 * that is the point", and later agents that route *around* the same wall. Both
 * are the same search with a different edge test — the default admits every
 * neighbour, and pass B supplies one that resolves heights and refuses
 * unclimbable steps.
 *
 * Taking that seam seriously matters: a pass B that merely *rejected* steps as
 * an agent took them would produce an agent that walks into a wall and stops.
 * Routing around requires the SEARCH to know, which means the predicate belongs
 * here, in the expansion, not in a downstream mover.
 *
 * Breadth-first rather than A*: the working set is on the order of 10^3 cells,
 * every edge costs the same, and a heuristic buys nothing measurable at that
 * size while adding a tie-breaking rule that determinism would then depend on.
 *
 * @see path.ts.md
 */

import { gridDisk, getResolution } from "h3-js";

/** How a search may be narrowed beyond the scope set. */
export interface PathOptions {
  /**
   * Whether an agent may step from one in-scope cell to an adjacent one.
   *
   * Called only for cells already in the scope set, so an implementation never
   * has to defend itself against out-of-scope input. Defaults to admitting
   * every neighbour.
   */
  readonly canStep?: (from: string, to: string) => boolean;
  /**
   * Hard ceiling on cells expanded before the search gives up. See
   * {@link DEFAULT_MAX_EXPANSIONS}.
   */
  readonly maxExpansions?: number;
}

/**
 * Cells a single search may expand before it throws.
 *
 * The demo's scored working set is ~10^3 cells at the shipped disk radius, so
 * this is roughly two orders of magnitude of headroom — high enough never to
 * fire on real input, low enough that a caller who passes an unbounded scope
 * set finds out immediately rather than through a frozen tab.
 */
export const DEFAULT_MAX_EXPANSIONS = 100_000;

/**
 * Neighbours of `cell` that a search may move to, in a deterministic order.
 *
 * SORTED, and not incidentally: `gridDisk` makes no ordering guarantee, and
 * every downstream comparison — a route drawn twice, a test asserting a
 * specific path — would otherwise depend on an order H3 never promised.
 */
function stepsFrom(
  cell: string,
  inScope: ReadonlySet<string>,
  canStep: (from: string, to: string) => boolean,
): string[] {
  return gridDisk(cell, 1)
    .filter((next) => next !== cell && inScope.has(next) && canStep(cell, next))
    .sort();
}

/**
 * Fills in the defaults once, for both entry points.
 *
 * Shared rather than repeated so `findPath` and `reachableFrom` cannot end up
 * with different defaults — the two are required to agree about what an edge
 * is, and a divergence here would be the quietest possible way to break that.
 */
function settle(options: PathOptions): {
  canStep: (from: string, to: string) => boolean;
  maxExpansions: number;
} {
  return {
    canStep: options.canStep ?? (() => true),
    maxExpansions: options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS,
  };
}

/** Walks the parent links back from `last` to `start`, ending at `goal`. */
function reconstruct(
  cameFrom: ReadonlyMap<string, string>,
  start: string,
  last: string,
  goal: string,
): string[] {
  const path = [goal];
  for (let at = last; at !== start; at = cameFrom.get(at)!) path.push(at);
  path.push(start);
  return path.reverse();
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
 * A shortest route from `start` to `goal` within `inScope`, or `undefined`.
 *
 * `undefined` means **no route exists** and nothing else. Exhausting the
 * expansion cap throws instead, because a caller cannot tell a blank answer
 * from a search that quietly gave up.
 *
 * @throws `RangeError` if `start` and `goal` differ in resolution, or if the
 *   expansion cap is reached.
 */
export function findPath(
  start: string,
  goal: string,
  inScope: ReadonlySet<string>,
  options: PathOptions = {},
): string[] | undefined {
  assertSameResolution([start, goal]);

  const { canStep, maxExpansions } = settle(options);

  if (!inScope.has(start) || !inScope.has(goal)) return undefined;
  if (start === goal) return [start];

  // Parent links rather than a path per queue entry: the queue can hold the
  // whole scope set, and copying an array into each entry turns a linear search
  // into a quadratic one.
  const cameFrom = new Map<string, string>([[start, start]]);
  const queue = [start];
  let head = 0;
  let expansions = 0;

  while (head < queue.length) {
    const cell = queue[head++]!;

    if (++expansions > maxExpansions) {
      throw new RangeError(
        `nav/path: search exceeded ${maxExpansions} expansions; scope set has ${inScope.size} cells`,
      );
    }

    for (const next of stepsFrom(cell, inScope, canStep)) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, cell);

      if (next === goal) return reconstruct(cameFrom, start, cell, goal);

      queue.push(next);
    }
  }

  return undefined;
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
  const { canStep, maxExpansions } = settle(options);

  const seen = new Set<string>();
  if (!inScope.has(start)) return seen;

  seen.add(start);
  const queue = [start];
  let head = 0;
  let expansions = 0;

  while (head < queue.length) {
    const cell = queue[head++]!;

    if (++expansions > maxExpansions) {
      throw new RangeError(
        `nav/path: flood exceeded ${maxExpansions} expansions; scope set has ${inScope.size} cells`,
      );
    }

    for (const next of stepsFrom(cell, inScope, canStep)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}
