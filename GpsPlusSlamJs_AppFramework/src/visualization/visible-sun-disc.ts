import * as THREE from 'three';
import type { NueDirection } from '../geo/sun-position.js';
import { isSphereInCameraFrustum } from './frustum-visibility.js';
import {
  computeSunDiscWorldPosition,
  isSunDirectionAboveHorizon,
} from './sun-disc-placement.js';
import { disposeObject3D } from './three-dispose.js';

export type SunDiscVisibility =
  | 'visible'
  | 'outside-view'
  | 'below-horizon';

export interface VisibleSunDiscOptions {
  /** Distance from the camera in world metres. Must be finite and positive. */
  readonly distance?: number;
  /** Rendered icon diameter in world metres. Must be finite and positive. */
  readonly diameter?: number;
  /** Disc colour accepted by THREE.Color. */
  readonly color?: THREE.ColorRepresentation;
  /** Render below-horizon directions for debugging. Defaults to false. */
  readonly showBelowHorizon?: boolean;
}

export interface VisibleSunDisc {
  /** The owned sun-disc mesh, attached to the parent supplied at creation. */
  readonly object: THREE.Mesh<
    THREE.CircleGeometry,
    THREE.MeshBasicMaterial
  >;

  /**
   * Synchronize placement, billboard orientation, and visibility.
   * Camera world and projection matrices must already be current.
   */
  update(
    directionNue: NueDirection,
    camera: THREE.Camera
  ): SunDiscVisibility;

  /** Detach the mesh and dispose all resources owned by this instance. */
  dispose(): void;
}

export const DEFAULT_VISIBLE_SUN_DISC: Readonly<{
  distance: number;
  diameter: number;
  color: THREE.ColorRepresentation;
  showBelowHorizon: boolean;
}> = {
  distance: 10,
  diameter: 0.5,
  color: 0xffd45c,
  showBelowHorizon: false,
};

function requirePositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if (value <= 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
}

/** Create a camera-relative sun icon whose direction remains in GPS-world NUE. */
export function createVisibleSunDisc(
  parent: THREE.Object3D,
  options: VisibleSunDiscOptions = {}
): VisibleSunDisc {
  const distance = options.distance ?? DEFAULT_VISIBLE_SUN_DISC.distance;
  const diameter = options.diameter ?? DEFAULT_VISIBLE_SUN_DISC.diameter;
  const color = options.color ?? DEFAULT_VISIBLE_SUN_DISC.color;
  const showBelowHorizon =
    options.showBelowHorizon ?? DEFAULT_VISIBLE_SUN_DISC.showBelowHorizon;

  requirePositiveFinite(distance, 'distance');
  requirePositiveFinite(diameter, 'diameter');

  const geometry = new THREE.CircleGeometry(diameter / 2);
  const material = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'visible-sun-disc';
  object.frustumCulled = false;
  parent.add(object);

  const cameraWorldPosition = new THREE.Vector3();
  const cameraWorldQuaternion = new THREE.Quaternion();
  const discWorldPosition = new THREE.Vector3();
  const discWorldSphere = new THREE.Sphere(undefined, diameter / 2);

  return {
    object,

    update(
      directionNue: NueDirection,
      camera: THREE.Camera
    ): SunDiscVisibility {
      camera.getWorldPosition(cameraWorldPosition);
      const placement = computeSunDiscWorldPosition(
        cameraWorldPosition,
        directionNue,
        distance
      );
      object.position.set(placement.x, placement.y, placement.z);

      camera.getWorldQuaternion(cameraWorldQuaternion);
      object.quaternion.copy(cameraWorldQuaternion);
      object.updateMatrixWorld(true);

      if (!showBelowHorizon && !isSunDirectionAboveHorizon(directionNue)) {
        object.visible = false;
        return 'below-horizon';
      }

      object.getWorldPosition(discWorldPosition);
      discWorldSphere.center.copy(discWorldPosition);
      const isInView = isSphereInCameraFrustum(camera, discWorldSphere);
      object.visible = isInView;
      return isInView ? 'visible' : 'outside-view';
    },

    dispose(): void {
      object.removeFromParent();
      disposeObject3D(object);
    },
  };
}
