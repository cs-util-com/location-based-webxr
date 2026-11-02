/**
 * The editor's objects on the globe: one group under the globe's
 * Earth-centred group (its matrix is the globe's world frame), and in it
 * the tour's frame (x east, y up, z south at the tour's centre) placed in
 * ECEF, in which the stations layer works as it always has. The frame
 * moves under a camera flown far from it (the globe's recentre); because
 * the tour's frame sits in ECEF below it, a recentre moves nothing here:
 * nothing is re-placed, and every station stays at its geo pose. Measured
 * before the move (2026-10-27): an object placed in ECEF this way stays
 * within 0.0007 mm at every drift up to 6,000 km, where a root baked once
 * moves by the whole drift.
 *
 * @see globe-layer.ts.md
 */
import * as THREE from "three";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import type { GlobeEllipsoid } from "./editor3d-tour-root.js";

/** The layer's group name (for a scene's debugging). */
export const GLOBE_LAYER_NAME = "editor-globe-layer";

/** The tour's frame in the layer. */
interface GlobeTourFrame {
  /** The group the stations layer draws in; its matrix is the tour's
   *  frame in ECEF (`matrixAutoUpdate` off). */
  readonly frame: THREE.Group;
  /** ECEF to the tour's frame (the stations layer's `worldFromEcef`). */
  readonly tourFromEcef: THREE.Matrix4;
}

/** The editor's objects under the globe's Earth-centred group. */
export interface GlobeLayer {
  /** The group the objects hang in (ECEF). */
  readonly root: THREE.Group;
  /**
   * Hangs the tour's frame at `centre` (degrees) in the layer. RangeError
   * for a centre off the Earth (a latitude outside [-90, 90], a value not
   * finite); the layer is then unchanged.
   */
  mountTour(
    ellipsoid: GlobeEllipsoid,
    centre: { readonly lat: number; readonly lng: number },
  ): GlobeTourFrame;
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
  return {
    root,
    mountTour(ellipsoid, centre) {
      // Computed first: a refused centre leaves the layer as it was.
      const tourFromEcef = worldFromEcefAt(
        ellipsoid,
        { lat: centre.lat, lng: centre.lng },
        new THREE.Matrix4(),
      );
      const frame = new THREE.Group();
      frame.name = "tour-frame";
      frame.matrixAutoUpdate = false;
      frame.matrix.copy(tourFromEcef).invert();
      root.add(frame);
      // The parents too: the layer may not have been drawn yet.
      frame.updateWorldMatrix(true, false);
      return { frame, tourFromEcef };
    },
    dispose() {
      earth.remove(root);
    },
  };
}
