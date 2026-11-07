/**
 * How much of a building outline its `building:part`s cover.
 *
 * WHY IT EXISTS. Simple 3D Buildings says an outline with parts is not drawn,
 * because the parts are meant to fill it. Mappers do not always fill it: a part
 * for the tower and nothing for the hall is common, and dropping the outline
 * the moment one part claims it erases the rest of the building. Tower Bridge's
 * north tower (`way/367652787`, 7 % covered) and the Cologne station hall (2 %)
 * are the corpus cases. The rule here is the one OSM2World uses: the outline is
 * hidden only when its parts cover at least {@link PART_COVERAGE_TO_HIDE_OUTLINE}
 * of it, and drawn as well as its parts otherwise.
 *
 * @see part-coverage.ts.md
 */

import { containsPoint } from "../spatial/point-in-ring.js";
import type { PlanarPoint } from "../spatial/point-in-ring.js";

/**
 * The share of an outline its parts must cover before the outline is hidden.
 *
 * 0.9, the owner's choice (2026-11-07), swept over 0.5-0.95 on the corpus; the
 * sweep and its verdict are in the sidecar.
 */
export const PART_COVERAGE_TO_HIDE_OUTLINE = 0.9;

/** One polygon: outer ring first, then holes. */
export type PlanarPolygon = readonly (readonly PlanarPoint[])[];

/**
 * Samples per axis of the coverage grid.
 *
 * 32 x 32 cell centres over the outline's bounding box. A rectangle has all
 * 1 024 inside it, so one sample is 0.1 % of its area, far finer than the 10 %
 * margin the threshold leaves.
 */
const SAMPLES_PER_AXIS = 32;

/**
 * The share, 0-1, of the outline's area that lies inside at least one part.
 *
 * SAMPLED, NOT CLIPPED. An exact answer needs a polygon union, and nothing in
 * the package does polygon booleans; a regular grid of cell centres is a few
 * lines, has no degenerate cases, and its error is a fraction of a percent of
 * the area. It is planar in any frame (ENU metres or `x = lng, y = lat`): the
 * grid follows the bounding box, so an axis scale moves the samples with the
 * shape and the share is unchanged.
 *
 * An outline with no area inside its own grid (degenerate, or a sliver thinner
 * than a cell) returns 1, so it stays hidden exactly as before this rule.
 */
export function partCoverage(
  outline: readonly PlanarPolygon[],
  parts: readonly (readonly PlanarPolygon[])[],
): number {
  const bounds = boundsOf(outline);
  if (bounds === undefined) return 1;
  const partPolygons = parts.flat().map((polygon) => ({
    polygon,
    bounds: boundsOf([polygon]),
  }));

  let inside = 0;
  let covered = 0;
  const dx = (bounds.maxX - bounds.minX) / SAMPLES_PER_AXIS;
  const dy = (bounds.maxY - bounds.minY) / SAMPLES_PER_AXIS;
  for (let i = 0; i < SAMPLES_PER_AXIS; i += 1) {
    for (let j = 0; j < SAMPLES_PER_AXIS; j += 1) {
      const point = {
        x: bounds.minX + (i + 0.5) * dx,
        y: bounds.minY + (j + 0.5) * dy,
      };
      if (!outline.some((polygon) => inPolygon(polygon, point))) continue;
      inside += 1;
      const hit = partPolygons.some(
        (part) =>
          part.bounds !== undefined &&
          withinBounds(part.bounds, point) &&
          inPolygon(part.polygon, point),
      );
      if (hit) covered += 1;
    }
  }
  return inside === 0 ? 1 : covered / inside;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Inside the outer ring and outside every hole. */
function inPolygon(polygon: PlanarPolygon, point: PlanarPoint): boolean {
  const [outer, ...holes] = polygon;
  if (outer === undefined || !containsPoint(outer, point)) return false;
  return !holes.some((hole) => containsPoint(hole, point));
}

function withinBounds(bounds: Bounds, point: PlanarPoint): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/** Bounds of the outer rings, or `undefined` when there is no area to sample. */
function boundsOf(polygons: readonly PlanarPolygon[]): Bounds | undefined {
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  for (const polygon of polygons) {
    for (const p of polygon[0] ?? []) {
      b.minX = Math.min(b.minX, p.x);
      b.maxX = Math.max(b.maxX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxY = Math.max(b.maxY, p.y);
    }
  }
  const hasArea = b.maxX > b.minX && b.maxY > b.minY;
  return hasArea ? b : undefined;
}
