/**
 * The pure geometry of the AR sun check (plan 2026-09-24-0100, M1): where the
 * real sun is in the GPS world, where a camera's centre ray points, and how
 * far apart the two are, split into a HEADING and an ELEVATION error.
 *
 * FRAMES. GPS-world content is NUE (x north, y up, z east); azimuths are
 * clockwise from north (east = 90°), elevations above the horizon, as
 * `geo/solar-position` returns them. WebXR poses are x east, y up, z south;
 * the library's `webxrToNUE` converts. A camera looks down its −z.
 *
 * UNITS. `sunDirectionNue` takes RADIANS (it is fed `solarPosition`'s
 * `azimuthRad` / `elevationRad` directly); everything else speaks DEGREES.
 *
 * THE SIGN, stated once: a positive heading error `h` means the app believes
 * azimuths are LARGER than they are, i.e. every direction it computes is
 * rotated `h` clockwise. A reticle aimed at the real sun through such an
 * alignment reports azimuth `a_sun + h`.
 *
 * No three.js: everything takes plain arrays, so the property tests can drive
 * it with many inputs and the marker's shader has a JS twin to be checked
 * against.
 *
 * @see sun-check-geometry.ts.md
 */
import type { Matrix4 } from 'gps-plus-slam-js';

import { intrinsicsFromProjection } from './qr/qr-pose.js';
import { bearingDeltaDeg } from '../utils/bearing-degrees.js';
import { nueBearingDeg } from '../utils/nue-bearing.js';

/** A 3-vector as a plain tuple. */
export type Vec3 = readonly [number, number, number];

/** A direction's azimuth and elevation, degrees. */
export interface AzEl {
  /** Clockwise from north, [0, 360); 0 by convention for a vertical direction. */
  readonly azimuthDeg: number;
  /** Above the horizon, [−90, 90]. */
  readonly elevationDeg: number;
}

/** A sighting's errors, degrees (see the module header for the sign). */
export interface SightingError {
  /** Observed minus true azimuth, (−180, 180]. */
  readonly headingDeg: number;
  /** Observed minus true elevation. */
  readonly elevationDeg: number;
  /** The angle between the two directions, [0, 180]. */
  readonly separationDeg: number;
}

const DEG = Math.PI / 180;
const UNIT_TOLERANCE = 1e-6;

function assertFinite(values: readonly number[], what: string): void {
  if (!values.every(Number.isFinite)) {
    throw new RangeError(`${what} must be finite, got [${values.join(', ')}]`);
  }
}

function assertUnit(v: Vec3, what: string): void {
  assertFinite(v, what);
  const length = Math.hypot(v[0], v[1], v[2]);
  if (Math.abs(length - 1) > UNIT_TOLERANCE) {
    throw new RangeError(`${what} must be a unit vector, length ${length}`);
  }
}

function assert16(m: readonly number[], what: string): void {
  if (m.length !== 16) throw new RangeError(`${what} must have 16 entries`);
  assertFinite(m, what);
}

function normalize(v: Vec3, what: string): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new RangeError(`${what} must be a non-zero finite vector`);
  }
  return [v[0] / length, v[1] / length, v[2] / length];
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** The unit NUE direction of an azimuth and an elevation, in RADIANS. */
export function sunDirectionNue(
  azimuthRad: number,
  elevationRad: number
): Vec3 {
  assertFinite([azimuthRad, elevationRad], 'azimuth and elevation');
  const c = Math.cos(elevationRad);
  return [
    c * Math.cos(azimuthRad),
    Math.sin(elevationRad),
    c * Math.sin(azimuthRad),
  ];
}

/**
 * A unit NUE direction's azimuth and elevation, degrees. A vertical direction
 * has no azimuth; it reads 0 by convention (see `sightingErrorDeg`, which
 * refuses one).
 */
export function azElOfNue(v: Vec3): AzEl {
  assertUnit(v, 'direction');
  return {
    azimuthDeg: nueBearingDeg(v[0], v[2]) ?? 0,
    elevationDeg: Math.asin(Math.max(-1, Math.min(1, v[1]))) / DEG,
  };
}

/**
 * The unit camera-frame ray (+x right, +y up, −z forward) through an NDC
 * point, from a column-major PERSPECTIVE projection (WebXR's
 * `view.projectionMatrix`). NDC (0, 0), the default, is the image centre,
 * which carries the principal-point offset (`P[8]`, `P[9]`), not the optical
 * axis. Reuses `intrinsicsFromProjection` on a 2×2 "image", i.e. in NDC
 * units, so there is one reading of the projection in the framework.
 * `RangeError` for anything but a perspective projection with positive focal
 * lengths (`P[11] = −1`, `P[15] = 0`, `P[0], P[5] > 0`): an orthographic or
 * mirrored matrix would give a confident, wrong ray.
 */
export function principalRayCamera(
  projection: readonly number[],
  ndc: readonly [number, number] = [0, 0]
): Vec3 {
  assert16(projection, 'projection');
  assertFinite(ndc, 'ndc');
  if (projection[11] !== -1 || projection[15] !== 0) {
    throw new RangeError(
      'projection must be perspective (P[11] = -1, P[15] = 0)'
    );
  }
  if (!(projection[0]! > 0 && projection[5]! > 0)) {
    throw new RangeError('projection must have positive focal lengths');
  }
  const k = intrinsicsFromProjection(projection as unknown as Matrix4, 2, 2);
  // Pixel coordinates of the NDC point in a 2×2 image, top-left origin.
  const px = ndc[0] + 1;
  const py = 1 - ndc[1];
  return normalize([(px - k.cx) / k.fx, -(py - k.cy) / k.fy, -1], 'camera ray');
}

/** A vector rotated by a column-major 4×4 matrix's rotation block. */
export function rotateByMat4(m: readonly number[], v: Vec3): Vec3 {
  assert16(m, 'matrix');
  assertFinite(v, 'vector');
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2],
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2],
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2],
  ];
}

/**
 * The heading, elevation and angular errors of an observed ray against the
 * sun, both unit NUE directions. Heading is azimuth observed minus true.
 * `RangeError` when either direction is vertical: heading is undefined there.
 */
export function sightingErrorDeg(rayNue: Vec3, sunNue: Vec3): SightingError {
  const observed = azElOfNue(rayNue);
  const sun = azElOfNue(sunNue);
  if (
    nueBearingDeg(rayNue[0], rayNue[2]) === undefined ||
    nueBearingDeg(sunNue[0], sunNue[2]) === undefined
  ) {
    throw new RangeError('a vertical direction has no heading');
  }
  const dot =
    rayNue[0] * sunNue[0] + rayNue[1] * sunNue[1] + rayNue[2] * sunNue[2];
  return {
    headingDeg: bearingDeltaDeg(observed.azimuthDeg, sun.azimuthDeg),
    elevationDeg: observed.elevationDeg - sun.elevationDeg,
    separationDeg: Math.acos(Math.max(-1, Math.min(1, dot))) / DEG,
  };
}

/**
 * The yaw of an NUE rotation, degrees clockwise from north: the bearing of
 * the image of north (the matrix's first column), via the shared
 * `utils/nue-bearing.ts`. `RangeError` when north maps to vertical (a
 * degenerate or non-yaw matrix), never a confident "north".
 */
export function alignmentYawDeg(m: readonly number[]): number {
  assert16(m, 'matrix');
  const yaw = nueBearingDeg(m[0]!, m[2]!);
  if (yaw === undefined) {
    throw new RangeError('the matrix maps north to vertical: no yaw');
  }
  return yaw;
}

/**
 * The JS twin of the marker's vertex shader: the NUE direction of a marker
 * vertex. The vertex hangs off an ANCHOR on the sun's almucantar, `dAzDeg`
 * of azimuth from the sun (a heading tick; 0 for the disc and rings), at an
 * offset `(uDeg, vDeg)` in the anchor's tangent plane (gnomonic: straight
 * lines stay straight), `u` toward increasing azimuth, `v` up. The offset is
 * a true angle ON THE AXES only (u = 0 or v = 0); a diagonal gnomonic offset
 * is slightly shorter, so rings use a polar form (the marker milestone).
 *
 * The tangent basis (plan §3.3, review finding 2): `east_t` points toward
 * increasing azimuth, `(−sin a, 0, cos a)`, which equals `normalize(s × up)`
 * for every |e| < 90° and stays defined at the zenith; `up_t = east_t × s`
 * points up. The reverse orders mirror every tick.
 */
export function markerVertexDirection(
  sunAzimuthDeg: number,
  sunElevationDeg: number,
  dAzDeg: number,
  uDeg: number,
  vDeg: number
): Vec3 {
  assertFinite(
    [sunAzimuthDeg, sunElevationDeg, dAzDeg, uDeg, vDeg],
    'marker vertex'
  );
  if (Math.abs(sunElevationDeg) > 90) {
    throw new RangeError(
      `elevation must be within ±90°, got ${sunElevationDeg}`
    );
  }
  if (Math.abs(uDeg) >= 89 || Math.abs(vDeg) >= 89) {
    throw new RangeError('marker offsets must stay below 89°');
  }
  const azimuth = (sunAzimuthDeg + dAzDeg) * DEG;
  const anchor = sunDirectionNue(azimuth, sunElevationDeg * DEG);
  const east: Vec3 = [-Math.sin(azimuth), 0, Math.cos(azimuth)];
  const up = cross(east, anchor);
  const tu = Math.tan(uDeg * DEG);
  const tv = Math.tan(vDeg * DEG);
  return normalize(
    [
      anchor[0] + tu * east[0] + tv * up[0],
      anchor[1] + tu * east[1] + tv * up[1],
      anchor[2] + tu * east[2] + tv * up[2],
    ],
    'marker vertex'
  );
}
