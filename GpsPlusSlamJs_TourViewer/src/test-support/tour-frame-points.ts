/**
 * Test support: the globe's frames written out by hand, for the globe
 * layer's tests. The frame at a place (x east, y up, z south, its origin
 * on the ellipsoid) from the textbook WGS84, not from the library the
 * layer is built on.
 */
import * as THREE from "three";

import { ecefOf } from "./wgs84-textbook.js";

const DEG = Math.PI / 180;

/** The frame at `target` (x east, y up, z south) to ECEF. */
function ecefFromFrameAt(target: { lat: number; lng: number }): THREE.Matrix4 {
  const phi = target.lat * DEG;
  const lambda = target.lng * DEG;
  const east = new THREE.Vector3(-Math.sin(lambda), Math.cos(lambda), 0);
  const up = new THREE.Vector3(
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  );
  const south = new THREE.Vector3(
    Math.sin(phi) * Math.cos(lambda),
    Math.sin(phi) * Math.sin(lambda),
    -Math.cos(phi),
  );
  return new THREE.Matrix4()
    .makeBasis(east, up, south)
    .setPosition(ecefOf(phi, lambda, 0, new THREE.Vector3()));
}

/** The globe's Earth-centred group, its matrix the frame at `target`. */
export function earthAt(target: { lat: number; lng: number }): THREE.Group {
  const earth = new THREE.Group();
  earth.matrixAutoUpdate = false;
  recentre(earth, target);
  return earth;
}

/** The globe's recentre: only the Earth-centred group's matrix changes. */
export function recentre(
  earth: THREE.Group,
  target: { lat: number; lng: number },
): void {
  earth.matrix.copy(ecefFromFrameAt(target)).invert();
  earth.updateMatrixWorld(true);
}

/** A point of the tour's frame at `centre`, in ECEF. */
export function ecefOfTourPoint(
  centre: { lat: number; lng: number },
  point: THREE.Vector3,
): THREE.Vector3 {
  return point.clone().applyMatrix4(ecefFromFrameAt(centre));
}
