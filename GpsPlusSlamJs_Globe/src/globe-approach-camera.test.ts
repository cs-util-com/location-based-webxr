/**
 * The approach on the camera, moved out of the globe lab.
 *
 * Why this file matters: the frame loop hands the camera to the approach
 * every frame until the user takes it. A wrong order here is a camera
 * placed before its distance is known, or a first fly-in frame the smokes
 * cannot measure. The recording fakes pin the calls in order and the
 * values they carry.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createApproachDrive } from "./globe-approach-camera.js";
import type { ApproachStep } from "./globe-approach.js";
import { applyOrbitPose } from "./globe-camera.js";

describe("createApproachDrive", () => {
  function setup(steps: ApproachStep[]) {
    const calls: string[] = [];
    const placed: [THREE.Vector3, THREE.Quaternion][] = [];
    const drive = createApproachDrive({
      approach: {
        pose: (now) => {
          calls.push(`pose ${now}`);
          return steps.shift() as ApproachStep;
        },
        cameraPlaced: (d) => calls.push(`placed ${d}`),
      },
      placeCameraEcef: (p, q) => {
        calls.push("placeCameraEcef");
        placed.push([p.clone(), q.clone()]);
      },
      fitDistance: () => 2e7,
    });
    return { drive, calls, placed };
  }
  const pose = {
    direction: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  };

  it("places an orbit frame at its distance and reports it", () => {
    const { drive, calls, placed } = setup([{ pose, distanceM: 3e7 }]);
    drive(5);
    expect(calls).toEqual(["pose 5", "placeCameraEcef", "placed 30000000"]);
    const expected = new THREE.PerspectiveCamera();
    applyOrbitPose(expected, pose, 3e7);
    expect(placed[0]?.[0].toArray()).toEqual(expected.position.toArray());
    expect(placed[0]?.[1].toArray()).toEqual(expected.quaternion.toArray());
  });

  it("uses the fitted distance for a held frame", () => {
    const { drive, calls } = setup([{ pose, distanceM: null }]);
    drive(1);
    expect(calls).toContain("placed 20000000");
  });

  it("places a dive frame as it is", () => {
    const position = new THREE.Vector3(1, 2, 3);
    const quaternion = new THREE.Quaternion(0, 0, 0, 1);
    const { drive, calls, placed } = setup([{ position, quaternion }]);
    drive(9);
    expect(calls).toEqual(["pose 9", "placeCameraEcef"]);
    expect(placed[0]?.[0].toArray()).toEqual([1, 2, 3]);
  });
});
