/**
 * Roof geometry, in the plan's own order of quality-per-effort.
 *
 * WHERE THE SUPPORT STOPS, AND WHY IT STOPS THERE — read this before adding a
 * shape, because the boundary is a deliberate engineering decision rather than
 * an unfinished list.
 *
 * OSM2World dispatches 26 roof classes. The plan (§8) orders them by value:
 * flat extrusion first, then `pyramidal` / `skillion` / `dome`, which are cheap
 * parametric shapes, and only then `gabled` / `hipped`. That last pair is
 * singled out because **a gabled roof on a non-rectangular footprint cannot be
 * generated without a straight skeleton** — the straight skeleton *is* the
 * mathematical description of a roof surface. That is a real algorithm, not a
 * special case.
 *
 * What ships here: `gabled` and `hipped` are generated from the footprint's
 * **oriented minimum bounding rectangle**, which is exact for the rectangular
 * footprints that dominate real data and an approximation for L-shaped and
 * cranked ones. That is a deliberate trade, and the reasoning is:
 *
 * - The census measured **12 %** non-flat `roof:shape` in one of Germany's
 *   best-mapped areas, and the majority of those sit on rectangles.
 * - §8.4 is explicit that the overlay's value is gross-failure detection, and
 *   that OSM's own footprint error is in the low metres. A ridge in
 *   approximately the right place on an L-shaped building is well inside that.
 * - A half-correct straight skeleton is worse than no straight skeleton: it
 *   produces self-intersecting roof surfaces that render as flickering
 *   z-fighting, which reads as a renderer bug rather than as a geometry bug.
 *
 * So the skeleton is **not** implemented here, the approximation is honest
 * about being one (`isApproximate` on the result), and `roof.ts.md` records the
 * exact condition under which it should be built.
 *
 * **Licence note, and it binds:** if the skeleton is built, benchmark against
 * `straight-skeleton`'s **v1 branch** (pure TypeScript). Do not touch v3 in
 * production OR in the harness — its npm package declares MIT while wrapping
 * CGAL's GPL `Straight_skeleton_2`, and reading GPL source with intent to
 * reimplement is a derivation this Apache-2.0 package must not contain.
 *
 * @see roof.ts.md
 */

import type { EnuPoint } from "./enu.js";
import { isCounterClockwise } from "./enu.js";
import type { RoofShape } from "./building-heights.js";
import type { MeshData } from "./mesh-data.js";
import { MeshBuilder } from "./mesh-data.js";
import type { TriangulationResult } from "./triangulate.js";

export interface RoofOptions {
  readonly shape: RoofShape;
  /** Height of the eaves — where the walls stop. */
  readonly eaveHeightM: number;
  /** Height of the ridge or apex. Equals the eaves for a flat roof. */
  readonly ridgeHeightM: number;
}

export interface RoofMesh extends MeshData {
  /**
   * True when the shape was approximated rather than generated exactly.
   *
   * Surfaced rather than hidden: a consumer that wants to know how much of what
   * it draws is real can ask, and a future straight-skeleton implementation has
   * a ready-made measurement of how much it would improve.
   */
  readonly isApproximate: boolean;
}

/** Builds the roof for a footprint. */
export function buildRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): RoofMesh {
  const rise = options.ridgeHeightM - options.eaveHeightM;
  const outer = rings[0];

  // No rise, no shape, or nothing to work with: a flat cap at the eaves. This
  // is also the fallback for every unrecognised `roof:shape`, because a flat
  // roof at the right height is a far smaller error than a confident wrong one.
  if (rise <= 0 || outer === undefined || options.shape === "flat") {
    return { ...flatCap(cap, options.eaveHeightM), isApproximate: false };
  }

  switch (options.shape) {
    case "pyramidal":
    case "dome":
      // A dome is approximated by a pyramid to the same apex. Honest about it:
      // at walking distance, under a shallow viewing angle, a dome and a
      // pyramid of the same height are near-indistinguishable (§8.4), and a
      // real dome needs a lat/long tessellation that is not worth its triangles
      // until something is actually seen from above.
      return {
        ...apexRoof(rings, cap, options),
        isApproximate: options.shape === "dome",
      };
    case "skillion":
      return { ...skillionRoof(rings, cap, options), isApproximate: false };
    case "gabled":
    case "hipped":
      return ridgeRoof(rings, cap, options);
    default:
      return { ...flatCap(cap, options.eaveHeightM), isApproximate: false };
  }
}

/** A horizontal cap at the eaves — the flat roof, and the universal fallback. */
function flatCap(cap: TriangulationResult, heightM: number): MeshData {
  const builder = new MeshBuilder();
  const base = cap.vertices.map((p) =>
    builder.vertex(p.x, heightM, p.y, 0, 1, 0),
  );
  for (let i = 0; i + 2 < cap.indices.length; i += 3) {
    const a = base[cap.indices[i] as number];
    const b = base[cap.indices[i + 1] as number];
    const c = base[cap.indices[i + 2] as number];
    if (a === undefined || b === undefined || c === undefined) continue;
    builder.triangle(a, c, b);
  }
  return builder.build(cap.forcedEars);
}

/**
 * A single apex above the footprint's centroid, with one triangle per edge.
 *
 * Exact for `pyramidal`. The centroid — not the bbox centre — because an
 * L-shaped footprint's bbox centre can fall outside the building entirely, and
 * an apex hanging in the air outside its own walls is the most obviously wrong
 * thing this file could produce.
 */
function apexRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): MeshData {
  // Counter-clockwise first. `extrudeBuilding` passes rings through raw and
  // real OSM footprints arrive both ways round, so without this the roof's
  // orientation depends on the mapper's drawing direction — half the pyramids
  // would face inward while their walls (which `addWalls` DOES normalise) faced
  // outward, giving a building that is wrong only from above.
  const raw = rings[0] ?? [];
  const outer = isCounterClockwise(raw) ? raw : [...raw].reverse();
  const centre = centroid(outer);
  const builder = new MeshBuilder();

  const apex = builder.vertex(
    centre.x,
    options.ridgeHeightM,
    centre.y,
    0,
    1,
    0,
  );

  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (a === undefined || b === undefined) continue;
    if (a.x === b.x && a.y === b.y) continue;

    // b BEFORE a — this file works in the ENU frame, where Y-up makes a
    // counter-clockwise (east, north) ring read as clockwise, so the natural
    // edge order winds this face downward and `faceNormal` would then agree
    // with it, lighting the pyramid from underneath. Reversing fixes the normal
    // and the emitted winding together, which is why both use this order.
    // (The ENU→render reflection is separate and lives in `MeshBuilder`.)
    const normal = faceNormal(
      { x: b.x, y: options.eaveHeightM, z: b.y },
      { x: a.x, y: options.eaveHeightM, z: a.y },
      { x: centre.x, y: options.ridgeHeightM, z: centre.y },
    );
    const i0 = builder.vertex(
      a.x,
      options.eaveHeightM,
      a.y,
      normal.x,
      normal.y,
      normal.z,
    );
    const i1 = builder.vertex(
      b.x,
      options.eaveHeightM,
      b.y,
      normal.x,
      normal.y,
      normal.z,
    );
    builder.triangle(i1, i0, apex);
  }

  // Holes are not carried into an apex roof: a courtyard under a pyramid is not
  // a shape OSM describes, and guessing would be inventing geometry.
  void cap;
  return builder.build(0);
}

/**
 * A single sloped plane, high on one side.
 *
 * `roof:direction` is not read yet — the slope runs along the footprint's
 * longest axis, which is right for the lean-to and shed cases `skillion`
 * usually tags. Reading the tag is a small, well-defined follow-up.
 */
function skillionRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): MeshData {
  const outer = rings[0] ?? [];
  const axis = longestAxis(outer);
  const projected = outer.map((p) => p.x * axis.x + p.y * axis.y);
  const min = Math.min(...projected);
  const max = Math.max(...projected);
  const span = max - min;

  const heightAt = (p: EnuPoint): number => {
    if (span === 0) return options.eaveHeightM;
    const t = (p.x * axis.x + p.y * axis.y - min) / span;
    return (
      options.eaveHeightM + t * (options.ridgeHeightM - options.eaveHeightM)
    );
  };

  // THE PLANE'S OWN NORMAL, not (0, 1, 0). A skillion is by definition a sloped
  // plane; giving it the flat-roof normal makes it shade exactly like a flat
  // roof, so the slope shows only in silhouette and the `roof:shape` tag looks
  // like it did nothing. The surface is y = eave + slope·(p·axis − min), so in
  // 3D (X = ENU x, Y = up, Z = ENU y) the upward normal is
  // (−∂Y/∂X, 1, −∂Y/∂Z) = (−slope·axis.x, 1, −slope·axis.y).
  const slope =
    span === 0 ? 0 : (options.ridgeHeightM - options.eaveHeightM) / span;
  const nx = -slope * axis.x;
  const nz = -slope * axis.y;
  const nLength = Math.hypot(nx, 1, nz);

  const builder = new MeshBuilder();
  const base = cap.vertices.map((p) => {
    const y = heightAt(p);
    return builder.vertex(p.x, y, p.y, nx / nLength, 1 / nLength, nz / nLength);
  });
  for (let i = 0; i + 2 < cap.indices.length; i += 3) {
    const a = base[cap.indices[i] as number];
    const b = base[cap.indices[i + 1] as number];
    const c = base[cap.indices[i + 2] as number];
    if (a === undefined || b === undefined || c === undefined) continue;
    builder.triangle(a, c, b);
  }
  return builder.build(cap.forcedEars);
}

/**
 * A ridged roof from the oriented minimum bounding rectangle.
 *
 * `gabled` runs the ridge the full length of the rectangle, so the short ends
 * are vertical gable walls. `hipped` pulls the ridge in by a quarter of the
 * rectangle's length at each end, so all four sides slope — which is the actual
 * difference between the two shapes.
 *
 * EXACT for a rectangular footprint. An APPROXIMATION for anything else, and it
 * says so: see the file header for why an approximation beats a half-correct
 * straight skeleton here.
 */
function ridgeRoof(
  rings: readonly (readonly EnuPoint[])[],
  cap: TriangulationResult,
  options: RoofOptions,
): RoofMesh {
  const outer = rings[0] ?? [];
  const box = orientedBoundingBox(outer);
  if (box === undefined) {
    return { ...flatCap(cap, options.eaveHeightM), isApproximate: true };
  }

  const { centre, axis, cross: crossAxis, halfLength, halfWidth } = box;
  const inset = options.shape === "hipped" ? halfLength / 2 : 0;

  const at = (along: number, across: number, height: number) => ({
    x: centre.x + axis.x * along + crossAxis.x * across,
    y: height,
    z: centre.y + axis.y * along + crossAxis.y * across,
  });

  const eaveA = at(-halfLength, -halfWidth, options.eaveHeightM);
  const eaveB = at(halfLength, -halfWidth, options.eaveHeightM);
  const eaveC = at(halfLength, halfWidth, options.eaveHeightM);
  const eaveD = at(-halfLength, halfWidth, options.eaveHeightM);
  const ridgeA = at(-halfLength + inset, 0, options.ridgeHeightM);
  const ridgeB = at(halfLength - inset, 0, options.ridgeHeightM);

  const builder = new MeshBuilder();
  const quad = (
    p: ReturnType<typeof at>,
    q: ReturnType<typeof at>,
    r: ReturnType<typeof at>,
    s: ReturnType<typeof at>,
  ): void => {
    const n = faceNormal(p, q, r);
    const i0 = builder.vertex(p.x, p.y, p.z, n.x, n.y, n.z);
    const i1 = builder.vertex(q.x, q.y, q.z, n.x, n.y, n.z);
    const i2 = builder.vertex(r.x, r.y, r.z, n.x, n.y, n.z);
    const i3 = builder.vertex(s.x, s.y, s.z, n.x, n.y, n.z);
    builder.triangle(i0, i1, i2);
    builder.triangle(i0, i2, i3);
  };

  // The two long slopes. Eave → ridge → ridge → eave, NOT eave → eave → ridge:
  // in the ENU frame Y-up makes a counter-clockwise (east, north) loop read as
  // clockwise, so going round the eave first winds every face downward and
  // `faceNormal`, derived from that same winding, then points down too — a roof
  // lit from underneath and backfacing from above. The same reason `flatCap`
  // emits (a, c, b). Independent of the ENU→render reflection, which
  // `MeshBuilder` applies centrally to every vertex and triangle.
  quad(eaveA, ridgeA, ridgeB, eaveB);
  quad(eaveC, ridgeB, ridgeA, eaveD);

  if (inset > 0) {
    // Hipped: the ends slope too.
    const tri = (
      p: ReturnType<typeof at>,
      q: ReturnType<typeof at>,
      r: ReturnType<typeof at>,
    ): void => {
      const n = faceNormal(p, q, r);
      builder.triangle(
        builder.vertex(p.x, p.y, p.z, n.x, n.y, n.z),
        builder.vertex(q.x, q.y, q.z, n.x, n.y, n.z),
        builder.vertex(r.x, r.y, r.z, n.x, n.y, n.z),
      );
    };
    // Reversed for the same handedness reason as the slopes above.
    tri(eaveA, eaveD, ridgeA);
    tri(eaveC, eaveB, ridgeB);
  } else {
    // Gabled: the ends are vertical triangles closing the volume. Without them
    // a gabled building is open at both ends — visible from the street, and a
    // classic omission.
    const gable = (
      p: ReturnType<typeof at>,
      q: ReturnType<typeof at>,
      r: ReturnType<typeof at>,
    ): void => {
      const n = faceNormal(p, q, r);
      builder.triangle(
        builder.vertex(p.x, p.y, p.z, n.x, n.y, n.z),
        builder.vertex(q.x, q.y, q.z, n.x, n.y, n.z),
        builder.vertex(r.x, r.y, r.z, n.x, n.y, n.z),
      );
    };
    // Reversed for the same handedness reason as the slopes above.
    gable(eaveA, eaveD, ridgeA);
    gable(eaveC, eaveB, ridgeB);
  }

  return {
    ...builder.build(0),
    // Exact only when the footprint IS its bounding rectangle AND has no holes.
    //
    // The hole clause is not defensive padding: this function reads `rings[0]`
    // and nothing else, so a courtyard building gets a SOLID ridge roof
    // spanning the courtyard while `isRectangular(outer, box)` is perfectly
    // true for the outer ring alone. That is the one case where the flag would
    // assert something false rather than merely be conservative — and it is
    // not rare in the European blocks this package targets. The flat, apex and
    // skillion paths all pass `rings` to `triangulate` and do honour holes.
    isApproximate: !isRectangular(outer, box) || rings.length > 1,
  };
}

function centroid(ring: readonly EnuPoint[]): EnuPoint {
  if (ring.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** Unit vector along the ring's longest edge. */
function longestAxis(ring: readonly EnuPoint[]): EnuPoint {
  let best = { x: 1, y: 0 };
  let bestLength = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length > bestLength) {
      bestLength = length;
      best = { x: dx / length, y: dy / length };
    }
  }
  return best;
}

interface OrientedBox {
  readonly centre: EnuPoint;
  /** Unit vector along the box's long side. */
  readonly axis: EnuPoint;
  /** Unit vector across it. */
  readonly cross: EnuPoint;
  readonly halfLength: number;
  readonly halfWidth: number;
}

/**
 * Minimum-area bounding rectangle by rotating calipers over edge directions.
 *
 * The minimum-area rectangle of a convex polygon always has a side flush with
 * one of its edges, so testing each edge direction is exact rather than a
 * search. Applied to the raw ring rather than its convex hull, which is a
 * simplification: for a concave footprint the result is still a valid enclosing
 * rectangle, just not provably minimal — and this shape is an approximation
 * anyway for exactly those footprints.
 */
function orientedBoundingBox(
  ring: readonly EnuPoint[],
): OrientedBox | undefined {
  if (ring.length < 3) return undefined;

  let best: OrientedBox | undefined;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    const axis = { x: dx / length, y: dy / length };
    const cross = { x: -axis.y, y: axis.x };

    let minA = Number.POSITIVE_INFINITY;
    let maxA = Number.NEGATIVE_INFINITY;
    let minC = Number.POSITIVE_INFINITY;
    let maxC = Number.NEGATIVE_INFINITY;
    for (const p of ring) {
      const along = p.x * axis.x + p.y * axis.y;
      const across = p.x * cross.x + p.y * cross.y;
      minA = Math.min(minA, along);
      maxA = Math.max(maxA, along);
      minC = Math.min(minC, across);
      maxC = Math.max(maxC, across);
    }

    const area = (maxA - minA) * (maxC - minC);
    if (area >= bestArea) continue;
    bestArea = area;

    const midA = (minA + maxA) / 2;
    const midC = (minC + maxC) / 2;
    let halfLength = (maxA - minA) / 2;
    let halfWidth = (maxC - minC) / 2;
    let finalAxis = axis;
    let finalCross = cross;
    // Keep `axis` the LONG side, so "the ridge runs along the axis" is true.
    //
    // `cross` is `axis` rotated +90°, and `ridgeRoof` relies on that handedness
    // to decide which way its faces point. A plain swap would leave
    // `finalCross === axis === rot(−90°)(finalCross')`, i.e. a MIRRORED frame,
    // and every normal derived from it would flip — so a rectangle drawn from a
    // corner on its short side would produce an inside-out roof while the same
    // rectangle drawn from the next corner round came out fine. Negating keeps
    // the frame right-handed; the box is symmetric about its centre, so which
    // side counts as +across is arbitrary.
    if (halfWidth > halfLength) {
      [halfLength, halfWidth] = [halfWidth, halfLength];
      finalAxis = cross;
      finalCross = { x: -axis.x, y: -axis.y };
    }

    best = {
      centre: {
        x: axis.x * midA + cross.x * midC,
        y: axis.y * midA + cross.y * midC,
      },
      axis: finalAxis,
      cross: finalCross,
      halfLength,
      halfWidth,
    };
  }
  return best;
}

/** True when the footprint fills its bounding rectangle, i.e. IS a rectangle. */
function isRectangular(ring: readonly EnuPoint[], box: OrientedBox): boolean {
  const boxArea = box.halfLength * box.halfWidth * 4;
  if (boxArea === 0) return false;
  let ringArea = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    ringArea += a.x * b.y - b.x * a.y;
  }
  // 2 % tolerance: a mapper's rectangle is rarely exact to the millimetre, and
  // a strict test would mark almost every real building as approximate and make
  // the flag useless.
  return Math.abs(Math.abs(ringArea) / 2 / boxArea - 1) < 0.02;
}

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit normal of the triangle `a,b,c`, wound counter-clockwise when seen from the front. */
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length === 0) return { x: 0, y: 1, z: 0 };
  return { x: nx / length, y: ny / length, z: nz / length };
}
