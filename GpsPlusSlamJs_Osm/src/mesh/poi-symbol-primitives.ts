/**
 * The shapes the SYMBOL port needed and the fifty-model vocabulary never had
 * (DEC-S15, stage 0c).
 *
 * WHY A SECOND PRIMITIVE FILE. `poi-primitives.ts` was written for street
 * furniture: boxes, prisms, slabs on legs, pitched huts. It is the right
 * vocabulary for a bench and it cannot express a capsule, a cask or a
 * stethoscope. The five prototype galleries reach for a different set —
 * hemispheres, tori, solids of revolution, extruded outlines and swept tubes —
 * and 27 winners are drawn with them.
 *
 * They are kept apart rather than appended because they are a COHERENT GROUP
 * with one justification, and because the file they would join is already long
 * enough that adding five more builders would bury the ones a reader is
 * looking for. Both files emit into the same `MeshBuilder` and obey the same
 * contract, so a model composes freely across the two.
 *
 * THE CONTRACT IS THE SAME ONE, and it is not optional:
 *
 *  - **ENU coordinates** (`+y` up, `+z` north). `MeshBuilder.vertex` applies the
 *    reflection into the render frame; emitting render-frame coordinates would
 *    double-apply it.
 *  - **Every triangle is wound so its vertex order agrees with its own normal.**
 *    The POI material is `FrontSide` with `flatShading`, so three derives the
 *    shading normal from the winding and ignores the attribute: a reversed
 *    triangle draws the object's far interior wall, with an unchanged silhouette
 *    and no error anywhere. All five builders below are in the winding suite in
 *    `poi-symbol-primitives.test.ts` for exactly that reason — the fifty-model
 *    vocabulary shipped inside-out for eighteen work items because its emitters
 *    were not.
 *  - **No degenerate triangles.** A zero-area face has a NaN normal, and one NaN
 *    position removes the whole object from the scene with nothing reported.
 *    Poles and axis points are therefore fans, never collapsed quads.
 *
 * @see poi-symbol-primitives.ts.md
 */

import type { MeshBuilder } from "./mesh-data.js";
import { triangulate } from "./triangulate.js";

/** A point on a lathe profile: distance from the axis, and height. */
export type LatheProfilePoint = readonly [radius: number, y: number];

/** A 2D outline point, in the XY plane, for `extrudedPolygon`. */
export type OutlinePoint = readonly [x: number, y: number];

/** A point on a swept path, in ENU metres. */
export type PathPoint = readonly [x: number, y: number, z: number];

/**
 * A hemisphere: flat face at `y`, bulging up or down, capped.
 *
 * **CAPPED, unlike the prototypes' own.** Their domes come from three's
 * `SphereGeometry` with a half phi range, which has no disc across the equator —
 * invisible there because every dome in the five galleries sits against
 * something opaque. Ours must survive being a FLOATING symbol over a roof with
 * nothing under it (DEC-S4), where an open shell reads as a hole rather than as
 * a saving. That is the same call `prism` already made for its end caps.
 */
export function dome(
  builder: MeshBuilder,
  radius: number,
  y: number,
  segments = 12,
  rings = 5,
  up = true,
  offsetX = 0,
  offsetZ = 0,
): void {
  const sign = up ? 1 : -1;
  const point = (
    ring: number,
    segment: number,
  ): [number, number, number, number, number, number] => {
    // `phi` runs from the pole (0) to the equator (pi/2), so ring `rings` lands
    // exactly on the flat face rather than near it.
    const phi = (ring / rings) * (Math.PI / 2);
    const theta = (segment / segments) * Math.PI * 2;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi) * sign;
    const nz = Math.sin(phi) * Math.sin(theta);
    return [
      offsetX + nx * radius,
      y + ny * radius,
      offsetZ + nz * radius,
      nx,
      ny,
      nz,
    ];
  };

  // One place decides the order, because flipping the dome flips its winding
  // too — the surface faces the other way, and a per-call `if (up)` at four
  // sites is four chances to get one of them backwards.
  const wind = (a: number, b: number, c: number): void => {
    if (up) builder.triangle(a, b, c);
    else builder.triangle(a, c, b);
  };

  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const ia = builder.vertex(...point(ring, segment));
      const ib = builder.vertex(...point(ring, segment + 1));
      const ic = builder.vertex(...point(ring + 1, segment + 1));
      const id = builder.vertex(...point(ring + 1, segment));
      // The pole ring's a/b coincide, so one triangle of that quad is
      // degenerate and is skipped rather than emitted with a NaN normal.
      if (ring > 0) wind(ia, ib, ic);
      wind(ia, ic, id);
    }
  }

  domeCap(builder, radius, y, segments, -sign, [offsetX, offsetZ], wind);
}

/**
 * The disc that closes a dome, facing AWAY from the bulge.
 *
 * Separate because it is the part that differs from the sources, and a reader
 * asking "does ours have a bottom?" should find one function rather than a tail
 * of loops.
 */
function domeCap(
  builder: MeshBuilder,
  radius: number,
  y: number,
  segments: number,
  normalY: number,
  offset: readonly [number, number],
  wind: (a: number, b: number, c: number) => void,
): void {
  const [offsetX, offsetZ] = offset;
  const centre = builder.vertex(offsetX, y, offsetZ, 0, normalY, 0);
  const rim: number[] = [];
  for (let segment = 0; segment < segments; segment++) {
    const theta = (segment / segments) * Math.PI * 2;
    rim.push(
      builder.vertex(
        offsetX + Math.cos(theta) * radius,
        y,
        offsetZ + Math.sin(theta) * radius,
        0,
        normalY,
        0,
      ),
    );
  }
  for (let i = 0; i < segments; i++) {
    wind(centre, rim[i] as number, rim[(i + 1) % segments] as number);
  }
}

/**
 * A torus lying in the XZ plane, centred at `y`, hole axis along `+y`.
 *
 * **THE PROTOTYPES BUILD THEIRS IN XY AND ROTATE IT FLAT** (`rx:90`), because
 * that is three's `TorusGeometry` orientation. Ours is authored lying down
 * instead, since every use in the 27 winners is a horizontal hoop — a cask
 * band, a fountain rim, a ring badge. A caller that wants it upright turns it
 * with `pushTransform`, which is the same escape hatch the ports already use.
 *
 * `arc` draws a partial ring, for a handle.
 */
export function torus(
  builder: MeshBuilder,
  radius: number,
  tubeRadius: number,
  y: number,
  radialSegments = 12,
  tubeSegments = 6,
  arc = Math.PI * 2,
  offsetX = 0,
  offsetZ = 0,
): void {
  const point = (
    ring: number,
    segment: number,
  ): [number, number, number, number, number, number] => {
    const u = (ring / radialSegments) * arc;
    const v = (segment / tubeSegments) * Math.PI * 2;
    // The ring's centre line, in XZ.
    const cx = Math.cos(u) * radius;
    const cz = Math.sin(u) * radius;
    // The tube's own normal: outward in the ring plane by cos(v), up by sin(v).
    const nx = Math.cos(u) * Math.cos(v);
    const ny = Math.sin(v);
    const nz = Math.sin(u) * Math.cos(v);
    return [
      offsetX + cx + nx * tubeRadius,
      y + ny * tubeRadius,
      offsetZ + cz + nz * tubeRadius,
      nx,
      ny,
      nz,
    ];
  };

  for (let ring = 0; ring < radialSegments; ring++) {
    for (let segment = 0; segment < tubeSegments; segment++) {
      const ia = builder.vertex(...point(ring, segment));
      const ib = builder.vertex(...point(ring + 1, segment));
      const ic = builder.vertex(...point(ring + 1, segment + 1));
      const id = builder.vertex(...point(ring, segment + 1));
      // THE ORDER RUNS AGAINST THE PARAMETRISATION, and that is not a style
      // choice. For this (u, v) sweep cross(du, dv) points INWARD, so taking
      // the quad in parameter order would wind every triangle against its own
      // normal. `MeshBuilder.triangle` separately reverses for the ENU-to-render
      // reflection, so what is written here is the ENU-correct order. Pinned by
      // the winding suite, which is the only reason either claim is trustworthy.
      builder.triangle(ia, ic, ib);
      builder.triangle(ia, id, ic);
    }
  }
}

/**
 * A solid of revolution: a profile in the (radius, y) plane, spun about `+y`.
 *
 * The profile is the source's own, point for point — this is how a cask, an urn
 * and a mortar are drawn in the galleries, and re-expressing one as a stack of
 * prisms would lose exactly the curvature it was chosen for.
 *
 * **A profile point ON THE AXIS closes the solid there**, and its quad collapses
 * to a triangle rather than being emitted degenerate. A profile that starts and
 * ends on the axis therefore needs no caps; one that does not is a shell, which
 * is the caller's decision to make.
 */
export function lathe(
  builder: MeshBuilder,
  profile: readonly LatheProfilePoint[],
  sides = 12,
  baseY = 0,
  offsetX = 0,
  offsetZ = 0,
): void {
  for (let i = 0; i + 1 < profile.length; i++) {
    latheBand(
      builder,
      profile[i] as LatheProfilePoint,
      profile[i + 1] as LatheProfilePoint,
      sides,
      [offsetX, baseY, offsetZ],
    );
  }
}

/**
 * One band of a lathe: the surface swept between two adjacent profile points.
 *
 * Split out of `lathe` so each has one job — the loop over the profile, and the
 * geometry of a single band. It is also where both degenerate cases live, which
 * is where a reader looking for "what happens on the axis" will go.
 */
function latheBand(
  builder: MeshBuilder,
  start: LatheProfilePoint,
  end: LatheProfilePoint,
  sides: number,
  origin: readonly [number, number, number],
): void {
  const [r0, y0] = start;
  const [r1, y1] = end;
  // Both ends on the axis is a zero-area band, not a shape.
  if (r0 === 0 && r1 === 0) return;
  // The outward normal of this profile segment, in the (radius, y) plane:
  // perpendicular to its tangent, pointing away from the axis.
  const dr = r1 - r0;
  const dy = y1 - y0;
  const length = Math.hypot(dr, dy);
  if (!(length > 0)) return;
  const nr = dy / length;
  const ny = -dr / length;
  const [offsetX, baseY, offsetZ] = origin;

  for (let side = 0; side < sides; side++) {
    const t0 = (side / sides) * Math.PI * 2;
    const t1 = ((side + 1) / sides) * Math.PI * 2;
    const at = (
      radius: number,
      y: number,
      theta: number,
    ): [number, number, number, number, number, number] => [
      offsetX + Math.cos(theta) * radius,
      baseY + y,
      offsetZ + Math.sin(theta) * radius,
      nr * Math.cos(theta),
      ny,
      nr * Math.sin(theta),
    ];
    const a = builder.vertex(...at(r0, y0, t0));
    const b = builder.vertex(...at(r0, y0, t1));
    const c = builder.vertex(...at(r1, y1, t1));
    const d = builder.vertex(...at(r1, y1, t0));
    // On the axis the two vertices of that edge coincide; emitting the quad
    // whole would add a zero-area triangle and therefore a NaN normal.
    // Against the parametrisation, as `torus` explains.
    if (r0 !== 0) builder.triangle(a, c, b);
    if (r1 !== 0) builder.triangle(a, d, c);
  }
}

/** The signed area of an XY outline; positive when counter-clockwise. */
function signedArea(points: readonly OutlinePoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i] as OutlinePoint;
    const [x1, y1] = points[(i + 1) % points.length] as OutlinePoint;
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
}

/**
 * A flat outline in the XY plane, given thickness along Z and centred on it.
 *
 * The galleries' `extr()`, which is how a knife blade, a trowel head, a roof
 * gable and a pennant are drawn — shapes with a silhouette that no axis-aligned
 * primitive can express.
 *
 * **CENTRED ON Z, matching the sources**, which extrude from 0 and then
 * translate back by half the depth. Getting that wrong offsets a blade by its
 * own thickness, which is invisible on its own and wrong against the handle it
 * is supposed to meet.
 *
 * **The winding is NORMALISED before use.** An outline typed clockwise would
 * otherwise turn every side wall's normal inward — the whole-model inversion
 * this vocabulary's sibling shipped once already, arriving one shape at a time.
 */
export function extrudedPolygon(
  builder: MeshBuilder,
  outline: readonly OutlinePoint[],
  depth: number,
  offsetY = 0,
  offsetX = 0,
  offsetZ = 0,
): void {
  if (outline.length < 3 || !(depth > 0)) return;
  const points =
    signedArea(outline) < 0 ? [...outline].reverse() : [...outline];
  const zFront = offsetZ + depth / 2;
  const zBack = offsetZ - depth / 2;

  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i] as OutlinePoint;
    const [x1, y1] = points[(i + 1) % points.length] as OutlinePoint;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    // To the RIGHT of the direction of travel, which for a counter-clockwise
    // outline is outward.
    const nx = dy / length;
    const ny = -dx / length;
    const a = builder.vertex(offsetX + x0, offsetY + y0, zBack, nx, ny, 0);
    const b = builder.vertex(offsetX + x0, offsetY + y0, zFront, nx, ny, 0);
    const c = builder.vertex(offsetX + x1, offsetY + y1, zFront, nx, ny, 0);
    const d = builder.vertex(offsetX + x1, offsetY + y1, zBack, nx, ny, 0);
    // Against the outline direction, as `torus` explains.
    builder.triangle(a, c, b);
    builder.triangle(a, d, c);
  }

  // The caps, through the package's own ear clipper rather than a fan: these
  // outlines are routinely concave (a blade, an arrowhead), and a fan from one
  // vertex spills outside a concave shape.
  const result = triangulate([points.map(([x, y]) => ({ x, y }))]);
  for (let i = 0; i + 2 < result.indices.length; i += 3) {
    const tri = [
      result.indices[i] as number,
      result.indices[i + 1] as number,
      result.indices[i + 2] as number,
    ].map((index) => result.vertices[index] as { x: number; y: number });
    const [p0, p1, p2] = tri as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const front = [p0, p1, p2].map((p) =>
      builder.vertex(offsetX + p.x, offsetY + p.y, zFront, 0, 0, 1),
    ) as [number, number, number];
    const back = [p0, p1, p2].map((p) =>
      builder.vertex(offsetX + p.x, offsetY + p.y, zBack, 0, 0, -1),
    ) as [number, number, number];
    // The caps take `triangulate`'s order as given for the front and reversed
    // for the back — the OPPOSITE of the side walls above, because the ear
    // clipper already returns counter-clockwise triangles in the XY plane and
    // the walls are built from the outline directly. Getting this backwards
    // inverts both caps while leaving the walls correct, which shows up as a
    // solid of one third the right volume rather than as anything visible.
    builder.triangle(front[0], front[1], front[2]);
    builder.triangle(back[0], back[2], back[1]);
  }
}

/** Normalises a vector, returning `undefined` when it has no length. */
function unit(
  v: readonly [number, number, number],
): [number, number, number] | undefined {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0)) return undefined;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * A cross-section reference direction per point, PARALLEL-TRANSPORTED.
 *
 * Each frame is the previous one with its component along the new tangent
 * removed, starting from a seed that is not parallel to the first tangent.
 *
 * **The alternative — rebuilding the frame at every point from a fixed
 * up-vector — is the classic failure**: the tube spins about its own axis
 * wherever the path turns, which reads as a corkscrew in the flat shading and
 * is asserted against in the tests.
 */
function transportedNormals(
  tangents: readonly [number, number, number][],
): [number, number, number][] {
  const first = tangents[0] as [number, number, number];
  const seed: [number, number, number] =
    Math.abs(first[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let normal = unit(cross(cross(first, seed), first)) ?? [1, 0, 0];
  const normals: [number, number, number][] = [];
  for (const tangent of tangents) {
    const dot =
      normal[0] * tangent[0] + normal[1] * tangent[1] + normal[2] * tangent[2];
    normal = unit([
      normal[0] - tangent[0] * dot,
      normal[1] - tangent[1] * dot,
      normal[2] - tangent[2] * dot,
    ]) ?? [1, 0, 0];
    normals.push(normal);
  }
  return normals;
}

/**
 * One ring of tube vertices around a path point, in its transported frame.
 *
 * The normal of each vertex is its own outward direction from the path — not
 * the face normal — which is what gives a low-sided tube its faceted read
 * rather than a smeared one.
 */
function tubeRing(
  builder: MeshBuilder,
  centre: PathPoint,
  normal: readonly [number, number, number],
  binormal: readonly [number, number, number],
  radius: number,
  sides: number,
): number[] {
  const ring: number[] = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const nx = normal[0] * cosine + binormal[0] * sine;
    const ny = normal[1] * cosine + binormal[1] * sine;
    const nz = normal[2] * cosine + binormal[2] * sine;
    ring.push(
      builder.vertex(
        centre[0] + nx * radius,
        centre[1] + ny * radius,
        centre[2] + nz * radius,
        nx,
        ny,
        nz,
      ),
    );
  }
  return ring;
}

/**
 * One unit tangent per path point, or `undefined` if any is undefined.
 *
 * The segment direction at the ends and the AVERAGE of the two adjacent
 * segments in between, so the cross-section does not pinch where the path
 * bends. A repeated control point has no direction at all, and the whole tube
 * is refused rather than emitting the `NaN` normal that would remove the entire
 * marker from the scene with nothing reported.
 */
function pathTangents(
  path: readonly PathPoint[],
): [number, number, number][] | undefined {
  const tangents: [number, number, number][] = [];
  for (let i = 0; i < path.length; i++) {
    const previous = path[Math.max(0, i - 1)] as PathPoint;
    const next = path[Math.min(path.length - 1, i + 1)] as PathPoint;
    const t = unit([
      next[0] - previous[0],
      next[1] - previous[1],
      next[2] - previous[2],
    ]);
    if (t === undefined) return undefined;
    tangents.push(t);
  }
  return tangents;
}

/**
 * A circular tube swept along a polyline path.
 *
 * **A POLYLINE, WHERE THE SOURCES USE A CATMULL-ROM SPLINE, and that is a
 * deliberate infidelity worth stating.** The galleries' `tube()` fits a smooth
 * curve through the control points; this connects them straight. Where the path
 * is densely sampled the two are indistinguishable — the stethoscope's arc is 15
 * points across a semicircle, so the chord error is under a millimetre at symbol
 * scale. Where it is sparse, ours has visible corners. Implementing centripetal
 * Catmull-Rom faithfully is the alternative, and it was judged not worth a
 * second curve implementation in this package for the handful of tubes in the
 * set. **If a ported symbol looks kinked, this is why**, and the fix is to
 * subdivide its path rather than to change this.
 *
 * The cross-section frame is PARALLEL-TRANSPORTED along the path rather than
 * rebuilt per point from a fixed up-vector: rebuilding makes the tube spin
 * about its own axis wherever the path turns, which shows up as a twist in the
 * flat shading and is the classic failure of the naive version.
 */
export function sweptTube(
  builder: MeshBuilder,
  path: readonly PathPoint[],
  radius: number,
  sides = 6,
): void {
  if (path.length < 2 || !(radius > 0)) return;
  const tangents = pathTangents(path);
  if (tangents === undefined) return;
  const normals = transportedNormals(tangents);

  const rings: number[][] = [];
  for (let i = 0; i < path.length; i++) {
    const tangent = tangents[i] as [number, number, number];
    const normal = normals[i] as [number, number, number];
    rings.push(
      tubeRing(
        builder,
        path[i] as PathPoint,
        normal,
        cross(tangent, normal),
        radius,
        sides,
      ),
    );
  }

  for (let i = 0; i + 1 < rings.length; i++) {
    const here = rings[i] as number[];
    const next = rings[i + 1] as number[];
    for (let side = 0; side < sides; side++) {
      const a = here[side] as number;
      const b = here[(side + 1) % sides] as number;
      const c = next[(side + 1) % sides] as number;
      const d = next[side] as number;
      // Against the parametrisation, as `torus` explains.
      builder.triangle(a, c, d);
      builder.triangle(a, b, c);
    }
  }
}
