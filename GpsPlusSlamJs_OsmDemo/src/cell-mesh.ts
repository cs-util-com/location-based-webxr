/**
 * Affordance cells as flat hexagons in the 3D scene.
 *
 * WHY THE 3D VIEW NEEDS THE GRID AT ALL. It showed buildings and nothing else,
 * so the two panes disagreed about what the app was displaying — the map said
 * "here is the scored ground", the scene said "here are some buildings", and
 * nothing connected them (finding M3).
 *
 * WHY IT IS THE SAME GRID, NOT A SIMILAR ONE. Cells, band rules and colours all
 * come from the same functions the map uses. A second colour path would let the
 * two views disagree about a cell's score, and a reader who catches that
 * disagreement has no way to know which one to believe — worse than the 3D view
 * simply not showing it.
 *
 * WHY GEOMETRY AND PICKING ARE BUILT TOGETHER. A raycast returns a triangle
 * index, and a triangle index is meaningless without the array that maps it back
 * to a cell. Building them in one pass is the only way they cannot drift; built
 * separately, a click would open the details panel on a confidently wrong cell.
 *
 * Pure: no three.js, no DOM. `building-view.ts` turns these buffers into a mesh,
 * which is the same split the package itself uses for buildings (plan §4.2).
 *
 * @see cell-mesh.ts.md
 */

import { cellToBoundary } from "h3-js";
import type { CellScore, EnuFrame } from "gps-plus-slam-osm";

import { heatColour, type HeatScale } from "./heat-colours.js";
import { classifyScore } from "./legend-model.js";

/**
 * Corners in an H3 boundary, and why this is not a constant.
 *
 * A cell is USUALLY 6 corners, and a pentagon 5 — but a cell straddling an
 * icosahedron EDGE gets extra vertices where the projection distortion is
 * resolved, and comes back with 7, 8 or (for a pentagon itself) 10. A fixed
 * stride of 6 truncated those to their first six corners: the hexagon drawn was
 * not the cell's footprint, and the pick region was wrong along the clipped
 * edge, silently, in a view whose whole job is being checked by eye.
 *
 * So the buffers are RAGGED — one vertex per real corner, with the per-cell
 * offset accumulated rather than multiplied. That costs the fixed stride, which
 * is why `cellForTriangle` is built in the same pass: with a variable offset,
 * a triangle index can no longer be divided back into a cell index.
 */
function fanTriangles(corners: number): number {
  return Math.max(0, corners - 2);
}

/**
 * How far above the ground plane the grid sits, metres.
 *
 * Coplanar surfaces z-fight: at exactly `y = 0` the grid and the ground would
 * flicker against each other as the camera moves, which reads as a rendering
 * bug rather than as a deliberate overlay. Small enough to be invisible at any
 * useful camera distance.
 */
const GRID_LIFT_M = 0.05;

export interface CellMeshOptions {
  readonly frame: EnuFrame;
  readonly category: string;
  readonly threshold: number;
  readonly scale: HeatScale;
  readonly showBelowThreshold: boolean;
  /**
   * Terrain relief, if any.
   *
   * Without it the grid lies flat at `y = 0` — which is right while the ground
   * is flat, and wrong the moment the ground is displaced: the cells would
   * float over valleys and be buried inside hills, in a view whose whole point
   * is judging whether the scored ground matches the real ground.
   */
  readonly heightAt?: (point: { x: number; y: number }) => number;
}

export interface CellMesh {
  /** The cells actually drawn, in the order their triangles appear. */
  readonly cells: readonly string[];
  readonly positions: Float32Array;
  /** Per-vertex RGB, 0..1 — flat per hexagon, never interpolated across one. */
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  /** Triangle index → cell id. What a raycast's `faceIndex` is looked up in. */
  readonly cellForTriangle: readonly string[];
}

/** A grid with nothing in it — what a cleared or empty snapshot draws. */
export const EMPTY_CELL_MESH: CellMesh = {
  cells: [],
  positions: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  cellForTriangle: [],
};

/**
 * Builds one merged geometry for every drawn cell.
 *
 * One buffer rather than a mesh per cell: a working set is ~931 cells, and 931
 * draw calls for flat hexagons would cost more than everything else in the
 * scene combined.
 */
export function buildCellMesh(
  cells: readonly CellScore[],
  options: CellMeshOptions,
): CellMesh {
  const drawn: { cell: string; score: number }[] = [];
  for (const cell of cells) {
    const score = cell.scores[options.category] ?? 1;
    const band = classifyScore(score, options.threshold);
    // The SAME rule the map applies. Two views disagreeing about which cells
    // exist is exactly the disagreement the shared store exists to prevent.
    if (band !== "ramp" && !options.showBelowThreshold) continue;
    drawn.push({ cell: cell.cell, score });
  }
  if (drawn.length === 0) return EMPTY_CELL_MESH;

  // Resolved up front because the buffers are ragged: the total vertex count is
  // not `drawn.length * 6` and cannot be known without asking every cell.
  const boundaries = drawn.map(({ cell, score }) => ({
    cell,
    score,
    boundary: cellToBoundary(cell),
  }));
  const vertexCount = boundaries.reduce((sum, c) => sum + c.boundary.length, 0);
  const triangleCount = boundaries.reduce(
    (sum, c) => sum + fanTriangles(c.boundary.length),
    0,
  );

  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triangleCount * 3);
  const cellForTriangle: string[] = [];

  let v = 0;
  let i = 0;
  /** First vertex of the cell being written — accumulated, not multiplied. */
  let base = 0;
  for (const { cell, score, boundary } of boundaries) {
    const rgb = heatColour(score, options.scale);

    for (const point of boundary) {
      const enu = options.frame.toEnu({ lat: point[0], lng: point[1] });
      positions[v] = enu.x;
      positions[v + 1] = (options.heightAt?.(enu) ?? 0) + GRID_LIFT_M;
      // ENU y is north; the scene's -z is north (the mesh frame's convention).
      positions[v + 2] = -enu.y;
      colors[v] = rgb.r / 255;
      colors[v + 1] = rgb.g / 255;
      colors[v + 2] = rgb.b / 255;
      v += 3;
    }

    // Triangle fan from corner 0. An H3 boundary is convex at any corner count,
    // so a fan is correct by construction for all of them.
    for (let corner = 1; corner < boundary.length - 1; corner++) {
      indices[i] = base;
      indices[i + 1] = base + corner;
      indices[i + 2] = base + corner + 1;
      i += 3;
      cellForTriangle.push(cell);
    }
    base += boundary.length;
  }

  return {
    cells: drawn.map((d) => d.cell),
    positions,
    colors,
    indices,
    cellForTriangle,
  };
}
