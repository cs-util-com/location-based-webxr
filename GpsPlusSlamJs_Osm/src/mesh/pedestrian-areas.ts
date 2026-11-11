/**
 * Mapped pedestrian areas (`highway=*` with `area=yes`: squares, plazas) as
 * surfaces draped on the terrain. `isRoad` leaves these to the area builders
 * and the plates refuse every highway, so before this builder nothing drew
 * the ground a person stands on in an old town.
 *
 * CLIPPED TO THE WINDOW BEFORE TRIANGULATING (the plates' lesson: ear
 * clipping is quadratic in ring size, and a relation reaches far outside any
 * fetch), then CUT ALONG THE TERRAIN'S POST LINES: every triangle is clipped
 * to the grid cells of `spacingM` it overlaps, so each piece lies in one cell
 * and every vertex is sampled on the ground. Draped only at its ring, a large
 * square floats over a hollow and sinks into a crest.
 *
 * The predicate is the ground tint's (`isPedestrianArea`), so the tint and
 * this mesh never classify a square two ways.
 *
 * @see pedestrian-areas.ts.md
 */

import { isBelowSurface } from "../model/below-surface.js";
import type { LatLng, OsmFeature } from "../model/osm-feature.js";
import { featureKey, type OsmFeatureKey } from "../model/osm-feature.js";
import { toGeometry } from "../model/osm-geometry.js";
import { clipToBbox, type Bbox } from "../spatial/clip.js";
import { ringToEnu, type EnuFrame, type EnuPoint } from "./enu.js";
import { isPedestrianArea } from "./ground-tint.js";
import { MeshBuilder, type MeshData } from "./mesh-data.js";
import { pedestrianAreaLiftM } from "./roads.js";
import { triangulate } from "./triangulate.js";

/**
 * The default cut spacing, metres: the terrain's post spacing
 * (`TERRAIN_SPACING_M`, held equal by a test rather than imported, so the
 * mesh builders do not depend on the elevation module).
 */
export const PEDESTRIAN_AREA_SPACING_M = 12;

/** Slivers under a square millimetre rasterise to nothing; never drawn. */
const MIN_TRIANGLE_AREA_M2 = 1e-6;

export interface BuildPedestrianAreasOptions {
  readonly frame: EnuFrame;
  /** Ground elevation at a position, metres. Absent: flat at 0. */
  readonly groundHeightM?: (position: LatLng) => number;
  /** The fetched bbox: nothing is drawn outside it. */
  readonly window: Bbox;
  /** Grid cell size the surface is cut at. Default the terrain's posts. */
  readonly spacingM?: number;
  /** Metres over the ground. Default `pedestrianAreaLiftM()`. */
  readonly liftM?: number;
}

/** One area's surface (all its polygons) as a mesh. */
export interface PedestrianArea {
  readonly feature: OsmFeatureKey;
  readonly mesh: MeshData;
}

/**
 * The pedestrian areas in `features`, in input order, each one mesh of
 * up-facing triangles. Skipped: nodes, unclosed rings (not polygons),
 * anything below the surface, and an area clipped away entirely. A ground
 * that is not a number reads as 0. RangeError for a spacing that is not a
 * finite positive number or a lift that is not finite.
 */
export function buildPedestrianAreas(
  features: Iterable<OsmFeature>,
  options: BuildPedestrianAreasOptions,
): PedestrianArea[] {
  const { spacingM, liftM } = validOptions(options);
  const out: PedestrianArea[] = [];
  for (const feature of features) {
    if (feature.type === "node" || !isPedestrianArea(feature.tags)) continue;
    if (isBelowSurface(feature)) continue;
    const polygons = polygonsOf(feature, options.frame, options.window);
    const mesh = areaMesh(polygons, spacingM, liftM, options);
    if (mesh.triangleCount > 0) {
      out.push({ feature: featureKey(feature), mesh });
    }
  }
  return out;
}

/** The spacing and lift with defaults filled; RangeError when invalid. */
function validOptions(options: BuildPedestrianAreasOptions): {
  spacingM: number;
  liftM: number;
} {
  const spacingM = options.spacingM ?? PEDESTRIAN_AREA_SPACING_M;
  if (!(Number.isFinite(spacingM) && spacingM > 0)) {
    throw new RangeError(
      `spacingM must be a finite number > 0, got ${spacingM}`,
    );
  }
  const liftM = options.liftM ?? pedestrianAreaLiftM();
  if (!Number.isFinite(liftM)) {
    throw new RangeError(`liftM must be a finite number, got ${liftM}`);
  }
  return { spacingM, liftM };
}

/** A feature's polygons, clipped to the window, as ENU rings. */
function polygonsOf(
  feature: OsmFeature,
  frame: EnuFrame,
  window: Bbox,
): EnuPoint[][][] {
  const result = toGeometry(feature);
  if (result.ok !== true) return [];
  const geometry = clipToBbox(result.geometry, window);
  if (geometry === undefined) return [];
  const toRings = (polygon: readonly (readonly LatLng[])[]): EnuPoint[][] =>
    polygon.map((ring) => ringToEnu(ring, frame));
  if (geometry.kind === "polygon") return [toRings(geometry.rings)];
  if (geometry.kind === "multipolygon") return geometry.polygons.map(toRings);
  return [];
}

function areaMesh(
  polygons: readonly EnuPoint[][][],
  spacingM: number,
  liftM: number,
  options: BuildPedestrianAreasOptions,
): MeshData {
  const builder = new MeshBuilder();
  const sample = options.groundHeightM;
  // Pieces of neighbouring triangles share their cut points: one vertex each.
  const vertices = new Map<string, number>();
  const vertex = (p: EnuPoint): number => {
    const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
    let index = vertices.get(key);
    if (index === undefined) {
      const height =
        sample === undefined ? 0 : sample(options.frame.toLatLng(p));
      index = builder.vertex(
        p.x,
        (Number.isFinite(height) ? height : 0) + liftM,
        p.y,
        0,
        1,
        0,
      );
      vertices.set(key, index);
    }
    return index;
  };
  for (const rings of polygons) {
    const { vertices: points, indices } = triangulate(rings);
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const triangle = [
        points[indices[t] as number] as EnuPoint,
        points[indices[t + 1] as number] as EnuPoint,
        points[indices[t + 2] as number] as EnuPoint,
      ];
      for (const piece of cutToCells(ccw(triangle), spacingM)) {
        fan(piece, vertex, builder);
      }
    }
  }
  return builder.build();
}

/** A convex counter-clockwise piece as a fan of up-facing triangles. */
function fan(
  piece: readonly EnuPoint[],
  vertex: (p: EnuPoint) => number,
  builder: MeshBuilder,
): void {
  const origin = piece[0] as EnuPoint;
  for (let k = 1; k + 1 < piece.length; k += 1) {
    const b = piece[k] as EnuPoint;
    const c = piece[k + 1] as EnuPoint;
    if (polygonArea([origin, b, c]) < MIN_TRIANGLE_AREA_M2) continue;
    const ia = vertex(origin);
    const ib = vertex(b);
    const ic = vertex(c);
    // Two corners merged into one shared vertex: nothing to draw.
    if (ia === ib || ib === ic || ia === ic) continue;
    // Counter-clockwise in ENU, handed over reversed: `MeshBuilder`
    // reflects north onto -z (see roads.ts's ribbon winding).
    builder.triangle(ia, ic, ib);
  }
}

/** The triangle counter-clockwise in ENU. */
function ccw(t: EnuPoint[]): EnuPoint[] {
  const [a, b, c] = t as [EnuPoint, EnuPoint, EnuPoint];
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return cross >= 0 ? t : [a, c, b];
}

/**
 * The convex pieces of a triangle inside each grid cell it overlaps
 * (Sutherland-Hodgman against the cell's four sides), counter-clockwise like
 * the triangle. Pieces under `MIN_TRIANGLE_AREA_M2` are dropped.
 */
function cutToCells(triangle: EnuPoint[], spacingM: number): EnuPoint[][] {
  const xs = triangle.map((p) => p.x);
  const ys = triangle.map((p) => p.y);
  const i0 = Math.floor(Math.min(...xs) / spacingM);
  const i1 = Math.floor(Math.max(...xs) / spacingM);
  const j0 = Math.floor(Math.min(...ys) / spacingM);
  const j1 = Math.floor(Math.max(...ys) / spacingM);
  if (i0 === i1 && j0 === j1) return [triangle];
  const pieces: EnuPoint[][] = [];
  for (let i = i0; i <= i1; i += 1) {
    for (let j = j0; j <= j1; j += 1) {
      let piece = triangle;
      piece = clipHalf(piece, (p) => p.x - i * spacingM);
      piece = clipHalf(piece, (p) => (i + 1) * spacingM - p.x);
      piece = clipHalf(piece, (p) => p.y - j * spacingM);
      piece = clipHalf(piece, (p) => (j + 1) * spacingM - p.y);
      if (piece.length >= 3 && polygonArea(piece) >= MIN_TRIANGLE_AREA_M2) {
        pieces.push(piece);
      }
    }
  }
  return pieces;
}

/** The part of a convex polygon where `side` is at least 0. */
function clipHalf(
  polygon: readonly EnuPoint[],
  side: (p: EnuPoint) => number,
): EnuPoint[] {
  const out: EnuPoint[] = [];
  for (let k = 0; k < polygon.length; k += 1) {
    const a = polygon[k] as EnuPoint;
    const b = polygon[(k + 1) % polygon.length] as EnuPoint;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    // Strictly across only: a vertex ON the line is already kept, and its
    // intersection would repeat it (a zero-area fan triangle).
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function polygonArea(polygon: readonly EnuPoint[]): number {
  let sum = 0;
  for (let k = 0; k < polygon.length; k += 1) {
    const a = polygon[k] as EnuPoint;
    const b = polygon[(k + 1) % polygon.length] as EnuPoint;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
