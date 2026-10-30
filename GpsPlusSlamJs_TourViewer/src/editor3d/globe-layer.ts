/**
 * The editor's objects on the globe: one group under the globe's
 * Earth-centred group (its matrix is the globe's world frame), each object
 * placed by its geo pose in ECEF. The frame moves under a camera flown far
 * from it (the globe's recentre); because the objects sit in ECEF below
 * the frame, a recentre moves nothing here: no object is re-placed, and
 * each stays at its geo pose. Measured before the move (2026-10-27): an
 * object placed this way stays within 0.0007 mm at every drift up to
 * 6,000 km, where a root baked once moves by the whole drift.
 *
 * @see globe-layer.ts.md
 */
import * as THREE from "three";

import { pointRootMatrix, type GlobeEllipsoid } from "./editor3d-tour-root.js";

/** The layer's group name (for a scene's debugging). */
export const GLOBE_LAYER_NAME = "editor-globe-layer";

/** ECEF is the layer's own frame: the identity below the globe's frame. */
const ECEF = new THREE.Matrix4();

/** Where one object stands: a place, its ellipsoidal height in the object's own up axis. */
interface GlobeLayerPlace {
  readonly ellipsoid: GlobeEllipsoid;
  readonly place: { readonly lat: number; readonly lon: number };
  /** The geoid's N at the place (m): drawn heights are orthometric. */
  readonly undulationM: number;
}

/** The editor's objects under the globe's Earth-centred group. */
export interface GlobeLayer {
  /** The group the objects hang in (ECEF). */
  readonly root: THREE.Group;
  /**
   * Puts `object` into the layer at its place: its matrix is its own
   * north-up-east frame (x north, y up, z east, the file's height on the
   * up axis) in ECEF. RangeError for a place outside [-90, 90] or not
   * finite, or an undulation that is not finite (the object unchanged).
   */
  place(object: THREE.Object3D, at: GlobeLayerPlace): void;
  /** Takes the layer out of the globe's group (the objects are the caller's to free). */
  dispose(): void;
}

/**
 * A layer under `earth`, the globe's Earth-centred group (`globe.group`:
 * its matrix is the world frame, rewritten on every recentre).
 */
export function createGlobeLayer(earth: THREE.Object3D): GlobeLayer {
  const root = new THREE.Group();
  root.name = GLOBE_LAYER_NAME;
  earth.add(root);
  const matrix = new THREE.Matrix4();
  return {
    root,
    place(object, at) {
      // Computed first: a refused place leaves the object as it was.
      pointRootMatrix(
        {
          ellipsoid: at.ellipsoid,
          worldFromEcef: ECEF,
          place: at.place,
          undulationM: at.undulationM,
        },
        matrix,
      );
      object.matrixAutoUpdate = false;
      object.matrix.copy(matrix);
      object.matrixWorldNeedsUpdate = true;
      if (object.parent !== root) root.add(object);
    },
    dispose() {
      earth.remove(root);
    },
  };
}
