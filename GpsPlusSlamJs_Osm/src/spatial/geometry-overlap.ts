/**
 * Does a feature overlap a query area? For every geometry kind, not just areas.
 *
 * `ring-overlap.ts` answers for POLYGONS ONLY. Over the site corpus that is a
 * minority of features — 3 316 of 10 335 elements are nodes, and most of the
 * 6 777 ways are open — so a spatial query built on it alone would answer
 * "nothing here" for most of the map. That is indistinguishable from an empty
 * area, which makes it the worst kind of wrong this package deals in.
 *
 * THE CONTRACT IS EXACT, WITH ZERO TOLERANCE (decision 12.2):
 *
 * - a **point** overlaps when it is inside the query;
 * - a **line** overlaps when it enters or crosses the query;
 * - an **area** overlaps when it shares any area, which is `polygonsOverlap`.
 *
 * No width, no buffer, no epsilon. Two things follow, and the second is a
 * genuine cost rather than a detail:
 *
 * - **It composes.** A caller wanting tolerance dilates the QUERY polygon — one
 *   place — instead of every predicate carrying a width that must then be kept
 *   in sync with whatever the renderer draws.
 * - **A ROAD YOU ARE STANDING ON IS A ZERO-WIDTH LINE.** So "what am I looking
 *   at" will not return the street under your feet unless the caller dilates the
 *   query first. That is a caller obligation, stated here rather than left to be
 *   discovered by whoever first wonders why the road is missing.
 *
 * HOLES COUNT FOR EVERY KIND. A point in a courtyard is not in the building; a
 * path across a clearing is not in the wood. `polygonsOverlap` already takes
 * that view, and the point and line cases agree with it — otherwise the same
 * query would answer differently depending on how a feature happens to be
 * tagged, which is the sort of inconsistency nobody finds until it matters.
 *
 * **BOUNDARY CASES ARE UNDEFINED FOR POINTS, and defined for areas.** That looks
 * like an inconsistency and is an inherited one: `containsPoint` documents that
 * a point exactly on an edge lands on whichever side floating point puts it,
 * while `segmentsIntersect` counts a touch as a crossing. Rather than paper over
 * it with an epsilon — which would be the tolerance this contract exists to
 * refuse — it is written down. A point a millimetre either way is well defined,
 * and no caller here has a stake in the exact-zero case.
 *
 * **PLANAR INPUT, converted once.** The predicate takes {@link PlanarGeometry},
 * not `OsmGeometry`, so nothing allocates per query; {@link toPlanarGeometry} is
 * the build-time conversion. A predicate that converted internally would look
 * tidier and would allocate an array per ring per feature per frame, which is
 * the opposite of what a narrow phase needs.
 *
 * @see geometry-overlap.ts.md
 */

import type { OsmGeometry } from "../model/osm-geometry.js";
import { containsPoint, type PlanarPoint } from "./point-in-ring.js";
import { segmentCrossesRing } from "./segment-crossing.js";
import { polygonsOverlap, type PlanarPolygon } from "./ring-overlap.js";

/**
 * `OsmGeometry` in `x = lng, y = lat` degrees — the form every predicate here
 * consumes.
 */
export type PlanarGeometry =
  | { readonly kind: "point"; readonly position: PlanarPoint }
  | { readonly kind: "linestring"; readonly positions: readonly PlanarPoint[] }
  | {
      readonly kind: "multilinestring";
      readonly lines: readonly (readonly PlanarPoint[])[];
    }
  | { readonly kind: "polygon"; readonly rings: PlanarPolygon }
  | {
      readonly kind: "multipolygon";
      readonly polygons: readonly PlanarPolygon[];
    };

const toPlanar = (
  ring: readonly { lat: number; lng: number }[],
): PlanarPoint[] => ring.map((p) => ({ x: p.lng, y: p.lat }));

/**
 * Converts once, at index-build time, so queries never allocate.
 *
 * Exhaustive over the five kinds by construction: the `switch` returns in every
 * branch and the parameter is a discriminated union, so a sixth kind added to
 * `osm-geometry.ts` fails to compile here rather than being silently dropped.
 */
export function toPlanarGeometry(geometry: OsmGeometry): PlanarGeometry {
  switch (geometry.kind) {
    case "point":
      return {
        kind: "point",
        position: { x: geometry.position.lng, y: geometry.position.lat },
      };
    case "linestring":
      return { kind: "linestring", positions: toPlanar(geometry.positions) };
    case "multilinestring":
      return {
        kind: "multilinestring",
        lines: geometry.lines.map(toPlanar),
      };
    case "polygon":
      return { kind: "polygon", rings: geometry.rings.map(toPlanar) };
    case "multipolygon":
      return {
        kind: "multipolygon",
        polygons: geometry.polygons.map((rings) => rings.map(toPlanar)),
      };
  }
}

/**
 * Whether `geometry` overlaps `query`, exactly.
 *
 * `query` is a `[outer, ...holes]` polygon — the frustum's ground footprint, in
 * the 2D form decision 12.3 settled on.
 */
export function geometryOverlaps(
  geometry: PlanarGeometry,
  query: PlanarPolygon,
): boolean {
  switch (geometry.kind) {
    case "point":
      return containsSolid(query, geometry.position);
    case "linestring":
      return lineOverlaps(geometry.positions, query);
    case "multilinestring":
      return geometry.lines.some((line) => lineOverlaps(line, query));
    case "polygon":
      return polygonsOverlap(geometry.rings, query);
    case "multipolygon":
      return geometry.polygons.some((rings) => polygonsOverlap(rings, query));
  }
}

/**
 * Whether `point` is on the SOLID part of `polygon` — inside the outer ring and
 * outside every hole.
 *
 * The hole clause is what stops a courtyard counting as its building.
 */
function containsSolid(polygon: PlanarPolygon, point: PlanarPoint): boolean {
  const outer = polygon[0];
  if (outer === undefined || !containsPoint(outer, point)) return false;
  for (let i = 1; i < polygon.length; i++) {
    const hole = polygon[i];
    if (hole !== undefined && containsPoint(hole, point)) return false;
  }
  return true;
}

/**
 * Whether a line enters or crosses `polygon`.
 *
 * TWO WITNESSES, and both are needed:
 *
 * 1. **a vertex on the solid part** — the ordinary case, and the only one that
 *    fires for a line that ends inside the query;
 * 2. **a segment crossing any ring** — outer or hole. This is the one a
 *    vertex-only test misses completely, and it is not an edge case: a road
 *    running past the camera whose OSM nodes both fall outside the view crosses
 *    it while having no vertex in it.
 *
 * Crossing a HOLE's ring counts, and must: a path leaving a courtyard passes
 * from the hole onto solid ground, so it overlaps even though every one of its
 * vertices may be in the hole or outside the polygon entirely.
 *
 * A line of one point is that point — degenerate but real in Overpass output,
 * and answering `false` for a node genuinely in view would be a silent miss. A
 * line of none overlaps nothing.
 */
function lineOverlaps(
  line: readonly PlanarPoint[],
  polygon: PlanarPolygon,
): boolean {
  const first = line[0];
  if (first === undefined) return false;
  if (line.length === 1) return containsSolid(polygon, first);

  for (const point of line) {
    if (containsSolid(polygon, point)) return true;
  }

  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    for (const ring of polygon) {
      if (segmentCrossesRing(a, b, ring)) return true;
    }
  }
  return false;
}
