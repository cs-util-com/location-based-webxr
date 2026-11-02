/**
 * The relief's part of the camera's clip planes (F2 plan F2a, M4), moved
 * out of the globe lab: the drawn ground at the camera's ground point and
 * on a ring of eight points as far out as the camera stands above that
 * ground (ground farther out is farther than the ground below anyway), the
 * distance to the nearest of them (`reliefClearanceM`: a ridge beside the
 * camera counts its horizontal distance however high it stands), and the
 * highest real peak times the relief's exaggeration. The first rule, the
 * height above the HIGHEST ground nearby, floored the near plane at 1 m
 * under a ridge (F2a's browser run, 2026-10-05).
 *
 * @see globe-relief-planes.ts.md
 */

import * as THREE from "three";

import { reliefClearanceM } from "./globe-camera.js";

/** The highest real peak (m): the far plane keeps a peak's horizon. */
export const RELIEF_PEAK_M = 8_850;

/** The ring's eight bearings (rad), a quarter of pi apart. */
const RING = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);

/** The ellipsoid's part the planes read (3d-tiles-renderer's `Ellipsoid`). */
interface ReliefPlanesEllipsoid {
  getPositionToCartographic(
    position: THREE.Vector3,
    target: { lat?: number; lon?: number },
  ): { lat: number; lon: number };
  getPositionElevation(position: THREE.Vector3): number;
}

export interface ReliefPlanesOptions {
  ellipsoid: ReliefPlanesEllipsoid;
  /** The globe's frame: the camera's world position into ECEF. */
  group: THREE.Object3D;
  camera: THREE.Camera;
  /** The Earth's radius (m) the ring's angles are measured on. */
  radiusM: number;
  /** The drawn ground (m) at a place (radians), null where none is loaded. */
  sampleGround: (lat: number, lon: number) => number | null;
  /** The relief's exaggeration now. */
  heightScale: () => number;
  /** Whether the relief takes part now; `{}` (the ellipsoid's planes) if not. */
  active: () => boolean;
}

/** What the planes read last, for a page's state (null before or without). */
interface ReliefPlanesState {
  clearanceM: number | null;
  samples: {
    altitude: number;
    below: number | null;
    ringM: number;
    ring: (number | null)[];
  } | null;
}

export interface ReliefPlanes {
  /** This frame's `{ clearanceM?, peakM }`, or `{}` while not active. */
  (): { clearanceM?: number; peakM?: number };
  state(): ReliefPlanesState;
}

/**
 * The planes' relief part as a function to call each time the planes are
 * fitted. RangeError for a radius that is not positive and finite.
 */
export function createReliefPlanes({
  ellipsoid,
  group,
  camera,
  radiusM,
  sampleGround,
  heightScale,
  active,
}: ReliefPlanesOptions): ReliefPlanes {
  if (!(radiusM > 0 && Number.isFinite(radiusM))) {
    throw new RangeError(`the radius must be positive, got ${radiusM}`);
  }
  const local = new THREE.Vector3();
  let clearanceM: number | null = null;
  let samples: ReliefPlanesState["samples"] = null;
  const planes = () => {
    if (!active()) return {};
    group.worldToLocal(local.copy(camera.position));
    const c = ellipsoid.getPositionToCartographic(local, {});
    const altitude = ellipsoid.getPositionElevation(local);
    const below = sampleGround(c.lat, c.lon);
    const ringM = Math.max(10, altitude - Math.max(0, below ?? 0));
    const ring: { distanceM: number; groundM: number | null }[] = [
      { distanceM: 0, groundM: below },
    ];
    for (const a of RING) {
      ring.push({
        distanceM: ringM,
        groundM: sampleGround(
          c.lat + (ringM * Math.cos(a)) / radiusM,
          c.lon +
            (ringM * Math.sin(a)) / (radiusM * Math.max(Math.cos(c.lat), 0.01)),
        ),
      });
    }
    const nearest = reliefClearanceM(altitude, ring);
    clearanceM = Number.isFinite(nearest) ? nearest : null;
    samples = {
      altitude,
      below,
      ringM,
      ring: ring.slice(1).map((x) => x.groundM),
    };
    return {
      ...(clearanceM === null ? {} : { clearanceM: nearest }),
      peakM: RELIEF_PEAK_M * heightScale(),
    };
  };
  return Object.assign(planes, {
    state: (): ReliefPlanesState => ({ clearanceM, samples }),
  });
}
