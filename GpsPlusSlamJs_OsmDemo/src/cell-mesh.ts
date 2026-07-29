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

/** Corners in an H3 boundary. Fanned from corner 0 into `CORNERS - 2` triangles. */
const CORNERS = 6;

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

  const positions = new Float32Array(drawn.length * CORNERS * 3);
  const colors = new Float32Array(drawn.length * CORNERS * 3);
  const indices = new Uint32Array(drawn.length * (CORNERS - 2) * 3);
  const cellForTriangle: string[] = [];

  let v = 0;
  let i = 0;
  for (const [index, { cell, score }] of drawn.entries()) {
    const base = index * CORNERS;
    const rgb = heatColour(score, options.scale);

    const boundary = cellToBoundary(cell);
    for (let corner = 0; corner < CORNERS; corner++) {
      // An H3 boundary is usually 6 corners but can be 5 at a pentagon; repeat
      // the last one rather than emitting a ragged buffer, so the fan below
      // stays a fixed stride and degenerate triangles simply draw nothing.
      const point = boundary[Math.min(corner, boundary.length - 1)] ?? [0, 0];
      const enu = options.frame.toEnu({ lat: point[0], lng: point[1] });
      positions[v] = enu.x;
      positions[v + 1] = GRID_LIFT_M;
      // ENU y is north; the scene's -z is north (the mesh frame's convention).
      positions[v + 2] = -enu.y;
      colors[v] = rgb.r / 255;
      colors[v + 1] = rgb.g / 255;
      colors[v + 2] = rgb.b / 255;
      v += 3;
    }

    // Triangle fan from corner 0. A convex hexagon fans correctly by
    // construction, and H3 boundaries are convex.
    for (let corner = 1; corner < CORNERS - 1; corner++) {
      indices[i] = base;
      indices[i + 1] = base + corner;
      indices[i + 2] = base + corner + 1;
      i += 3;
      cellForTriangle.push(cell);
    }
  }

  return {
    cells: drawn.map((d) => d.cell),
    positions,
    colors,
    indices,
    cellForTriangle,
  };
}
