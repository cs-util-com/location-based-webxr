/**
 * The approach on the camera: one frame of the intro, the dive or the pin
 * flight placed on the lab's camera. The field of view is the page's
 * throughout, so nothing here touches it. Moved out of the globe lab as a
 * pure refactor (editor-on-the-full-globe plan, the approach slice).
 *
 * @see globe-approach-camera.ts.md
 */
import * as THREE from "three";

import { applyOrbitPose } from "./globe-camera.js";
import type { ApproachStep, GlobeApproach } from "./globe-approach.js";

/**
 * One frame of the approach on the camera: an orbit frame is placed at its
 * distance (the fitted one when null), a placed frame (the dive, the pin
 * flight) as it is. `placeCameraEcef` places the camera from an ECEF pose
 * (the world is not ECEF once the frame is at a target). The caller then
 * updates the camera's matrix and its controls.
 */
export function createApproachDrive({
  approach,
  placeCameraEcef,
  fitDistance,
}: {
  approach: Pick<GlobeApproach, "pose" | "cameraPlaced">;
  placeCameraEcef: (
    position: THREE.Vector3,
    quaternion: THREE.Quaternion,
  ) => void;
  fitDistance: () => number;
}) {
  const scratch = new THREE.PerspectiveCamera();
  const placeOrbit = (step: Extract<ApproachStep, { pose: unknown }>) => {
    applyOrbitPose(scratch, step.pose, step.distanceM ?? fitDistance());
    placeCameraEcef(scratch.position, scratch.quaternion);
    approach.cameraPlaced(scratch.position.length());
  };
  return (now: number) => {
    const step = approach.pose(now);
    if ("pose" in step) {
      placeOrbit(step);
    } else {
      placeCameraEcef(step.position, step.quaternion);
    }
  };
}
