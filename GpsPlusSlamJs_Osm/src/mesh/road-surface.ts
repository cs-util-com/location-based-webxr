/**
 * The ground a road actually draws on, at any point in plan: what lies on a
 * road (zebra paint) or under it (a pedestrian square) must follow it.
 *
 * WHY. A ribbon samples the ground only at its own vertices and is a straight
 * chord between them, so on curved ground it parts from the ground under its
 * middle. Paint and squares sampled the ground at their own points, so the
 * paint sank under the road and squares rose over the roads crossing them,
 * by metres on a hill against clearances of 5-8 mm. Asking this index for
 * the road's ground instead puts them on the same chord as the road.
 *
 * The answer is the ribbon's height minus its own rank lift, so the caller
 * adds its own lift (the markings' or the squares') and the order of
 * the layers holds as on flat ground.
 *
 * @see road-surface.ts.md
 */

import type { EnuPoint } from "./enu.js";
import type { RoadRibbon } from "./roads.js";

/** The road ground at a point in plan, or undefined off every road. */
export interface RoadGround {
  /** The highest ground of the ribbons covering `p` (for paint on them). */
  highestAt(p: EnuPoint): number | undefined;
  /** The lowest ground of the ribbons covering `p` (for squares under them). */
  lowestAt(p: EnuPoint): number | undefined;
}

/** The grid cell of the index, metres: a few road widths. */
const CELL_M = 16;

/**
 * Barycentric slack: a point on a shared edge counts in both triangles, and a
 * vertex the float32 mesh rounds a hair outside its ribbon still counts.
 */
const EDGE_EPSILON = 1e-6;

/** One ribbon triangle in plan (east, north) with its ground heights. */
interface PlanTriangle {
  readonly e: readonly [number, number, number];
  readonly n: readonly [number, number, number];
  readonly h: readonly [number, number, number];
}

/**
 * Indexes `ribbons` (as `buildRoads` returns them). A ribbon whose mesh or
 * lift is not finite is skipped, so one bad way cannot poison its
 * neighbours.
 */
export function roadGroundIndex(ribbons: readonly RoadRibbon[]): RoadGround {
  const cells = new Map<string, PlanTriangle[]>();
  for (const ribbon of ribbons) {
    if (!Number.isFinite(ribbon.liftM)) continue;
    for (const triangle of planTriangles(ribbon)) addToCells(cells, triangle);
  }

  const heightsAt = (p: EnuPoint): number[] => {
    const out: number[] = [];
    for (const triangle of cells.get(`${cell(p.x)},${cell(p.y)}`) ?? []) {
      const h = heightIn(triangle, p);
      if (h !== undefined) out.push(h);
    }
    return out;
  };
  return {
    highestAt(p) {
      const hs = heightsAt(p);
      return hs.length === 0 ? undefined : Math.max(...hs);
    },
    lowestAt(p) {
      const hs = heightsAt(p);
      return hs.length === 0 ? undefined : Math.min(...hs);
    },
  };
}

/** Files `triangle` under every grid cell its bounding box touches. */
function addToCells(
  cells: Map<string, PlanTriangle[]>,
  triangle: PlanTriangle,
): void {
  const [x0, x1] = span(triangle.e);
  const [y0, y1] = span(triangle.n);
  for (let i = cell(x0); i <= cell(x1); i += 1) {
    for (let j = cell(y0); j <= cell(y1); j += 1) {
      const key = `${i},${j}`;
      const list = cells.get(key);
      if (list === undefined) cells.set(key, [triangle]);
      else list.push(triangle);
    }
  }
}

function cell(metres: number): number {
  return Math.floor(metres / CELL_M);
}

function span(values: readonly [number, number, number]): [number, number] {
  return [Math.min(...values), Math.max(...values)];
}

/** The ribbon's triangles in plan, its lift taken off (mesh z is -north). */
function planTriangles(ribbon: RoadRibbon): PlanTriangle[] {
  const { positions, indices } = ribbon.mesh;
  const out: PlanTriangle[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const e: number[] = [];
    const n: number[] = [];
    const h: number[] = [];
    for (let k = 0; k < 3; k += 1) {
      const v = (indices[t + k] as number) * 3;
      e.push(positions[v] as number);
      h.push((positions[v + 1] as number) - ribbon.liftM);
      n.push(-(positions[v + 2] as number));
    }
    if (![...e, ...n, ...h].every(Number.isFinite)) continue;
    out.push({
      e: e as [number, number, number],
      n: n as [number, number, number],
      h: h as [number, number, number],
    });
  }
  return out;
}

/** The triangle's height at `p` by barycentric weights; undefined outside. */
function heightIn(t: PlanTriangle, p: EnuPoint): number | undefined {
  const [x0, x1, x2] = t.e;
  const [y0, y1, y2] = t.n;
  const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
  if (Math.abs(d) < 1e-12) return undefined;
  const a = ((y1 - y2) * (p.x - x2) + (x2 - x1) * (p.y - y2)) / d;
  const b = ((y2 - y0) * (p.x - x2) + (x0 - x2) * (p.y - y2)) / d;
  const c = 1 - a - b;
  if (a < -EDGE_EPSILON || b < -EDGE_EPSILON || c < -EDGE_EPSILON) {
    return undefined;
  }
  return a * t.h[0] + b * t.h[1] + c * t.h[2];
}
