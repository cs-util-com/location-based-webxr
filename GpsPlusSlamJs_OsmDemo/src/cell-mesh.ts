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

import { heatFraction, type HeatScale } from "./heat-colours.js";
import { CELL_BAR_MAX_HEIGHT_M, CELL_PRISM_HEIGHT_M } from "./cell-presets.js";
import { bevelNormals } from "./cell-bevel.js";
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

/** The mean of a ring's corners — which way "out" is, for the side normals. */
function ringCentre(corners: readonly { x: number; z: number }[]): {
  x: number;
  z: number;
} {
  let x = 0;
  let z = 0;
  for (const corner of corners) {
    x += corner.x;
    z += corner.z;
  }
  const count = corners.length || 1;
  return { x: x / count, z: z / count };
}

/**
 * How deep an extruded cell is, metres (§3, DEC-R6-9).
 *
 * A CONSTANT unless the bar-field axis is on, in which case it is the score's
 * position on the SAME ramp that decides the colour. Both come from
 * `heatFraction`, and that is the point rather than a convenience: colour and
 * height then encode one value, so they cannot contradict each other. Two
 * mappings would produce a tall cell in a cool colour, which reads as a
 * rendering artefact rather than as a wrong answer.
 *
 * FLOORED AT THE PLAIN PRISM HEIGHT, so the lowest bar is still an object. A bar
 * field that drops its smallest values is a bar field that lies about coverage.
 */
function prismHeightM(score: number, options: CellMeshOptions): number {
  if (options.heightByScore !== true) return CELL_PRISM_HEIGHT_M;
  const fraction = heatFraction(score, options.scale);
  // INTERPOLATED BETWEEN the floor and the ceiling rather than added to the
  // floor, so `CELL_BAR_MAX_HEIGHT_M` is genuinely the maximum. Adding would
  // make the tallest bar exceed the constant that declares the limit — a small
  // discrepancy, and exactly the kind that makes a later reader distrust the
  // name rather than the number.
  return (
    CELL_PRISM_HEIGHT_M +
    fraction * (CELL_BAR_MAX_HEIGHT_M - CELL_PRISM_HEIGHT_M)
  );
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
  /**
   * Give each cell real thickness with side faces (§3, DEC-R6-9).
   *
   * TWO RINGS, NOT PER-FACE SIDES. A top ring and a bottom ring, with the side
   * quads indexing both — 2x the vertices rather than the 5x that per-face side
   * normals would need. The cost of that choice is that the vertical edges shade
   * as a rounded bevel rather than as crisp facets, which is a real difference
   * from the prototype and the thing to look at if the preset disappoints.
   */
  readonly extrude?: boolean;
  /**
   * Scale each cell's height by its score, making the overlay a bar field.
   *
   * Requires {@link extrude}: a bar needs sides. Ignored without it, rather than
   * lifting a flat fan to a random height — which would look like a levitating
   * grid rather than like a setting that did nothing.
   */
  readonly heightByScore?: boolean;
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
  /**
   * Per-vertex normals carrying the faked rim bevel (DEC-S2).
   *
   * Present because the grid material became LIT: a flat-up normal everywhere
   * would give every tile the same constant shade and none of the edge highlight
   * the bevel exists for. `cell-bevel.ts` owns the arithmetic and the bound.
   */
  readonly normals: Float32Array;
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
  normals: new Float32Array(0),
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
  // EXTRUSION DOUBLES THE RINGS AND ADDS TWO TRIANGLES PER EDGE (§3). Sized up
  // front for the same reason the flat case is: the buffers are ragged, because
  // an H3 boundary is usually six corners and sometimes five.
  const extrude = options.extrude === true;
  const vertexCount = boundaries.reduce(
    (sum, c) => sum + c.boundary.length * (extrude ? 2 : 1),
    0,
  );
  const triangleCount = boundaries.reduce(
    (sum, c) =>
      sum +
      fanTriangles(c.boundary.length) +
      (extrude ? c.boundary.length * 2 : 0),
    0,
  );

  const positions = new Float32Array(vertexCount * 3);
  // FOUR components: see `CellMesh.colors` for why an alpha channel exists.
  const colors = new Float32Array(vertexCount * 4);
  const normals = new Float32Array(vertexCount * 3);
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

    // THE FAKED BEVEL (DEC-S2). Written per cell rather than per vertex because
    // the lean is relative to THIS cell centroid, which only exists once the
    // whole ring is collected. See cell-bevel.ts for what the lie costs.
    const cellNormals = bevelNormals(corners);
    for (let k = 0; k < cellNormals.length; k += 1) {
      normals[v - cellNormals.length + k] = cellNormals[k] ?? 0;
    }
    // The ring's centre, for the side normals below. Derived here rather than
    // inside the extrusion branch so it is computed from the SAME corners the
    // bevel leaned away from — two centroids would be two answers to "which way
    // is out", and they would disagree at the corners where it matters.
    const centroid = ringCentre(corners);

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

    if (extrude) {
      // THE BOTTOM RING, written after the top one so `base` still points at the
      // top ring's first vertex and the side quads can index both by offset.
      const ring = boundary.length;
      const depth = prismHeightM(score, options);
      for (let k = 0; k < ring; k++) {
        const top = corners[k];
        if (top === undefined) continue;
        positions[v] = top.x;
        positions[v + 1] = top.y - depth;
        positions[v + 2] = top.z;
        // OUTWARD AND HORIZONTAL, so the side shades as a wall rather than as
        // more floor. Derived from the corner's offset from the cell centroid,
        // which is the same quantity `bevelNormals` already leans the top ring
        // by — so the two agree about which way "out" is.
        const outX = top.x - centroid.x;
        const outZ = top.z - centroid.z;
        const outLength = Math.hypot(outX, outZ) || 1;
        normals[v] = outX / outLength;
        normals[v + 1] = 0;
        normals[v + 2] = outZ / outLength;
        colors[c] = rgb.r / 255;
        colors[c + 1] = rgb.g / 255;
        colors[c + 2] = rgb.b / 255;
        // The SIDES stay opaque even when the top does not. An outline-treated
        // cell has no face to speak of, and giving its walls alpha 0 too keeps
        // "invisible but pickable" meaning exactly what it did before.
        colors[c + 3] = alpha;
        v += 3;
        c += 4;
      }
      // One quad per edge, wound so the outside faces out.
      for (let k = 0; k < ring; k++) {
        const nextK = (k + 1) % ring;
        const topA = base + k;
        const topB = base + nextK;
        const bottomA = base + ring + k;
        const bottomB = base + ring + nextK;
        indices[i] = topA;
        indices[i + 1] = bottomA;
        indices[i + 2] = topB;
        indices[i + 3] = topB;
        indices[i + 4] = bottomA;
        indices[i + 5] = bottomB;
        i += 6;
        // BOTH new triangles get the cell id. Picking resolves `faceIndex`
        // against this array, so a side triangle with no entry would make every
        // pick after it name the wrong cell.
        cellForTriangle.push(cell, cell);
      }
      base += ring * 2;
    } else {
      base += boundary.length;
    }
  }

  return {
    cells: drawn.map((d) => d.cell),
    positions,
    colors,
    normals,
    indices,
    cellForTriangle,
    linePositions: new Float32Array(linePoints),
    lineColors: new Float32Array(lineTints),
  };
}
