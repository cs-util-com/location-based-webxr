/**
 * Connected-component labelling over H3 cells.
 *
 * Replaces the C# reference's `FloodFill`, and the replacement is *smaller*
 * rather than merely different. The reference's flood fill had to work on a
 * geohash grid, which is rectangular, which forced two things this does not
 * need:
 *
 *  - a **rectangularity invariant** (`throw "The input map is not rectangular"`)
 *    and a dense fill of empty tiles with neutral heat that existed only to
 *    satisfy it;
 *  - an 8-neighbourhood, because a rectangular grid has two kinds of adjacency
 *    (edge and corner) and picking one is a judgement call.
 *
 * A hex grid has exactly one kind of adjacency and no notion of a bounding
 * rectangle, so `gridDisk(cell, 1)` is the whole neighbourhood definition and
 * sparse input is the natural input.
 *
 * @see connected-components.ts.md
 */

import { gridDisk } from "h3-js";

/**
 * Groups cells into maximal sets connected under `gridDisk(cell, 1)`.
 *
 * Deterministic: components come back sorted by their lowest-sorting member, and
 * each component's cells are sorted. Without that the order would depend on the
 * caller's iteration order, and region identity (§region-identity) is derived
 * from component membership.
 *
 * @param minSize drop components smaller than this. Matches the reference's
 *   `minTileCount` (default 2): a single isolated cell above threshold is
 *   almost always one small mapped object rather than a region, and emitting it
 *   buries the real regions in noise.
 */
export function connectedComponents(
  cells: Iterable<string>,
  minSize = 2,
): string[][] {
  const remaining = new Set(cells);
  const components: string[][] = [];

  // Iterating the SET rather than the input avoids visiting a duplicate twice,
  // and `remaining.delete` on visit is what makes this linear rather than
  // quadratic.
  for (const start of [...remaining].sort()) {
    if (!remaining.has(start)) continue;

    const component: string[] = [];
    // Explicit stack, not recursion: a component can span the whole working set
    // (931 cells) and a large region in a future coarser mode could be far
    // bigger. Recursion here is a stack overflow waiting for a big park.
    const stack = [start];
    remaining.delete(start);

    while (stack.length > 0) {
      const cell = stack.pop()!;
      component.push(cell);
      for (const neighbour of gridDisk(cell, 1)) {
        if (!remaining.has(neighbour)) continue;
        remaining.delete(neighbour);
        stack.push(neighbour);
      }
    }

    if (component.length >= minSize) components.push(component.sort());
  }

  return components.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}
