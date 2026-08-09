/**
 * Do two shapes share any area? The exact overlap predicate.
 *
 * The narrow phase every spatial query needs: a broad phase proposes candidates
 * by bounding box, and this decides. It is deliberately separate from any index,
 * because every candidate structure needs it and none of them changes it.
 *
 * WHERE IT CAME FROM. `cell-overlap.ts` has covered a ring against an H3
 * hexagon since 2026-08-09, and everything in that test below the point where
 * the hexagon's boundary was fetched was already operating on two plain point
 * arrays — the cell was incidental. This is that predicate, named for what it
 * actually does, plus the one case it could not express.
 *
 * THE THREE WITNESSES, and why all three are needed. Two rings share area when:
 *
 * 1. a vertex of B lies inside A — covers B inside A, and the general case;
 * 2. a vertex of A lies inside B — covers A inside B, which (1) alone misses
 *    entirely, and which is exactly half the containment cases;
 * 3. an edge of A crosses an edge of B — covers a partial overlap where the
 *    overlapping region contains no vertex of either, which neither (1) nor (2)
 *    can see. Two boxes crossing in a plus shape is the everyday example.
 *
 * They are COMPLETE for simple polygons. They are not complete once holes exist,
 * which is the whole reason `polygonsOverlap` is a separate function rather than
 * a loop over rings.
 *
 * TOUCHING COUNTS AS OVERLAPPING, inherited from `segment-crossing.ts` and
 * deliberate: OSM is full of shared edges — terraced buildings, a fence along a
 * parcel boundary — and for the navigation and query uses here, refusing to
 * admit a shape that grazes another is the safe direction.
 *
 * PLANAR ON LAT/LNG, for the reason `point-in-ring.ts` gives: containment and
 * crossing are invariant under the affine map from degrees to local metres, so
 * no projection is needed for a boolean answer.
 *
 * @see ring-overlap.ts.md
 */

import { containsPoint, type PlanarPoint } from "./point-in-ring.js";
import { segmentsIntersect } from "./segment-crossing.js";

/**
 * A polygon as `[outer, ...holes]` — the shape `osm-geometry.ts` produces and
 * h3's polygon format uses, so no caller has to re-shape anything.
 */
export type PlanarPolygon = readonly (readonly PlanarPoint[])[];

/**
 * Whether two rings share any area. Holes are NOT considered — see
 * `polygonsOverlap` for that.
 *
 * A ring of fewer than three points bounds no area and overlaps nothing; real
 * Overpass output contains two-node ways, and a library that has to survive the
 * planet cannot make one fatal.
 */
export function ringsOverlap(
  a: readonly PlanarPoint[],
  b: readonly PlanarPoint[],
): boolean {
  if (a.length < 3 || b.length < 3) return false;

  for (const point of b) {
    if (containsPoint(a, point)) return true;
  }
  for (const point of a) {
    if (containsPoint(b, point)) return true;
  }
  return edgesCross(a, b);
}

/**
 * Whether two polygons share any area, with holes subtracted from both.
 *
 * **THE CASE THIS EXISTS FOR.** A shape lying entirely inside another's hole
 * passes every ring-vs-ring witness against the outer ring — its vertices are
 * "inside", no edges cross — while sharing no area at all. A courtyard, a
 * clearing in a wood, a lake on an island: all ordinary OSM, and all wrong under
 * `ringsOverlap` alone.
 *
 * The rule: the outers must overlap, and then neither shape may be *swallowed*
 * by a hole of the other. A shape only partly inside a hole still overlaps,
 * because the part outside the hole is on solid ground — which is why the test
 * is containment of the whole ring, not of any point of it.
 *
 * An empty polygon, or one whose outer ring cannot bound an area, overlaps
 * nothing.
 */
export function polygonsOverlap(a: PlanarPolygon, b: PlanarPolygon): boolean {
  const outerA = a[0];
  const outerB = b[0];
  if (outerA === undefined || outerB === undefined) return false;
  if (!ringsOverlap(outerA, outerB)) return false;

  // Swallowed by one of the other's holes ⇒ no shared area. Checked BOTH ways:
  // either shape can be the one sitting in the other's courtyard, and a
  // predicate testing one direction is wrong exactly half the time while
  // looking correct in any test that happens to pass the larger shape first.
  if (swallowedByHole(outerB, a)) return false;
  if (swallowedByHole(outerA, b)) return false;
  return true;
}

/**
 * Whether `ring` lies wholly within one hole of `polygon`.
 *
 * "Wholly" is the operative word and the reason this is not `containsPoint` on a
 * single vertex: a ring straddling a hole's rim has vertices inside the hole and
 * still shares area with the solid part. It is inside only if every vertex is
 * inside the hole AND no edge of the ring crosses the hole's boundary — the
 * second clause catching a ring whose vertices all sit in the hole while an edge
 * bulges out across the rim.
 */
function swallowedByHole(
  ring: readonly PlanarPoint[],
  polygon: PlanarPolygon,
): boolean {
  for (let i = 1; i < polygon.length; i++) {
    const hole = polygon[i];
    if (hole === undefined || hole.length < 3) continue;
    if (!ring.every((point) => containsPoint(hole, point))) continue;
    if (edgesCross(ring, hole)) continue;
    return true;
  }
  return false;
}

/** Whether any edge of `a` crosses any edge of `b`. Both are treated as closed. */
function edgesCross(
  a: readonly PlanarPoint[],
  b: readonly PlanarPoint[],
): boolean {
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    const p = a[j];
    const q = a[i];
    if (p === undefined || q === undefined) continue;
    for (let m = 0, n = b.length - 1; m < b.length; n = m++) {
      const r = b[n];
      const s = b[m];
      if (r === undefined || s === undefined) continue;
      if (segmentsIntersect(p, q, r, s)) return true;
    }
  }
  return false;
}
