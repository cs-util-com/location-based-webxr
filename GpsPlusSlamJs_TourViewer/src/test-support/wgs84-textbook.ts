/**
 * WGS84 by the textbook (a, f), for tests that check the globe's frames
 * against arithmetic rather than against the library they are built on:
 * geodetic to ECEF by the closed formula, ECEF to geodetic by Bowring's
 * iteration (to well under a nanometre between latitudes -80 and 80).
 * Test-only.
 */
import type * as THREE from "three";

import type { GlobeEllipsoid } from "../editor3d/editor3d-tour-root.js";

const A = 6_378_137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const DEG = Math.PI / 180;

/** Geodetic (radians, metres over the ellipsoid) to ECEF, into `out`. */
export function ecefOf(
  latRad: number,
  lonRad: number,
  heightM: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const n = A / Math.sqrt(1 - E2 * Math.sin(latRad) ** 2);
  return out.set(
    (n + heightM) * Math.cos(latRad) * Math.cos(lonRad),
    (n + heightM) * Math.cos(latRad) * Math.sin(lonRad),
    (n * (1 - E2) + heightM) * Math.sin(latRad),
  );
}

/** ECEF to geodetic (degrees, metres over the ellipsoid). */
export function geodeticOf(p: THREE.Vector3): {
  latDeg: number;
  lonDeg: number;
  heightM: number;
} {
  const r = Math.hypot(p.x, p.y);
  let lat = Math.atan2(p.z, r * (1 - E2));
  let heightM = 0;
  for (let i = 0; i < 10; i++) {
    const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
    heightM = r / Math.cos(lat) - n;
    lat = Math.atan2(p.z, r * (1 - (E2 * n) / (n + heightM)));
  }
  return { latDeg: lat / DEG, lonDeg: Math.atan2(p.y, p.x) / DEG, heightM };
}

/** The ellipsoid the globe's frame functions take, by the formula above. */
export const WGS84_TEXTBOOK = {
  getCartographicToPosition: ecefOf,
} as unknown as GlobeEllipsoid;
