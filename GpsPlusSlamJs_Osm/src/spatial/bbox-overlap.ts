/**
 * The cheap "definitely not" a narrow phase should ask before the exact test.
 *
 * WHY THIS EXISTS, in one measured number: over a realistic frustum query the
 * exact predicate costs **0.30 µs for a candidate that overlaps and 11.4 µs for
 * one that does not** — a **37× asymmetry**, because an overlap returns on the
 * first witness that fires while a rejection must exhaust all three, and the
 * third is an O(n·m) scan over every edge pair. A Westminster building outline
 * is 1 031 points. So a query's cost is set by its REJECTIONS, and answering
 * them in a handful of comparisons is the whole optimisation.
 *
 * **THIS IS NOT THE TEST A BOUNDING-BOX GUARD USUALLY IS, and getting that wrong
 * is why it needs saying.** A packed R-tree broad phase (`flatbush`) already
 * does an exact box-versus-box test at leaf level, so re-testing the candidate's
 * bbox against the QUERY'S BBOX rejects nothing — measured at 371 of 371 and
 * 1 239 of 1 239 survivors. What pays is testing the candidate's bbox against
 * the **query POLYGON**: a view frustum is a trapezoid whose bounding box is
 * roughly twice its area, so the corners the broad phase hands over are real
 * false positives, and those are exactly the 37× rejections.
 *
 * `cell-overlap.ts` runs the ordinary form of the guard and is not this: its
 * candidates come from a grid disk that nothing has box-filtered, so there the
 * plain test throws most of them away.
 *
 * SEPARATING AXES, and no allocation. A single axis on which the two shapes'
 * projections do not overlap proves they are disjoint. This tries the box's own
 * two axes and then every edge normal of the query's outer ring, projecting the
 * box onto each in O(1) from its min/max and the normal's signs. Nothing is
 * constructed per call — no corner array, no ring — because
 * `geometry-overlap.ts` states the invariant this plugs into: a narrow phase
 * that allocates per candidate per frame is the opposite of what it needs.
 *
 * **CONSERVATIVE, NEVER EXACT, AND THAT IS THE CONTRACT.** `false` means
 * *definitely disjoint*; `true` means *maybe*, and the caller must still run the
 * exact predicate. For a non-convex query the axis set can fail to separate two
 * genuinely disjoint shapes — a false `true`, which costs one exact test and
 * loses nothing. It can never answer `false` for shapes that touch, because a
 * ring lies wholly within its own bounding box.
 *
 * HOLES ARE IGNORED, deliberately. A hole only shrinks the query, so reading one
 * could reject a candidate sitting over it that the exact test would still find
 * on solid ground. `bbox-overlap.property.test.ts` pins that, because "also
 * check the holes" reads like an obvious improvement and is a correctness
 * regression.
 *
 * @see bbox-overlap.ts.md
 */

import type { Bbox } from "./clip.js";
import type { PlanarPoint } from "./point-in-ring.js";
import type { PlanarPolygon } from "./ring-overlap.js";

/**
 * Whether `bbox` might share area with `query` — `false` proves it does not.
 *
 * `bbox` is `clip.ts`'s `{ west, south, east, north }`; `query` is an
 * `[outer, ...holes]` polygon in `x = lng, y = lat`, of which only the outer
 * ring is read.
 *
 * A query whose outer ring has fewer than three points bounds no area, so
 * nothing can overlap it and this answers `false`. A non-finite coordinate
 * anywhere makes every comparison false, which would be an unsafe `false`, so
 * such a query is passed through as `true` and left for the exact test to
 * refuse — declining is always safe, asserting is not.
 */
export function bboxOverlapsPolygon(bbox: Bbox, query: PlanarPolygon): boolean {
  const outer = query[0];
  if (outer === undefined || outer.length < 3) return false;
  if (!isFiniteBbox(bbox)) return true;

  const ring = ringBounds(outer);
  if (ring === undefined) return true; // non-finite input: decline, never decide

  // The box's own two axes first: cheapest, and they reject the common case of a
  // candidate far along one axis without touching any edge normal.
  //
  // INCLUSIVE, because touching counts as overlapping everywhere in this
  // package — `bboxesIntersect` and `segmentsIntersect` both take that view, and
  // a guard stricter than the predicate it guards would reject shapes the exact
  // test would have admitted.
  if (ring.maxX < bbox.west || ring.minX > bbox.east) return false;
  if (ring.maxY < bbox.south || ring.minY > bbox.north) return false;

  // Then the query's edge normals. This is what a box-versus-box test cannot do
  // and is the reason this function exists: it is what sees the diagonal edges
  // of a frustum footprint.
  return !anyEdgeNormalSeparates(bbox, outer);
}

/**
 * Whether any edge of `ring` yields an axis that separates it from `bbox`.
 *
 * Split out from the caller only to keep each piece under the complexity limit;
 * the two together are one test.
 */
function anyEdgeNormalSeparates(
  bbox: Bbox,
  ring: readonly PlanarPoint[],
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    // Normal of edge a→b, unnormalised: scaling an axis cannot change whether
    // two intervals on it overlap, so the square root is wasted work.
    const nx = a.y - b.y;
    const ny = b.x - a.x;
    if (nx === 0 && ny === 0) continue; // a degenerate edge separates nothing

    if (separates(nx, ny, bbox, ring)) return true;
  }
  return false;
}

function isFiniteBbox(bbox: Bbox): boolean {
  return (
    Number.isFinite(bbox.west) &&
    Number.isFinite(bbox.south) &&
    Number.isFinite(bbox.east) &&
    Number.isFinite(bbox.north)
  );
}

/** The ring's own extent, or `undefined` if any coordinate is unusable. */
function ringBounds(
  ring: readonly PlanarPoint[],
): { minX: number; maxX: number; minY: number; maxY: number } | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      return undefined;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Whether the axis `(nx, ny)` separates the box from the ring.
 *
 * The box's projection is derived from its corners without materialising them:
 * on any axis, the extreme corners are the ones picked per component by the
 * normal's sign. That is the O(1) step the corner-ring formulation of this test
 * would have paid four allocations for.
 */
function separates(
  nx: number,
  ny: number,
  bbox: Bbox,
  ring: readonly PlanarPoint[],
): boolean {
  const xLo = nx >= 0 ? bbox.west : bbox.east;
  const xHi = nx >= 0 ? bbox.east : bbox.west;
  const yLo = ny >= 0 ? bbox.south : bbox.north;
  const yHi = ny >= 0 ? bbox.north : bbox.south;
  const boxLo = nx * xLo + ny * yLo;
  const boxHi = nx * xHi + ny * yHi;

  let ringLo = Infinity;
  let ringHi = -Infinity;
  for (const point of ring) {
    const projected = nx * point.x + ny * point.y;
    if (projected < ringLo) ringLo = projected;
    if (projected > ringHi) ringHi = projected;
  }

  return ringHi < boxLo || ringLo > boxHi;
}
