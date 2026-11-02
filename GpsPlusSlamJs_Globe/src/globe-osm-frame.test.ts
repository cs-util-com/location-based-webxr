/**
 * Why this test matters: the OSM map's per-frame step moved out of the
 * globe lab as a pure refactor. It must attach the overlay once, on the
 * first frame the map is on (and show its credit then), drive it only once
 * attached, and give it the camera's height over the drawn ground (NaN
 * where the relief draws nothing) and its speed in the Earth's frame, not
 * the recentred world's.
 */

import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { describe, expect, it } from "vitest";

import { createOsmFrameStep, type OsmFrameOverlay } from "./globe-osm-frame.js";
import type { OsmCameraPose, OsmOverlayTerrain } from "./globe-osm-overlay.js";

function setup() {
  const calls: string[] = [];
  const poses: OsmCameraPose[] = [];
  const osm: OsmFrameOverlay = {
    attach: () => calls.push("attach"),
    setEnabled: (on) => calls.push(`enabled ${on}`),
    setFadeM: (m) => calls.push(`fade ${m}`),
    update: (pose) => {
      poses.push({ ...pose, position: pose.position.clone() });
    },
  };
  const camera = new THREE.PerspectiveCamera();
  const group = new THREE.Group();
  let credits = 0;
  const step = createOsmFrameStep({
    osm,
    terrain: {} as OsmOverlayTerrain,
    ellipsoid: WGS84_ELLIPSOID,
    group,
    camera,
    onAttach: () => (credits += 1),
  });
  return { step, calls, poses, camera, group, credits: () => credits };
}

const input = {
  on: true,
  fadeM: 400,
  groundUnderCameraM: 500,
  bandShare: 1,
};

describe("createOsmFrameStep", () => {
  it("does nothing until the map is first on, then attaches once", () => {
    const { step, calls, poses, camera, credits } = setup();
    camera.position.set(6_378_137 + 2000, 0, 0);
    step(0, { ...input, on: false });
    expect(calls).toEqual([]);
    expect(step.attached()).toBe(false);
    step(16, input);
    step(32, { ...input, on: false });
    expect(calls).toEqual([
      "attach",
      "enabled true",
      "fade 400",
      "enabled false",
      "fade 400",
    ]);
    expect(credits()).toBe(1);
    expect(poses).toHaveLength(2);
  });

  it("gives the height over the drawn ground, NaN without the relief's pixels or ground", () => {
    const { step, poses, camera } = setup();
    camera.position.set(6_378_137 + 2000, 0, 0);
    step(0, input);
    expect(poses[0]!.aboveGroundM).toBeCloseTo(1500, 6);
    step(16, { ...input, bandShare: 0 });
    expect(poses[1]!.aboveGroundM).toBeNaN();
    step(32, { ...input, groundUnderCameraM: null });
    expect(poses[2]!.aboveGroundM).toBeNaN();
    expect(poses[2]!.nowMs).toBe(32);
    expect(step.pose()?.aboveGroundM).toBeNaN();
  });

  // Why: the world is recentred under the camera, so its world position
  // stands still while it flies; the speed must be read in the Earth's frame.
  it("measures the speed in the Earth's frame, 0 on the first frame", () => {
    const { step, poses, camera, group } = setup();
    camera.position.set(0, 0, 0);
    group.position.set(-(6_378_137 + 2000), 0, 0);
    group.updateMatrixWorld(true);
    step(0, input);
    expect(poses[0]!.speedMps).toBe(0);
    // The frame moved 100 m under a camera that kept its world position.
    group.position.x -= 100;
    group.updateMatrixWorld(true);
    step(500, input);
    expect(poses[1]!.speedMps).toBeCloseTo(200, 6);
    expect(poses[1]!.position.toArray()).toEqual([0, 0, 0]);
  });
});
