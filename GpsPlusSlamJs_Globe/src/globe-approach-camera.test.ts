/**
 * The approach on the camera, moved out of the globe lab.
 *
 * Why this file matters: the frame loop hands the camera to the approach
 * every frame until the user takes it. A wrong order here is a camera
 * placed before its distance is known, a first fly-in frame the smokes
 * cannot measure, a field of view that snaps instead of easing back after
 * a press, or an ease that never ends. The recording fakes pin the calls
 * in order and the values they carry.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  FOV_RETURN_MS,
  createApproachDrive,
  createFovReturn,
  fovAt,
} from "./globe-approach-camera.js";
import type { ApproachStep } from "./globe-approach.js";
import { applyOrbitPose, smoothstep } from "./globe-camera.js";

/** A camera that records its field of view writes and projection updates. */
function fakeCamera(fov: number) {
  const calls: string[] = [];
  const camera = {
    _fov: fov,
    get fov() {
      return this._fov;
    },
    set fov(v: number) {
      calls.push(`fov=${v}`);
      this._fov = v;
    },
    updateProjectionMatrix() {
      calls.push("projection");
    },
  };
  return { camera, calls };
}

describe("fovAt", () => {
  it("eases by smoothstep and is the end from its duration on", () => {
    const r = { from: 80, to: 50, at: 0, ms: 500 };
    expect(fovAt(r, 0)).toBe(80);
    expect(fovAt(r, 250)).toBe(80 + (50 - 80) * smoothstep(0.5));
    expect(fovAt(r, 500)).toBe(50);
    expect(fovAt(r, 9000)).toBe(50);
    expect(fovAt({ ...r, ms: 0 }, 0)).toBe(50);
  });
});

describe("createFovReturn", () => {
  it("does nothing at fovY, and has no ease to report", () => {
    const { camera, calls } = fakeCamera(50);
    const ret = createFovReturn(camera, () => 50);
    ret.step(100);
    expect(calls).toEqual([]);
    expect(ret.at(0.5)).toBeNull();
  });

  it("eases from the camera's fov to fovY over FOV_RETURN_MS, then stops", () => {
    expect(FOV_RETURN_MS).toBe(500);
    const { camera, calls } = fakeCamera(80);
    const ret = createFovReturn(camera, () => 50);
    ret.step(1000);
    ret.step(1250);
    const mid = 80 + (50 - 80) * smoothstep(0.5);
    expect(calls).toEqual(["fov=80", "projection", `fov=${mid}`, "projection"]);
    ret.step(1500);
    expect(camera.fov).toBe(50);
    calls.length = 0;
    ret.step(1600);
    expect(calls).toEqual([]);
    expect(ret.at(0.5)).toEqual({
      from: 80,
      to: 50,
      ms: 500,
      at: 1000,
      lastFrameAt: 1500,
      fov: mid,
    });
  });

  it("follows a fovY changed mid-ease, and clear() starts the next ease afresh", () => {
    let target = 50;
    const { camera } = fakeCamera(80);
    const ret = createFovReturn(camera, () => target);
    ret.step(0);
    target = 60;
    ret.step(250);
    expect(camera.fov).toBe(80 + (60 - 80) * smoothstep(0.5));
    ret.clear();
    camera.fov = 70;
    ret.step(1000);
    expect(ret.at(0)).toMatchObject({ from: 70, to: 60, at: 1000 });
  });

  it("refuses a fraction that is not finite", () => {
    const { camera } = fakeCamera(50);
    expect(() => createFovReturn(camera, () => 50).at(Number.NaN)).toThrow(
      RangeError,
    );
  });
});

describe("createApproachDrive", () => {
  function setup(steps: ApproachStep[], fov = 80) {
    const calls: string[] = [];
    const { camera, calls: camCalls } = fakeCamera(fov);
    const placed: [THREE.Vector3, THREE.Quaternion][] = [];
    const drive = createApproachDrive({
      approach: {
        pose: (now) => {
          calls.push(`pose ${now}`);
          return steps.shift() as ApproachStep;
        },
        cameraPlaced: (d) => calls.push(`placed ${d}`),
      },
      camera,
      fovReturn: {
        step: (now) => calls.push(`fovReturn.step ${now}`),
        clear: () => calls.push("fovReturn.clear"),
      },
      placeCameraEcef: (p, q) => {
        calls.push("placeCameraEcef");
        placed.push([p.clone(), q.clone()]);
      },
      fitDistance: () => 2e7,
    });
    return { drive, calls, camCalls, placed };
  }
  const pose = {
    direction: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 0, 1),
  };

  it("places an orbit frame at its distance, reports it, sets the fov, ends any ease", () => {
    const { drive, calls, camCalls, placed } = setup([
      { pose, distanceM: 3e7, fovDeg: 70 },
    ]);
    drive(5);
    expect(calls).toEqual([
      "pose 5",
      "placeCameraEcef",
      "placed 30000000",
      "fovReturn.clear",
    ]);
    expect(camCalls).toEqual(["fov=70", "projection"]);
    const expected = new THREE.PerspectiveCamera();
    applyOrbitPose(expected, pose, 3e7);
    expect(placed[0]?.[0].toArray()).toEqual(expected.position.toArray());
    expect(placed[0]?.[1].toArray()).toEqual(expected.quaternion.toArray());
  });

  it("uses the fitted distance for a held frame, and leaves an equal fov alone", () => {
    const { drive, calls, camCalls } = setup(
      [{ pose, distanceM: null, fovDeg: 50 }],
      50,
    );
    drive(1);
    expect(calls).toContain("placed 20000000");
    expect(camCalls).toEqual([]);
  });

  it("places a dive frame as it is and lets the fov ease back", () => {
    const position = new THREE.Vector3(1, 2, 3);
    const quaternion = new THREE.Quaternion(0, 0, 0, 1);
    const { drive, calls, placed } = setup([{ position, quaternion }]);
    drive(9);
    expect(calls).toEqual(["pose 9", "placeCameraEcef", "fovReturn.step 9"]);
    expect(placed[0]?.[0].toArray()).toEqual([1, 2, 3]);
  });
});
