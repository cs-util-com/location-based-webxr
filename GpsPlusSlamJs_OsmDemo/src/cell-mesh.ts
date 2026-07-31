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
import type { EnuFrame } from "gps-plus-slam-osm";

import { type HeatScale } from "./heat-colours.js";
import { groundLift } from "./layer-order.js";
import { bandTreatment, classifyScore } from "./legend-model.js";

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
 * NOW FROM THE SHARED LADDER (`layer-order.ts`) rather than a local constant. This
 * was the only lifted layer when it was written; there are now five things that want
 * to be at ground level, and choosing each offset against whichever neighbour its
 * author happened to think of is how two of them end up coplanar and z-fighting —
 * which reads as a rendering bug rather than as a layering mistake.
 *
 * The grid is the HIGHEST of them on purpose: it is the finest-grained claim and the
 * thing a user clicks to interrogate, so it must never be occluded by a coarser one.
 */
const GRID_LIFT_M = groundLift("cells");

/**
 * The least a cell has to be for the grid to draw it.
 *
 * NARROWED FROM `CellScore` in W8. This builder reads exactly two things — the
 * cell id and one score — while `CellScore` also carries `contributors`, which
 * is the per-category provenance map and by far the largest part of a scored
 * cell. Declaring the wider type meant the worker call could not hand over just
 * what the grid needs without fabricating provenance it would never read, and
 * shipping the real provenance across the boundary would be most of the payload
 * for data the grid cannot use. A `CellScore` still satisfies this structurally.
 */
export interface DrawableCell {
  readonly cell: string;
  readonly scores: Readonly<Record<string, number>>;
}

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
  /**
   * Per-vertex RGBA, 0..1 — flat per hexagon, never interpolated across one.
   *
   * ALPHA ARRIVED WITH W13, and it carries one specific case: an `identity` cell
   * is drawn as an OUTLINE (DEC-R3-16), so its face must not be painted — but it
   * must still exist, because picking resolves `faceIndex` against these
   * triangles and DEC-7's whole reason for revealing sub-threshold cells is that
   * a hidden cell is the one cell you cannot click to ask why (DEC-R3-21).
   * Alpha 0 is a face that is present and invisible.
   */
  readonly colors: Float32Array;
  readonly indices: Uint32Array;
  /** Triangle index → cell id. What a raycast's `faceIndex` is looked up in. */
  readonly cellForTriangle: readonly string[];
  /**
   * Boundary segments for the OUTLINE-treated cells, as line pairs (W13).
   *
   * Separate buffers rather than degenerate triangles: an outline is a different
   * primitive, and three draws it with `LineSegments`. Empty when no drawn cell
   * is outline-treated, which is every case where `showBelowThreshold` is off.
   */
  readonly linePositions: Float32Array;
  /** Per-vertex RGB for {@link linePositions}. */
  readonly lineColors: Float32Array;
}

/**
 * `#rrggbb` to 0-255 components.
 *
 * The shared band answer is a hex string because the 2D map needs one for
 * Leaflet; the 3D grid needs numbers. Converting here rather than making the
 * shared function return both keeps ONE representation authoritative — two
 * would be the drift this whole item is about.
 */
function fromHex(colour: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(colour.slice(1), 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** A grid with nothing in it — what a cleared or empty snapshot draws. */
export const EMPTY_CELL_MESH: CellMesh = {
  cells: [],
  positions: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  cellForTriangle: [],
  linePositions: new Float32Array(0),
  lineColors: new Float32Array(0),
};

/**
 * Builds one merged geometry for every drawn cell.
 *
 * One buffer rather than a mesh per cell: a working set is ~931 cells, and 931
 * draw calls for flat hexagons would cost more than everything else in the
 * scene combined.
 */
export function buildCellMesh(
  cells: readonly DrawableCell[],
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
  // FOUR components: see `CellMesh.colors` for why an alpha channel exists.
  const colors = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array(triangleCount * 3);
  const cellForTriangle: string[] = [];

  /** Outline segments, collected as cells are written rather than in a second pass. */
  const linePoints: number[] = [];
  const lineTints: number[] = [];

  let v = 0;
  let c = 0;
  let i = 0;
  /** First vertex of the cell being written — accumulated, not multiplied. */
  let base = 0;
  for (const { cell, score, boundary } of boundaries) {
    // THE SAME ANSWER THE MAP USES (W13). This was `heatColour(score, scale)` for
    // every band, which returns the ramp's darkest stop for anything at or below
    // the threshold — so a veto, an identity and a below-bar cell were one
    // near-black colour here while the map drew them red, dashed-outline and dim.
    // This file's own comment claimed both views applied the same rule; that was
    // true of WHICH cells are drawn and false of what they look like.
    const band = classifyScore(score, options.threshold);
    const treatment = bandTreatment(band, score, options.scale);
    const rgb = fromHex(treatment.colour);
    // An outline-treated cell keeps its face — invisible — so it stays pickable.
    const alpha = treatment.kind === "outline" ? 0 : 1;

    const corners: { x: number; y: number; z: number }[] = [];
    for (const point of boundary) {
      const enu = options.frame.toEnu({ lat: point[0], lng: point[1] });
      positions[v] = enu.x;
      positions[v + 1] = (options.heightAt?.(enu) ?? 0) + GRID_LIFT_M;
      // ENU y is north; the scene's -z is north (the mesh frame's convention).
      positions[v + 2] = -enu.y;
      corners.push({
        x: positions[v] ?? 0,
        y: positions[v + 1] ?? 0,
        z: positions[v + 2] ?? 0,
      });
      colors[c] = rgb.r / 255;
      colors[c + 1] = rgb.g / 255;
      colors[c + 2] = rgb.b / 255;
      colors[c + 3] = alpha;
      v += 3;
      c += 4;
    }

    if (treatment.kind === "outline") {
      for (let k = 0; k < corners.length; k++) {
        const from = corners[k];
        const to = corners[(k + 1) % corners.length];
        if (from === undefined || to === undefined) continue;
        linePoints.push(from.x, from.y, from.z, to.x, to.y, to.z);
        for (let end = 0; end < 2; end++) {
          lineTints.push(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }
      }
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
    linePositions: new Float32Array(linePoints),
    lineColors: new Float32Array(lineTints),
  };
}
