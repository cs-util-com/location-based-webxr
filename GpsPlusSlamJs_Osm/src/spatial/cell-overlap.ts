/**
 * The cells a single ring overlaps, without h3's polygon API.
 *
 * WHY THIS EXISTS, in one number: `polygonToCellsExperimental` costs **~0.5–0.8
 * ms per call regardless of how many cells it returns**, and the obstacle sweep
 * makes 3 397 of those calls over the site corpus for 2 829 ms. The cost is the
 * CALL, not the geometry — at res 7, where a 1×20 m quad returns a single cell,
 * the same call still costs 296 µs, and all four `POLYGON_TO_CELLS_FLAGS` cost
 * the same. It is the experimental entry point itself: `containmentCenter`
 * through it costs 600 µs against 71 µs for the stable `polygonToCells` that
 * returns identical output.
 *
 * WHAT WAS TRIED AND REJECTED FIRST, so nobody repeats it:
 *
 * - **Batching rings into one call.** Structurally unavailable — h3-js takes
 *   `[outer, ...holes]`, one polygon per call, with no multipolygon input.
 * - **Stable `polygonToCells` plus a boundary supercover.** Ruled out by
 *   measurement: it misses cells h3 reports (524 over the corpus), and the
 *   stable call throws outright on 57 % of real rings.
 *
 * THE ALGORITHM. A cell overlaps a ring when any of three things is true, and
 * all three are needed — each is the only witness for a case the others miss:
 *
 * 1. a cell-boundary vertex lies inside the ring (the cell pokes into it),
 * 2. a ring vertex lies inside the cell (the ring is smaller than the cell, or
 *    ends inside it),
 * 3. a ring edge crosses a cell edge (they cross without either containing a
 *    vertex of the other).
 *
 * Candidates come from a grid disk around the ring's bounding-box centre.
 *
 * **CORRECTNESS DOES NOT REST ON THE DISK BEING BIG ENOUGH**, which matters
 * because sizing it from distance is exactly what went wrong first: a
 * metric-radius estimate silently under-reached on large rings and lost 23 cells
 * across the corpus. Instead the cover checks whether any cell at the disk's
 * OUTER edge was hit and declines if so. A ring is connected, so it cannot reach
 * beyond the disk without crossing that outer edge — so an untripped guard means
 * nothing was left outside. With the guard the cover is exact with no radius cap
 * at all; the cap that remains is about cost, not correctness.
 *
 * Verified against h3 over every ring the obstacle sweep covers — 3 397 of them,
 * clipped and unclipped — with zero differences in either direction.
 *
 * @see cell-overlap.ts.md
 */

import {
  cellToBoundary,
  getHexagonEdgeLengthAvg,
  greatCircleDistance,
  gridDiskDistances,
  latLngToCell,
} from "h3-js";

import { containsPoint, type PlanarPoint } from "./point-in-ring.js";
import { segmentsIntersect } from "./segment-crossing.js";

/**
 * Beyond this many candidate cells, h3's own cover is the cheaper answer.
 *
 * Each candidate costs a `cellToBoundary` plus the three-part overlap test,
 * around 5 µs; h3 costs ~0.8 ms and rises with the polygon's extent. So the two
 * break even near 160 candidates and this sits comfortably past it, where the
 * measured ratio is still ~4×. 397 is the exact size of a radius-11 disk
 * (`3k(k+1)+1`), quoted that way so it is obviously a whole disk rather than a
 * round number someone picked.
 *
 * On the corpus this declines 27 rings of 3 397 — 0.8 % — and those are the
 * largest building outlines, where h3 is genuinely the better tool.
 */
const MAX_CANDIDATE_CELLS = 397;

/**
 * The cells whose hexagon overlaps `ring`, or `undefined` to use h3 instead.
 *
 * `ring` is `x = lng, y = lat` degrees — the convention `point-in-ring.ts` and
 * `segment-crossing.ts` already use — and is treated as closed. Winding does not
 * matter.
 *
 * **`undefined` means "ask h3", never "no cells".** Declining is always safe;
 * returning a wrong set is not, so every uncertain case declines: fewer than
 * three points, any non-finite coordinate, a disk that would cost more than h3,
 * and a disk that turned out too small. An empty ARRAY, by contrast, is a real
 * answer — a ring can genuinely overlap nothing once h3 has been asked too.
 */
export function overlappingCells(
  ring: readonly PlanarPoint[],
  resolution: number,
): string[] | undefined {
  if (ring.length < 3) return undefined;

  const centre = centreOf(ring);
  if (centre === undefined) return undefined;

  const radius = diskRadius(ring, centre, resolution);
  if (radius === undefined) return undefined;

  const origin = latLngToCell(centre.lat, centre.lng, resolution);
  // The safe disk, which absorbs pentagon distortion rather than throwing —
  // `cell-coverage.ts` catches around `gridPathCells` for the same reason. The
  // catch is kept anyway and narrow: h3 documents this variant as safe, so a
  // throw here means an assumption of ours is wrong, and the honest response to
  // that is to let h3 answer rather than to return a set we cannot vouch for.
  let byDistance: string[][];
  try {
    byDistance = gridDiskDistances(origin, radius);
  } catch {
    return undefined;
  }

  const covered: string[] = [];
  for (let distance = 0; distance < byDistance.length; distance++) {
    for (const cell of byDistance[distance] ?? []) {
      if (!overlaps(ring, cell)) continue;
      // A hit on the outermost ring means the disk may have cut the cover off.
      // See the header: declining here is what makes the radius a cost knob.
      if (distance === radius) return undefined;
      covered.push(cell);
    }
  }
  return covered;
}

/** The ring's bounding-box centre, or `undefined` if any coordinate is unusable. */
function centreOf(
  ring: readonly PlanarPoint[],
): { lat: number; lng: number } | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      return undefined;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { lat: (minY + maxY) / 2, lng: (minX + maxX) / 2 };
}

/**
 * Grid steps from `centre` needed to reach every vertex, or `undefined` when
 * that disk would cost more than h3 does.
 *
 * Centre-to-centre spacing of neighbouring cells is `sqrt(3)` times the edge
 * length, which is what turns a distance in metres into a number of grid steps.
 * The `+ 2` is slack for the hexagonal disk not being a circle — and it is only
 * slack, not a guarantee: the outer-edge check in the caller is what makes the
 * radius a performance choice rather than a correctness one.
 */
function diskRadius(
  ring: readonly PlanarPoint[],
  centre: { lat: number; lng: number },
  resolution: number,
): number | undefined {
  const spacingM = Math.sqrt(3) * getHexagonEdgeLengthAvg(resolution, "m");
  let furthestM = 0;
  for (const point of ring) {
    const away = greatCircleDistance(
      [centre.lat, centre.lng],
      [point.y, point.x],
      "m",
    );
    if (away > furthestM) furthestM = away;
  }

  const radius = Math.ceil(furthestM / spacingM) + 2;
  if (!Number.isFinite(radius)) return undefined;
  if (3 * radius * (radius + 1) + 1 > MAX_CANDIDATE_CELLS) return undefined;
  return radius;
}

/** Whether `cell`'s hexagon and `ring` share any area. */
function overlaps(ring: readonly PlanarPoint[], cell: string): boolean {
  const boundary: PlanarPoint[] = cellToBoundary(cell).map(([lat, lng]) => ({
    x: lng,
    y: lat,
  }));

  for (const corner of boundary) {
    if (containsPoint(ring, corner)) return true;
  }
  for (const point of ring) {
    if (containsPoint(boundary, point)) return true;
  }
  return edgesCross(ring, boundary);
}

/** Whether any edge of `ring` crosses any edge of `boundary`. */
function edgesCross(
  ring: readonly PlanarPoint[],
  boundary: readonly PlanarPoint[],
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    for (let p = 0, q = boundary.length - 1; p < boundary.length; q = p++) {
      const c = boundary[q];
      const d = boundary[p];
      if (c === undefined || d === undefined) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}
