/**
 * The sun's direction for the globe (globe plan 2026-09-26-0539 §7.3): the
 * framework's `solarPosition`, evaluated at 0°N 0°E, turned from that
 * place's east-north-up frame into ECEF. The sun is 1 AU away, so where on
 * the Earth it is observed from changes the direction by under 0.01°.
 *
 * @see globe-sun.ts.md
 */
import * as THREE from "three";
import type { Ellipsoid } from "3d-tiles-renderer";

/**
 * The unit ECEF direction towards the sun, from its elevation and azimuth
 * (clockwise from north) as seen at 0°N 0°E: the framework's
 * `SolarPosition` for that place. RangeError for a non-finite angle.
 */
export function sunDirectionEcef(
  ellipsoid: Ellipsoid,
  sun: { elevationRad: number; azimuthRad: number },
): THREE.Vector3 {
  const { elevationRad, azimuthRad } = sun;
  if (!Number.isFinite(elevationRad) || !Number.isFinite(azimuthRad)) {
    throw new RangeError(
      `sun angles must be finite, got ${elevationRad}, ${azimuthRad}`,
    );
  }
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  ellipsoid.getEastNorthUpAxes(0, 0, east, north, up);
  const horizontal = Math.cos(elevationRad);
  return east
    .multiplyScalar(horizontal * Math.sin(azimuthRad))
    .addScaledVector(north, horizontal * Math.cos(azimuthRad))
    .addScaledVector(up, Math.sin(elevationRad))
    .normalize();
}
