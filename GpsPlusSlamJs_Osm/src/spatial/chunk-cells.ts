/**
 * Enumerating the affordance cells of a set of score chunks.
 *
 * Small enough to look trivial, and separated out because it is the one place
 * H3's index-vs-geometry distinction is easy to get wrong — see below.
 *
 * @see chunk-cells.ts.md
 */

import { cellToChildren } from "h3-js";
import { AFFORDANCE_RES } from "./resolutions.js";

/**
 * Every affordance cell belonging to the given score chunks.
 *
 * **`cellToChildren` is an INDEX partition, not a geometric one.** Every res-13
 * cell belongs to exactly one res-11 parent, which is what makes "enumerate each
 * chunk's children once" correct and duplicate-free — and it is the only claim
 * being made here. It is emphatically NOT a statement that those children lie
 * geometrically inside the parent: hexagons cannot tile hexagons, so children
 * near a boundary spill outside and neighbouring children spill in.
 *
 * That is why coverage (`cell-coverage.ts`) is computed per cell against real
 * feature geometry, never by assuming a cell inherits its parent's features.
 *
 * The count is `49 × chunks` in the common case but **not guaranteed**: the 12
 * pentagons per resolution have 6 children rather than 7. Callers must size
 * records from the returned length.
 */
export function cellsOfChunks(chunks: Iterable<string>): string[] {
  const cells: string[] = [];
  for (const chunk of chunks) {
    for (const child of cellToChildren(chunk, AFFORDANCE_RES)) {
      cells.push(child);
    }
  }
  return cells;
}
