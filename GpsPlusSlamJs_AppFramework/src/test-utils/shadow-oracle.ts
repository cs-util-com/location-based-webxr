/**
 * The analytic shadow oracle (W4 AR shadows plan 2026-09-26-0549, M1): where
 * a directional light's shadow falls, computed exactly, without three.js or a
 * GPU. It is the ground truth the synthetic pixel page (M2) probes against.
 *
 * Pure and FRAME-AGNOSTIC like `sun-shadow-rig.ts`: every vector is in the
 * caller's frame with y up, and `sunDir` is the unit vector TOWARD the light.
 *
 * Two views of the same shadow:
 * - the RAY view (`inShadow`): a surface point Q is shadowed iff the ray
 *   `Q + t·sunDir`, t > 0, hits a caster. Works for any receiver shape.
 * - the LIGHT-SPACE view (`lightSpaceSignedDistance`): the signed distance,
 *   measured perpendicular to `sunDir`, from Q's ray to the edge of the
 *   casters' silhouette. A shadow-map texel is a square in exactly this
 *   space (2R / N metres for a ±R orthographic camera and an N-texel map), so
 *   a probe margin in texels is a light-space distance, whatever the receiver.
 *
 * @see shadow-oracle.ts.md
 */

import type { Vec3 } from '../visualization/sun-shadow-rig.js';

/** A sphere caster: the thrown balls of PhysicsDemo (radius 0.08 m). */
export interface SphereCaster {
  readonly kind: 'sphere';
  readonly centre: Vec3;
  readonly radius: number;
}

/**
 * An oriented box caster. `rotation` is a unit quaternion `[x, y, z, w]`
 * (three's `Quaternion.toArray()` order), identity when absent.
 */
export interface BoxCaster {
  readonly kind: 'box';
  readonly centre: Vec3;
  readonly halfExtents: Vec3;
  readonly rotation?: readonly [number, number, number, number];
}

export type Caster = SphereCaster | BoxCaster;

/** A point on the receiving plane y = h, as its [x, z]. */
export type PlanePoint = readonly [number, number];

/** A sphere's shadow on a horizontal plane: an ellipse. */
export interface PlaneEllipse {
  /** Centre on the plane: `C - ((C_y - h0) / s_y) · s`. */
  readonly centre: Vec3;
  /** Across the sun's azimuth: the radius r. */
  readonly semiMinorM: number;
  /** Along the sun's azimuth: `r / sin(elevation)` = `r / s_y`. */
  readonly semiMajorM: number;
  /** Unit horizontal direction of the major axis (the sun's azimuth). */
  readonly majorAxis: Vec3;
}

/** How a probe point relates to the shadow, with a declared margin. */
export type ProbeClass = 'inside' | 'outside' | 'edge';

const UNIT_TOLERANCE = 1e-6;
const PARALLEL_EPS = 1e-12;

function assertFiniteVec(v: readonly number[], what: string): void {
  if (!v.every(Number.isFinite)) {
    throw new RangeError(`${what} must be finite, got ${v.join(', ')}`);
  }
}

function assertUnit(v: readonly number[], what: string): void {
  assertFiniteVec(v, what);
  const length = Math.hypot(...v);
  if (Math.abs(length - 1) > UNIT_TOLERANCE) {
    throw new RangeError(`${what} must be a unit vector, got length ${length}`);
  }
}

/** The sun as a plane projection needs it: unit and above the horizon. */
function assertSunAbovePlane(s: Vec3): void {
  assertUnit(s, 'the sun direction');
  if (s[1] <= 0) {
    throw new RangeError(
      'the sun must be above the horizon to cast onto a plane'
    );
  }
}

function assertCaster(c: Caster): void {
  assertFiniteVec(c.centre, 'the caster centre');
  if (c.kind === 'sphere') {
    if (!(Number.isFinite(c.radius) && c.radius > 0)) {
      throw new RangeError(
        `the sphere radius must be positive, got ${c.radius}`
      );
    }
    return;
  }
  assertFiniteVec(c.halfExtents, 'the box half extents');
  if (!c.halfExtents.every((h) => h > 0)) {
    throw new RangeError(
      `the box half extents must be positive, got ${c.halfExtents.join(', ')}`
    );
  }
  if (c.rotation) assertUnit(c.rotation, 'the box rotation quaternion');
}

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

/** The box's local axes (rotation matrix columns) from its quaternion. */
function boxAxes(box: BoxCaster): readonly [Vec3, Vec3, Vec3] {
  const [x, y, z, w] = box.rotation ?? [0, 0, 0, 1];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/** The 8 corners of a box, world frame. */
export function boxCorners(box: BoxCaster): Vec3[] {
  assertCaster(box);
  const [ax, ay, az] = boxAxes(box);
  const [hx, hy, hz] = box.halfExtents;
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(
          add(
            add(add(box.centre, scale(ax, sx * hx)), scale(ay, sy * hy)),
            scale(az, sz * hz)
          )
        );
      }
    }
  }
  return corners;
}

function rayHitsSphere(q: Vec3, s: Vec3, sphere: SphereCaster): boolean {
  const d = sub(sphere.centre, q);
  const along = dot(d, s);
  const perp2 = dot(d, d) - along * along;
  const r2 = sphere.radius * sphere.radius;
  if (perp2 > r2) return false;
  // The far intersection must lie strictly ahead: a point on the sphere's own
  // sun-facing surface (far root 0) is lit.
  return along + Math.sqrt(r2 - perp2) > 0;
}

function rayHitsBox(q: Vec3, s: Vec3, box: BoxCaster): boolean {
  const axes = boxAxes(box);
  const d = sub(q, box.centre);
  let tNear = -Infinity;
  let tFar = Infinity;
  for (let i = 0; i < 3; i++) {
    const axis = axes[i] as Vec3;
    const h = box.halfExtents[i] as number;
    const o = dot(d, axis);
    const dir = dot(s, axis);
    if (Math.abs(dir) < PARALLEL_EPS) {
      if (Math.abs(o) > h) return false;
      continue;
    }
    const t1 = (-h - o) / dir;
    const t2 = (h - o) / dir;
    tNear = Math.max(tNear, Math.min(t1, t2));
    tFar = Math.min(tFar, Math.max(t1, t2));
    if (tNear > tFar) return false;
  }
  return tFar > 0;
}

/**
 * Whether the surface point `q` is in shadow: the ray from `q` toward the
 * light hits a caster at t > 0. Casters are closed sets, except that a
 * caster's own light-facing surface is lit.
 *
 * @throws RangeError for a non-unit or non-finite direction, a non-finite
 *   point, or a malformed caster.
 */
export function inShadow(
  sunDir: Vec3,
  q: Vec3,
  casters: readonly Caster[]
): boolean {
  assertUnit(sunDir, 'the sun direction');
  assertFiniteVec(q, 'the receiver point');
  for (const c of casters) {
    assertCaster(c);
    const hit =
      c.kind === 'sphere'
        ? rayHitsSphere(q, sunDir, c)
        : rayHitsBox(q, sunDir, c);
    if (hit) return true;
  }
  return false;
}

/** An orthonormal basis (u, v) of the plane perpendicular to `s`. */
function lightBasis(s: Vec3): readonly [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(s[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(helper, s));
  const v = cross(s, u);
  return [u, v];
}

/** Andrew's monotone chain; counter-clockwise, no collinear points. */
export function convexHull2(points: readonly PlanePoint[]): PlanePoint[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const turn = (o: PlanePoint, a: PlanePoint, b: PlanePoint): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: PlanePoint[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      turn(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: PlanePoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (
      upper.length >= 2 &&
      turn(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** The area of a simple polygon (shoelace), positive for counter-clockwise. */
export function polygonArea(poly: readonly PlanePoint[]): number {
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
}

/**
 * Signed distance from `p` to a convex counter-clockwise polygon: negative
 * inside. A polygon with fewer than 3 vertices has no inside.
 */
export function convexPolygonSignedDistance(
  p: PlanePoint,
  poly: readonly PlanePoint[]
): number {
  if (poly.length === 0) return Infinity;
  let minEdge = Infinity;
  let inside = poly.length >= 3;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len2 = ex * ex + ey * ey;
    const t =
      len2 === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2)
          );
    const dx = p[0] - (a[0] + t * ex);
    const dy = p[1] - (a[1] + t * ey);
    minEdge = Math.min(minEdge, Math.hypot(dx, dy));
    // Counter-clockwise: inside is to the left of every edge.
    if (ex * (p[1] - a[1]) - ey * (p[0] - a[0]) < 0) inside = false;
  }
  return inside ? -minEdge : minEdge;
}

/** The 12 edges of a box as corner-index pairs (`boxCorners` order). */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7], // along z
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7], // along y
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7], // along x
];

function sphereLightDistance(q: Vec3, s: Vec3, sphere: SphereCaster): number {
  const d = sub(sphere.centre, q);
  const along = dot(d, s);
  const r = sphere.radius;
  // Rays parallel to s from points beside q keep q's depth, so the sphere's
  // silhouette at that depth is the disk of the part lying ahead of it.
  let rEff: number;
  if (along >= 0) rEff = r;
  else if (along > -r) rEff = Math.sqrt(r * r - along * along);
  else return Infinity;
  const perp = Math.sqrt(Math.max(0, dot(d, d) - along * along));
  return perp - rEff;
}

function boxLightDistance(q: Vec3, s: Vec3, box: BoxCaster): number {
  const corners = boxCorners(box);
  const depth = corners.map((c) => dot(sub(c, q), s));
  // The part of the box ahead of q's depth plane: its corners there plus the
  // points where edges cross that plane.
  const ahead: Vec3[] = [];
  corners.forEach((c, i) => {
    if ((depth[i] as number) > 0) ahead.push(c);
  });
  if (ahead.length === 0) return Infinity;
  for (const [i, j] of BOX_EDGES) {
    const di = depth[i] as number;
    const dj = depth[j] as number;
    if (di > 0 !== dj > 0) {
      const t = di / (di - dj);
      const ci = corners[i] as Vec3;
      const cj = corners[j] as Vec3;
      ahead.push(add(ci, scale(sub(cj, ci), t)));
    }
  }
  const [u, v] = lightBasis(s);
  const projected = ahead.map((p): PlanePoint => {
    const rel = sub(p, q);
    return [dot(rel, u), dot(rel, v)];
  });
  return convexPolygonSignedDistance([0, 0], convexHull2(projected));
}

/**
 * The signed LIGHT-SPACE distance (metres, measured perpendicular to
 * `sunDir`) from `q`'s ray to the edge of the casters' silhouette: negative
 * inside the shadow, positive outside, `Infinity` when no caster lies ahead.
 *
 * Over several casters it is the minimum: exact outside the union, and
 * conservative inside it (a point deep in two overlapping shadows reports the
 * depth of one), so a margin built on it never over-claims.
 *
 * @throws RangeError as {@link inShadow}.
 */
export function lightSpaceSignedDistance(
  sunDir: Vec3,
  q: Vec3,
  casters: readonly Caster[]
): number {
  assertUnit(sunDir, 'the sun direction');
  assertFiniteVec(q, 'the receiver point');
  let best = Infinity;
  for (const c of casters) {
    assertCaster(c);
    const d =
      c.kind === 'sphere'
        ? sphereLightDistance(q, sunDir, c)
        : boxLightDistance(q, sunDir, c);
    best = Math.min(best, d);
  }
  return best;
}

/** Project `p` along the sun onto the plane y = h0. */
export function projectAlongSun(p: Vec3, sunDir: Vec3, planeY: number): Vec3 {
  assertSunAbovePlane(sunDir);
  assertFiniteVec(p, 'the point');
  if (!Number.isFinite(planeY)) {
    throw new RangeError(`the plane height must be finite, got ${planeY}`);
  }
  return sub(p, scale(sunDir, (p[1] - planeY) / sunDir[1]));
}

/**
 * The known answer for a sphere over a flat plane y = h0: an ellipse with
 * semi-axes r (across the sun's azimuth) and r / s_y (along it), centred at
 * `C - ((C_y - h0) / s_y) · s`. With the sun straight overhead it is a
 * circle, and `majorAxis` is then +x by convention.
 *
 * @throws RangeError for a sun at or below the horizon or a sphere that
 *   reaches below the plane (its footprint is then not a full ellipse).
 */
export function sphereShadowOnPlane(
  sunDir: Vec3,
  sphere: SphereCaster,
  planeY: number
): PlaneEllipse {
  assertSunAbovePlane(sunDir);
  assertCaster(sphere);
  if (sphere.centre[1] - sphere.radius < planeY) {
    throw new RangeError('the sphere must lie above the plane');
  }
  const horizontal = Math.hypot(sunDir[0], sunDir[2]);
  const majorAxis: Vec3 =
    horizontal < PARALLEL_EPS
      ? [1, 0, 0]
      : [sunDir[0] / horizontal, 0, sunDir[2] / horizontal];
  return {
    centre: projectAlongSun(sphere.centre, sunDir, planeY),
    semiMinorM: sphere.radius,
    semiMajorM: sphere.radius / sunDir[1],
    majorAxis,
  };
}

/** Whether a plane point lies inside the ellipse (scaled by `k`, default 1). */
export function insideEllipse(e: PlaneEllipse, p: PlanePoint, k = 1): boolean {
  const dx = p[0] - e.centre[0];
  const dz = p[1] - e.centre[2];
  const a = dx * e.majorAxis[0] + dz * e.majorAxis[2];
  const b = -dx * e.majorAxis[2] + dz * e.majorAxis[0];
  return (a / (k * e.semiMajorM)) ** 2 + (b / (k * e.semiMinorM)) ** 2 <= 1;
}

/**
 * The known answer for a box over a flat plane y = h0: the convex hull of its
 * 8 corners projected along the sun, as counter-clockwise [x, z] points.
 * (Counter-clockwise in (x, z), which is clockwise seen from above in a
 * right-handed y-up frame; `polygonArea` is positive for it.)
 *
 * @throws RangeError for a sun at or below the horizon or a box that reaches
 *   below the plane.
 */
export function boxShadowOnPlane(
  sunDir: Vec3,
  box: BoxCaster,
  planeY: number
): PlanePoint[] {
  assertSunAbovePlane(sunDir);
  const corners = boxCorners(box);
  if (corners.some((c) => c[1] < planeY)) {
    throw new RangeError('the box must lie above the plane');
  }
  return convexHull2(
    corners.map((c): PlanePoint => {
      const p = projectAlongSun(c, sunDir, planeY);
      return [p[0], p[2]];
    })
  );
}

/**
 * The edge of one shadow-map texel, metres: a ±R orthographic shadow camera
 * over an N-texel map.
 *
 * @throws RangeError for R ≤ 0 or an N that is not a positive integer.
 */
export function shadowTexelM(halfWidthM: number, mapSize: number): number {
  if (!(Number.isFinite(halfWidthM) && halfWidthM > 0)) {
    throw new RangeError(`the half width must be positive, got ${halfWidthM}`);
  }
  if (!(Number.isInteger(mapSize) && mapSize > 0)) {
    throw new RangeError(
      `the map size must be a positive integer, got ${mapSize}`
    );
  }
  return (2 * halfWidthM) / mapSize;
}

/**
 * The deepest inside-probe margin a sphere of `radiusM` allows, in texels:
 * its light-space silhouette is a disk of that radius. A margin above it
 * leaves no inside probe at all, so the configuration cannot be judged.
 */
export function maxInsideMarginTexels(
  radiusM: number,
  halfWidthM: number,
  mapSize: number
): number {
  if (!(Number.isFinite(radiusM) && radiusM > 0)) {
    throw new RangeError(`the radius must be positive, got ${radiusM}`);
  }
  return radiusM / shadowTexelM(halfWidthM, mapSize);
}

/**
 * Classify a probe point with a declared margin: `'inside'` when the
 * light-space disk of `marginTexels` texels around its ray lies wholly in
 * the shadow, `'outside'` when wholly out of it, `'edge'` otherwise (no
 * verdict: the pixel test skips it). The margin absorbs PCF filtering, the
 * one-texel normal bias and rasterisation, so the M2 sweep runs it from 2 to
 * 8 texels.
 *
 * @throws RangeError for a negative or non-finite margin, a non-positive
 *   texel, and as {@link inShadow}.
 */
export function classifyProbe(
  sunDir: Vec3,
  q: Vec3,
  casters: readonly Caster[],
  margin: { readonly texelM: number; readonly marginTexels: number }
): ProbeClass {
  if (!(Number.isFinite(margin.texelM) && margin.texelM > 0)) {
    throw new RangeError(`the texel must be positive, got ${margin.texelM}`);
  }
  if (!(Number.isFinite(margin.marginTexels) && margin.marginTexels >= 0)) {
    throw new RangeError(
      `the margin must be finite and non-negative, got ${margin.marginTexels}`
    );
  }
  const m = margin.texelM * margin.marginTexels;
  const d = lightSpaceSignedDistance(sunDir, q, casters);
  if (d <= -m && d < 0) return 'inside';
  if (d >= m && d > 0) return 'outside';
  return 'edge';
}
