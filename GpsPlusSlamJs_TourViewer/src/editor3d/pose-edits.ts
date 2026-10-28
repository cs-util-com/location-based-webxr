/**
 * The 3D view's edits of a geo pose: where it faces, a turn about up, a
 * move to another place keeping its height above the ground, a nudge by
 * metres east and north, and a lift. Pure; the poses are the tour's
 * (latitude, longitude, an ELLIPSOIDAL altitude, and a heading or a
 * rotation in the north-up-east frame), and so are the grounds these take
 * (ellipsoidal metres).
 *
 * The height rule (the editor's): a moved item keeps its height above the
 * ground under it, unless the creator lifts it; where the ground is not
 * known (not loaded yet), a nudge keeps the altitude. A turn keeps the
 * pose's shape: a heading-only pose stays heading-only, a rotation stays
 * a rotation (with the heading the format derives beside it, or none for
 * a tilted pose).
 *
 * @see pose-edits.ts.md
 */
import * as THREE from "three";

import { deriveVerticalHeading } from "gps-plus-slam-app-framework/ar/qr/qr-geo-pose-minting";
import {
  offsetGeo,
  type QrGeoPose,
} from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";

import { altKeepingHeight } from "../station-geometry.js";
import { norm360 } from "./gizmo-maths.js";

/** A place (degrees). */
export interface Place {
  readonly lat: number;
  readonly lon: number;
}

/** The ground's ellipsoidal height at a place, or null where none is
 *  known yet. */
export type GroundAt = (place: Place) => number | null;

const RAD = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

function must(ok: boolean, message: string): void {
  if (!ok) throw new RangeError(message);
}

/**
 * Where a pose faces (degrees clockwise from north, in [0, 360)): a
 * heading-only pose's heading; a rotation's bearing of its x axis (the
 * format's heading, `deriveVerticalHeading`'s convention); 0 for a
 * rotation whose x axis points straight up or down.
 */
export function headingOfGeo(geo: QrGeoPose): number {
  if (geo.rotation === undefined) return norm360(geo.headingDeg ?? 0);
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(
    new THREE.Quaternion(...geo.rotation),
  );
  // North-up-east: x north, z east.
  if (Math.hypot(x.x, x.z) < 1e-9) return 0;
  return norm360(Math.atan2(x.z, x.x) / RAD);
}

/** `geo` turned `deg` clockwise (seen from above) about up, in place. */
export function turnedGeo(geo: QrGeoPose, deg: number): QrGeoPose {
  must(Number.isFinite(deg), `a turn must be finite, got ${deg}`);
  if (geo.rotation === undefined) {
    return { ...geo, headingDeg: norm360((geo.headingDeg ?? 0) + deg) };
  }
  // The format's heading h is the rotation of -h about up.
  const q = new THREE.Quaternion()
    .setFromAxisAngle(UP, -deg * RAD)
    .multiply(new THREE.Quaternion(...geo.rotation))
    .normalize();
  const rotation: [number, number, number, number] = [q.x, q.y, q.z, q.w];
  const headingDeg = deriveVerticalHeading(rotation);
  const { headingDeg: _was, ...rest } = geo;
  return {
    ...rest,
    rotation,
    ...(headingDeg === undefined ? {} : { headingDeg }),
  };
}

/** `geo` at `place`, keeping its height above the ground: the ground
 *  under it was `groundBeforeM`, under `place` it is `groundAfterM`. */
export function placedGeo(
  geo: QrGeoPose,
  place: Place,
  groundBeforeM: number,
  groundAfterM: number,
): QrGeoPose {
  must(
    [place.lat, place.lon, groundBeforeM, groundAfterM].every(Number.isFinite),
    "a place and its grounds must be finite",
  );
  return {
    ...geo,
    lat: place.lat,
    lon: place.lon,
    alt: altKeepingHeight({
      alt: geo.alt,
      groundBefore: groundBeforeM,
      groundAfter: groundAfterM,
    }),
  };
}

/** `geo` moved `eastM` east and `northM` north, keeping its height above
 *  the ground by `groundAt`, or its altitude where either ground is not
 *  known. */
export function nudgedGeo(
  geo: QrGeoPose,
  eastM: number,
  northM: number,
  groundAt: GroundAt,
): QrGeoPose {
  must(
    Number.isFinite(eastM) && Number.isFinite(northM),
    "a nudge must be finite",
  );
  const moved = offsetGeo(geo, { east: eastM, north: northM, up: 0 });
  const place = { lat: moved.latitude, lon: moved.longitude };
  const before = groundAt(geo);
  const after = groundAt(place);
  if (before === null || after === null) return { ...geo, ...place };
  return placedGeo(geo, place, before, after);
}

/** `geo` lifted `m` metres (down when negative). */
export function liftedGeo(geo: QrGeoPose, m: number): QrGeoPose {
  must(Number.isFinite(m), `a lift must be finite, got ${m}`);
  return { ...geo, alt: geo.alt + m };
}
