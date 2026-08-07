/**
 * WGS84 degrees → local ENU metres.
 *
 * WHY THIS FILE EXISTS AT ALL, and why every mesh in this package goes through
 * it before anything else happens.
 *
 * **All mesh geometry must be built in metres, never in degrees.** The reason is
 * arithmetic, not taste:
 *
 * - A degree of longitude is ~111 km at the equator and ~71 km at 50.8° N — a
 *   **~36 % anisotropy**. A building extruded in raw degrees is sheared: square
 *   footprints become parallelograms and walls lean.
 * - Web Mercator does not fix it. Its scale factor at 50.8° N is ~1.58, so
 *   unprojected Mercator metres are **58 % too long** there. Using them as if
 *   they were metres puts a 10 m building at 15.8 m.
 *
 * Both errors are smooth and plausible, which is what makes them dangerous:
 * accumulated over a 1 km scene they produce visible shear and mis-registration
 * that looks like a pose problem rather than a units problem.
 *
 * So: convert ONCE at the boundary, here, and never convert back. The
 * equirectangular approximation about a local origin is accurate to well under
 * 1 % at the scales this library works at (a res-7 tile is 2.81 km across), and
 * it is the same approach the framework's `h3-proximity.ts` already takes.
 *
 * @see enu.ts.md
 */

import type { LatLng } from "../model/osm-feature.js";

/** Metres per degree of latitude. Constant to well within our tolerance. */
const METRES_PER_DEG_LAT = 111_320;

/** A point in the local East–North–Up frame, metres from the origin. */
export interface EnuPoint {
  /** Metres east of the origin. */
  readonly x: number;
  /** Metres north of the origin. */
  readonly y: number;
}

/**
 * A conversion anchored at one origin.
 *
 * Anchored rather than free-function because the longitude scale depends on
 * latitude, and recomputing `cos(lat)` per point both costs more and — worse —
 * would make two points at different latitudes use different scales, which
 * silently curves straight walls.
 */
export interface EnuFrame {
  readonly origin: LatLng;
  toEnu(position: LatLng): EnuPoint;
  toLatLng(point: EnuPoint): LatLng;
}

/**
 * Builds a local ENU frame at `origin`.
 *
 * Longitude scale is `cos(originLat)`, fixed for the whole frame. Over a 3 km
 * scene at 50.8° N the resulting error is under 0.05 %, which is far below the
 * ~1 m absolute accuracy of an OSM footprint.
 *
 * The origin should be near the content — a frame anchored 100 km away is still
 * *correct*, but the coordinates get large enough that float32 vertex buffers
 * start losing precision where it matters.
 */
export function enuFrameAt(origin: LatLng): EnuFrame {
  const metresPerDegLng =
    METRES_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);

  return {
    origin,
    toEnu(position) {
      return {
        x: (position.lng - origin.lng) * metresPerDegLng,
        y: (position.lat - origin.lat) * METRES_PER_DEG_LAT,
      };
    },
    toLatLng(point) {
      return {
        // Guard the pole: cos(lat) → 0 makes the inverse undefined. Returning
        // the origin's longitude is wrong by less than the frame is usable at.
        lng:
          metresPerDegLng === 0
            ? origin.lng
            : origin.lng + point.x / metresPerDegLng,
        lat: origin.lat + point.y / METRES_PER_DEG_LAT,
      };
    },
  };
}

/** Converts a whole ring in one pass. */
export function ringToEnu(
  ring: readonly LatLng[],
  frame: EnuFrame,
): EnuPoint[] {
  return ring.map((p) => frame.toEnu(p));
}

/**
 * Twice the signed area of a ring, in m². **Positive means counter-clockwise.**
 *
 * The plain shoelace sum, deliberately — the trapezoid variant
 * (`Σ (xⱼ − xᵢ)(yⱼ + yᵢ)`) computes the same magnitude with the opposite sign
 * convention, and mixing the two is how a triangulator ends up clipping reflex
 * vertices and emitting overlapping triangles. That is not hypothetical: the
 * first version of this file had exactly that inversion, and the symptom was a
 * 20 × 20 square with a 10 × 10 hole triangulating to an area of 750 m² instead
 * of 300 m². Convex shapes hid it completely, which is why the differential
 * test against `earcut` is what found it.
 *
 * Used for winding checks rather than for area reporting — `region-builder`
 * uses real H3 cell areas for that.
 */
export function signedArea2(ring: readonly EnuPoint[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** True when a ring winds counter-clockwise in the ENU frame. */
export function isCounterClockwise(ring: readonly EnuPoint[]): boolean {
  return signedArea2(ring) > 0;
}
